import { Queue, Worker } from 'bullmq';
import type { Logger } from 'pino';
import type { Config } from '@trading/config';
import type { WorkerStatus, Timeframe } from '@trading/types';
import { SystemEventRepo, SettingsRepo } from '@trading/database';
import { prisma } from '@trading/database';
import {
  MarketDataService,
  createMarketDataProvider,
} from '@trading/market-data';
import { StrategyEngine }    from '@trading/strategies';
import { RiskEngine }        from '@trading/risk-engine';
import type { TradeProposal } from '@trading/risk-engine';
import {
  createExecutionProvider,
  PositionMonitor,
  calculateDailyStatistics,
} from '@trading/execution';
import type { ExecutionProvider } from '@trading/execution';
import {
  AIRequestManager,
  createAIProvider,
} from '@trading/ai-engine';
import type { AIAnalysisRequest } from '@trading/types';
import { HeartbeatService }      from './services/heartbeat';
import { TradingStateService }   from './services/trading-state.service';
import { createRedisClients, isRedisHealthy } from './services/redis-connection';
import type { RedisClients }     from './services/redis-connection';
import { CommandSubscriber }     from './services/command-subscriber';
import { DistributedLock }       from './services/distributed-lock';

// =============================================================================
// JOB NAMES
// =============================================================================
export const JOB_NAMES = {
  MARKET_DATA_UPDATE:    'market-data-update',
  INDICATOR_CALCULATION: 'indicator-calculation',
  STRATEGY_ANALYSIS:     'strategy-analysis',
  AI_ANALYSIS:           'ai-analysis',
  RISK_VALIDATION:       'risk-validation',
  TRADE_EXECUTION:       'trade-execution',
  POSITION_MONITORING:   'position-monitoring',
  DAILY_STATISTICS:      'daily-statistics',
  HEALTH_CHECK:          'health-check',
} as const;

export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

// =============================================================================
// TRADING WORKER
// =============================================================================
export class TradingWorker {
  private queue:             Queue | null = null;
  private bullWorker:        Worker | null = null;
  private heartbeat:         HeartbeatService;
  private marketData:        MarketDataService | null = null;
  private strategyEngine:    StrategyEngine;
  private tradingState:      TradingStateService;
  private executionProvider: ExecutionProvider;
  private positionMonitor:   PositionMonitor | null = null;
  private aiManager:         AIRequestManager | null = null;
  private redisClients:      RedisClients | null = null;
  private cmdSubscriber:     CommandSubscriber | null = null;
  private execLock:          DistributedLock | null = null;

  private status:    WorkerStatus = 'STOPPED';
  private startedAt: Date | null  = null;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {
    this.heartbeat = new HeartbeatService(config, logger);
    this.strategyEngine = new StrategyEngine({
      minScore:      config.NODE_ENV === 'development' ? 30 : 60,
      minRiskReward: 1.5,
    });
    this.tradingState      = new TradingStateService(config.PAPER_TRADING, logger);
    this.executionProvider = createExecutionProvider(config.PAPER_TRADING, logger);

    // Initialise AI manager if enabled
    if (config.AI_ENABLED) {
      try {
        const aiProvider = createAIProvider(config);
        this.aiManager   = new AIRequestManager(
          aiProvider,
          {
            maxPerMinute:    config.AI_MAX_REQUESTS_PER_MINUTE,
            maxPerDay:       config.AI_MAX_REQUESTS_PER_DAY,
            timeoutMs:       config.AI_REQUEST_TIMEOUT_MS,
            retryAttempts:   1,
            cacheSeconds:    300, // 5-minute cache
            unavailableMode: config.AI_UNAVAILABLE_MODE,
          },
          logger,
        );
        this.logger.info({ provider: config.AI_PROVIDER }, 'AI engine initialised');
      } catch (err) {
        this.logger.warn({ err }, 'AI engine init failed — running without AI');
      }
    } else {
      this.logger.info('AI engine disabled (AI_ENABLED=false)');
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.logger.info('Initialising trading worker…');

    // ── Market data ──────────────────────────────────────────────────────────
    const provider = createMarketDataProvider(this.config, this.logger);

    const allowedSymbols = this.config.NODE_ENV === 'test'
      ? ['BTCUSDT']
      : ['BTCUSDT', 'ETHUSDT'];

    const allowedTimeframes: Timeframe[] = ['15m', '1h', '4h'];

    this.marketData = new MarketDataService(provider, {
      symbols:         allowedSymbols,
      timeframes:      allowedTimeframes,
      historicalLimit: 250,
      staleThresholdMs: this.config.MARKET_DATA_POLL_INTERVAL_MS * 2,
    }, this.logger);

    await this.marketData.start();

    // ── Redis pub/sub + distributed lock ──────────────────────────────────────
    this.redisClients = createRedisClients(this.config.REDIS_URL);
    this.execLock     = new DistributedLock(this.redisClients.client);

    this.cmdSubscriber = new CommandSubscriber(
      this.redisClients.subscriber,
      this.redisClients.client,
      this.handleCommand.bind(this),
      this.logger,
    );
    await this.cmdSubscriber.start();

    // ── Position Monitor ──────────────────────────────────────────────────────
    this.positionMonitor = new PositionMonitor(
      this.executionProvider,
      (symbol) => this.marketData!.getCurrentPrice(symbol),
      this.logger,
    );

    // ── BullMQ ────────────────────────────────────────────────────────────────
    const redisConn = this.redisConnection();

    this.queue = new Queue('trading', {
      connection: redisConn,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail:     50,
        attempts:         3,
        backoff: { type: 'exponential', delay: 5_000 },
      },
    });

    this.bullWorker = new Worker(
      'trading',
      async (job) => {
        this.heartbeat.setCurrentJob(job.name);
        try {
          await this.processJob(job.name as JobName, job.data as Record<string, unknown>);
        } finally {
          this.heartbeat.setCurrentJob(null);
        }
      },
      {
        connection: redisConn,
        concurrency: 1,
      },
    );

    this.bullWorker.on('completed', (job) => {
      this.logger.debug({ jobId: job.id, jobName: job.name }, 'Job completed');
    });

    this.bullWorker.on('failed', (job, err) => {
      this.logger.error({ jobId: job?.id, jobName: job?.name, err }, 'Job failed');
    });

    this.bullWorker.on('error', (err) => {
      this.logger.error({ err }, 'BullMQ worker error');
    });

    // ── Schedule recurring jobs ───────────────────────────────────────────────
    await this.scheduleRecurringJobs();

    // ── Heartbeat ─────────────────────────────────────────────────────────────
    this.status    = 'RUNNING';
    this.startedAt = new Date();
    this.heartbeat.setStatus('RUNNING');
    await this.heartbeat.start(this.getUptimeSeconds.bind(this));

    await SystemEventRepo.logEvent({
      type:    'WORKER_STARTED',
      level:   'info',
      message: 'Trading worker started',
      data: {
        tradingMode: this.config.PAPER_TRADING ? 'PAPER' : 'LIVE',
        aiEnabled:   this.config.AI_ENABLED,
        symbols:     allowedSymbols,
        timeframes:  allowedTimeframes,
      },
    });

    this.logger.info('Trading worker started successfully ✓');
    await this.keepAlive();
  }

  async stop(): Promise<void> {
    this.status = 'STOPPED';
    this.heartbeat.setStatus('STOPPED');
    this.heartbeat.stop();

    if (this.cmdSubscriber) await this.cmdSubscriber.stop();
    if (this.marketData)    await this.marketData.stop();
    if (this.bullWorker)    await this.bullWorker.close();
    if (this.queue)         await this.queue.close();
    if (this.redisClients) {
      this.redisClients.client.disconnect();
      this.redisClients.subscriber.disconnect();
    }

    await SystemEventRepo.logEvent({
      type: 'WORKER_STOPPED', level: 'info',
      message: 'Trading worker stopped gracefully',
    });
  }

  // ── Command handler (called by CommandSubscriber) ─────────────────────────

  private async handleCommand(command: string, reason: string): Promise<void> {
    this.logger.info({ command, reason }, 'Executing command');

    switch (command) {
      case 'START':
        await this.resume();
        break;
      case 'PAUSE':
        await this.pause();
        break;
      case 'RESUME':
        await this.resume();
        break;
      case 'EMERGENCY_STOP':
        await this.emergencyStop();
        break;
      default:
        this.logger.warn({ command }, 'Unknown command received');
    }

    // Update status in Redis so API can read it immediately
    await this.cmdSubscriber?.setStatus(this.status);
  }

  async pause(): Promise<void> {
    this.status = 'PAUSED';
    this.heartbeat.setStatus('PAUSED');
    await this.bullWorker?.pause();
    await SystemEventRepo.logEvent({
      type: 'WORKER_PAUSED', level: 'info',
      message: 'Trading worker paused',
    });
    this.logger.info('Worker paused');
  }

  async resume(): Promise<void> {
    this.status = 'RUNNING';
    this.heartbeat.setStatus('RUNNING');
    await this.bullWorker?.resume();
    await SystemEventRepo.logEvent({
      type: 'WORKER_RESUMED', level: 'info',
      message: 'Trading worker resumed',
    });
    this.logger.info('Worker resumed');
  }

  async emergencyStop(): Promise<void> {
    this.status = 'EMERGENCY_STOP';
    this.heartbeat.setStatus('EMERGENCY_STOP');
    await this.bullWorker?.pause();
    await SystemEventRepo.logEvent({
      type: 'EMERGENCY_STOP', level: 'warn',
      message: 'EMERGENCY STOP — worker paused, no new trades will be opened',
    });
    this.logger.warn('🛑 EMERGENCY STOP activated');
  }

  // ── Job scheduling ─────────────────────────────────────────────────────────

  private async scheduleRecurringJobs(): Promise<void> {
    if (!this.queue) return;

    // Remove stale repeatable jobs to avoid duplicates on restart
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      await this.queue.removeRepeatableByKey(job.key);
    }

    const jobs: Array<{ name: JobName; every?: number; pattern?: string }> = [
      { name: JOB_NAMES.HEALTH_CHECK,          every: 30_000 },
      { name: JOB_NAMES.MARKET_DATA_UPDATE,     every: this.config.MARKET_DATA_POLL_INTERVAL_MS },
      { name: JOB_NAMES.INDICATOR_CALCULATION,  every: this.config.STRATEGY_CHECK_INTERVAL_MS },
      { name: JOB_NAMES.STRATEGY_ANALYSIS,      every: this.config.STRATEGY_CHECK_INTERVAL_MS },
      { name: JOB_NAMES.POSITION_MONITORING,    every: 60_000 },
      { name: JOB_NAMES.DAILY_STATISTICS,       pattern: '0 0 * * *' },
    ];

    for (const job of jobs) {
      await this.queue.add(
        job.name,
        {},
        {
          repeat:  job.pattern ? { pattern: job.pattern } : { every: job.every },
          jobId:   `${job.name}-repeat`,
        },
      );
    }

    this.logger.info({ count: jobs.length }, 'Recurring jobs scheduled');
  }

  // ── Job processor ──────────────────────────────────────────────────────────

  private async processJob(name: JobName, _data: Record<string, unknown>): Promise<void> {
    if (this.status === 'PAUSED' || this.status === 'EMERGENCY_STOP') {
      this.logger.debug({ name }, 'Skipping job — worker not RUNNING');
      return;
    }

    this.logger.debug({ name }, 'Processing job');

    switch (name) {
      case JOB_NAMES.HEALTH_CHECK:
        await this.handleHealthCheck();
        break;

      case JOB_NAMES.MARKET_DATA_UPDATE:
        await this.handleMarketDataUpdate();
        break;

      case JOB_NAMES.INDICATOR_CALCULATION:
        // Phase 5: IndicatorEngine
        this.logger.debug('Indicator calculation — Phase 5 pending');
        break;

      case JOB_NAMES.STRATEGY_ANALYSIS:
        await this.handleStrategyAnalysis();
        break;

      case JOB_NAMES.POSITION_MONITORING:
        await this.handlePositionMonitoring();
        break;

      case JOB_NAMES.DAILY_STATISTICS:
        await this.handleDailyStatistics();
        break;

      default:
        this.logger.warn({ name }, 'Unknown job name');
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private async handleStrategyAnalysis(): Promise<void> {
    if (!this.marketData) return;

    const dbSettings  = await SettingsRepo.getSettings();
    const riskSettings = SettingsRepo.toRiskSettings(dbSettings);
    const riskEngine   = new RiskEngine(riskSettings);

    const [account, state] = await Promise.all([
      this.tradingState.getAccountState(),
      this.tradingState.getTradingState(),
    ]);

    const { ok, reason } = riskEngine.canTrade(account, state);
    if (!ok) {
      this.logger.info({ reason }, 'canTrade=false — skipping strategy evaluation');
      return;
    }

    const symbols:    string[]    = dbSettings.allowedSymbols.length > 0
      ? dbSettings.allowedSymbols
      : ['BTCUSDT', 'ETHUSDT'];
    const timeframes: Timeframe[] = dbSettings.allowedTimeframes as Timeframe[];

    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        try {
          // ── 1. Candles ────────────────────────────────────────────────────
          const candles = await this.marketData.getCandles(symbol, timeframe, 250);
          if (candles.length < 50) continue;

          // ── 2. Strategy evaluation ────────────────────────────────────────
          const engineResult = this.strategyEngine.evaluate(symbol, timeframe, candles);
          if (!engineResult.bestSignal) continue;

          const signal    = engineResult.bestSignal;
          const strategyId = await this.getStrategyId(signal.strategyName);

          const dbSignal = await prisma.strategySignal.create({
            data: {
              strategyId,
              symbol:      signal.symbol,
              timeframe:   signal.timeframe,
              direction:   signal.direction,
              score:       signal.score,
              confidence:  signal.confidence,
              entryMin:    signal.entryZone.min,
              entryMax:    signal.entryZone.max,
              stopLoss:    signal.suggestedStopLoss,
              takeProfit:  signal.suggestedTakeProfit,
              riskReward:  signal.riskReward,
              marketRegime: signal.marketRegime,
              reasons:     signal.reasons,
            },
          });

          // ── 3. AI analysis (if enabled and quota available) ───────────────
          let aiResult = null;
          let aiDecision: string | null = null;
          let aiConfidence: number | null = null;
          let aiReasons: string[] = [];
          let aiOutcome = 'SKIPPED';

          if (dbSettings.aiEnabled && this.aiManager?.canRequest()) {
            const aiRequest: AIAnalysisRequest = {
              symbol,
              currentPrice:    candles.at(-1)?.close ?? 0,
              marketRegime:    signal.marketRegime,
              strategySignals: [signal],
              recentCandles:   candles.slice(-20),
              openPositions:   state.openPositions,
              riskSettings,
            };

            aiResult = await this.aiManager.analyse(aiRequest);

            if (aiResult) {
              aiDecision    = aiResult.decision;
              aiConfidence  = aiResult.confidence;
              aiReasons     = aiResult.reasons;
              aiOutcome     = 'RECEIVED';

              // Persist AI prediction
              await prisma.aiPrediction.create({
                data: {
                  symbol,
                  timeframe,
                  modelUsed:   aiResult.modelUsed,
                  provider:    this.config.AI_PROVIDER,
                  decision:    aiResult.decision,
                  confidence:  aiResult.confidence,
                  marketRegime: aiResult.marketRegime,
                  entry:       aiResult.entry,
                  stopLoss:    aiResult.stopLoss,
                  takeProfit:  aiResult.takeProfit,
                  reasons:     aiResult.reasons,
                  latencyMs:   aiResult.latencyMs,
                },
              });

              await SystemEventRepo.logEvent({
                type: 'AI_RESPONSE', level: 'info',
                message: `AI: ${aiResult.decision} ${symbol} confidence=${(aiResult.confidence * 100).toFixed(0)}%`,
                data: {
                  symbol, decision: aiResult.decision,
                  confidence: aiResult.confidence,
                  latencyMs:  aiResult.latencyMs,
                },
              });

              // AI says NO_TRADE or HOLD → skip regardless of other checks
              if (aiResult.decision === 'NO_TRADE' || aiResult.decision === 'HOLD') {
                await prisma.tradeDecisionLog.create({
                  data: {
                    symbol, outcome: 'REJECTED',
                    strategyScore: signal.score,
                    requiredStrategyScore: riskSettings.minStrategyScore,
                    strategyReasons: signal.reasons,
                    signalId: dbSignal.id,
                    aiDecision,
                    aiConfidence,
                    requiredAiConfidence: riskSettings.minAIConfidence,
                    aiReasons,
                    riskDecision:          null,
                    riskRejectionReasons:  [],
                    riskReward:            signal.riskReward,
                    requiredRiskReward:    riskSettings.minRiskReward,
                    marketRegime:          signal.marketRegime,
                    finalReason:           `AI decision: ${aiResult.decision}`,
                  },
                });
                continue;
              }

              // Direction mismatch: strategy says LONG but AI says SELL → skip
              const signalDir = signal.direction;
              if (
                (signalDir === 'LONG'  && aiResult.decision === 'SELL') ||
                (signalDir === 'SHORT' && aiResult.decision === 'BUY')
              ) {
                await prisma.tradeDecisionLog.create({
                  data: {
                    symbol, outcome: 'REJECTED',
                    strategyScore: signal.score,
                    requiredStrategyScore: riskSettings.minStrategyScore,
                    strategyReasons: signal.reasons,
                    signalId: dbSignal.id,
                    aiDecision, aiConfidence,
                    requiredAiConfidence: riskSettings.minAIConfidence,
                    aiReasons,
                    riskDecision: null, riskRejectionReasons: [],
                    riskReward: signal.riskReward,
                    requiredRiskReward: riskSettings.minRiskReward,
                    marketRegime: signal.marketRegime,
                    finalReason: `AI direction mismatch: strategy=${signalDir} AI=${aiResult.decision}`,
                  },
                });
                continue;
              }

            } else {
              // AI unavailable
              aiOutcome = 'UNAVAILABLE';
              await SystemEventRepo.logEvent({
                type: 'AI_RATE_LIMIT', level: 'warn',
                message: `AI unavailable for ${symbol}/${timeframe} — mode: ${this.config.AI_UNAVAILABLE_MODE}`,
              });

              if (this.config.AI_UNAVAILABLE_MODE === 'NO_TRADE') {
                await prisma.tradeDecisionLog.create({
                  data: {
                    symbol, outcome: 'NO_TRADE_AI_UNAVAILABLE',
                    strategyScore: signal.score,
                    requiredStrategyScore: riskSettings.minStrategyScore,
                    strategyReasons: signal.reasons,
                    signalId: dbSignal.id,
                    aiDecision: null, aiConfidence: null,
                    requiredAiConfidence: riskSettings.minAIConfidence,
                    aiReasons: [],
                    riskDecision: null, riskRejectionReasons: [],
                    riskReward: signal.riskReward,
                    requiredRiskReward: riskSettings.minRiskReward,
                    marketRegime: signal.marketRegime,
                    finalReason: 'AI unavailable — AI_UNAVAILABLE_MODE=NO_TRADE',
                  },
                });
                continue;
              }
              // RULE_BASED: fall through to risk engine with aiConfidence=null
            }
          }

          // ── 4. Risk Engine ────────────────────────────────────────────────
          const entryPrice = (signal.entryZone.min + signal.entryZone.max) / 2;
          const proposal: TradeProposal = {
            symbol,
            direction:     signal.direction as 'LONG' | 'SHORT',
            entryPrice,
            stopLoss:      signal.suggestedStopLoss,
            takeProfit:    signal.suggestedTakeProfit,
            strategyScore: signal.score,
            aiConfidence,
            signal,
            aiResult,
          };

          const riskResult = riskEngine.validate(proposal, account, state);

          // ── 5. Decision log ───────────────────────────────────────────────
          await prisma.tradeDecisionLog.create({
            data: {
              symbol,
              outcome:               riskResult.approved ? 'APPROVED' : 'REJECTED',
              strategyScore:         signal.score,
              requiredStrategyScore: riskSettings.minStrategyScore,
              strategyReasons:       signal.reasons,
              signalId:              dbSignal.id,
              aiDecision,
              aiConfidence,
              requiredAiConfidence:  riskSettings.minAIConfidence,
              aiReasons,
              riskDecision:          riskResult.approved ? 'APPROVED' : 'REJECTED',
              riskRejectionReasons:  riskResult.rejectionReasons.map((r) => r.reason),
              riskReward:            signal.riskReward,
              requiredRiskReward:    riskSettings.minRiskReward,
              marketRegime:          signal.marketRegime,
              finalReason:           riskResult.approved
                ? `Approved — score=${signal.score} ai=${aiDecision ?? 'RULE_BASED'} R:R=${signal.riskReward}`
                : riskResult.rejectionReasons[0]?.reason ?? 'Risk validation failed',
            },
          });

          // ── 6. Execute ────────────────────────────────────────────────────
          if (riskResult.approved) {
            const execResult = await this.executionProvider.openTrade({
              symbol,
              direction:     signal.direction as 'LONG' | 'SHORT',
              entryPrice,
              quantity:      riskResult.positionSize!,
              stopLoss:      signal.suggestedStopLoss,
              takeProfit:    signal.suggestedTakeProfit,
              strategyScore: signal.score,
              aiConfidence,
              marketRegime:  signal.marketRegime,
              signalId:      dbSignal.id,
            });

            if (!execResult.success) {
              this.logger.error({ error: execResult.error, symbol }, 'Trade execution failed');
            }
          } else {
            await SystemEventRepo.logEvent({
              type: 'RISK_REJECTION', level: 'info',
              message: `REJECTED: ${symbol}/${timeframe} — ${riskResult.rejectionReasons[0]?.reason ?? 'risk check failed'}`,
            });
          }

          // Log AI usage daily
          if (this.aiManager) {
            const usage = this.aiManager.getUsageStats();
            await prisma.aiUsageLog.upsert({
              where: {
                date_provider_model: {
                  date:     new Date().toISOString().slice(0, 10),
                  provider: this.config.AI_PROVIDER,
                  model:    this.config.AI_MODEL,
                },
              },
              create: {
                date:          new Date().toISOString().slice(0, 10),
                provider:      this.config.AI_PROVIDER,
                model:         this.config.AI_MODEL,
                requestsCount: usage.requestsToday,
                errorsCount:   usage.errorsToday,
                rateLimitHits: usage.rateLimitHitsToday,
              },
              update: {
                requestsCount: usage.requestsToday,
                errorsCount:   usage.errorsToday,
                rateLimitHits: usage.rateLimitHitsToday,
              },
            });
          }

          await new Promise<void>((r) => setTimeout(r, 100));
        } catch (err) {
          this.logger.warn({ err, symbol, timeframe }, 'Strategy/AI/risk cycle failed');
        }
      }
    }
  }

    // Quick pre-check: is trading even possible right now?
    const [account, state] = await Promise.all([
      this.tradingState.getAccountState(),
      this.tradingState.getTradingState(),
    ]);

    const { ok, reason } = riskEngine.canTrade(account, state);
    if (!ok) {
      this.logger.info({ reason }, 'canTrade=false — skipping strategy evaluation');
      return;
    }

    const symbols:    string[]    = dbSettings.allowedSymbols.length > 0
      ? dbSettings.allowedSymbols
      : ['BTCUSDT', 'ETHUSDT'];
    const timeframes: Timeframe[] = dbSettings.allowedTimeframes as Timeframe[];

    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        try {
          // ── 1. Get candles ────────────────────────────────────────────────
          const candles = await this.marketData.getCandles(symbol, timeframe, 250);
          if (candles.length < 50) continue;

          // ── 2. Strategy evaluation ────────────────────────────────────────
          const engineResult = this.strategyEngine.evaluate(symbol, timeframe, candles);

          this.logger.debug({
            symbol, timeframe,
            regime:  engineResult.regime,
            passed:  engineResult.passed,
            best:    engineResult.bestSignal?.score ?? 'none',
          }, 'Strategy evaluated');

          if (!engineResult.bestSignal) {
            await SystemEventRepo.logEvent({
              type: 'STRATEGY_SIGNAL', level: 'debug',
              message: `No signal: ${symbol}/${timeframe} — ${engineResult.reasons[0] ?? engineResult.regime}`,
            });
            continue;
          }

          const signal = engineResult.bestSignal;

          // ── 3. Persist signal ─────────────────────────────────────────────
          const strategyId = await this.getStrategyId(signal.strategyName);
          const dbSignal = await prisma.strategySignal.create({
            data: {
              strategyId,
              symbol:      signal.symbol,
              timeframe:   signal.timeframe,
              direction:   signal.direction,
              score:       signal.score,
              confidence:  signal.confidence,
              entryMin:    signal.entryZone.min,
              entryMax:    signal.entryZone.max,
              stopLoss:    signal.suggestedStopLoss,
              takeProfit:  signal.suggestedTakeProfit,
              riskReward:  signal.riskReward,
              marketRegime: signal.marketRegime,
              reasons:     signal.reasons,
            },
          });

          // ── 4. Risk Engine validation ─────────────────────────────────────
          const entryPrice = (signal.entryZone.min + signal.entryZone.max) / 2;
          const proposal: TradeProposal = {
            symbol,
            direction:     signal.direction as 'LONG' | 'SHORT',
            entryPrice,
            stopLoss:      signal.suggestedStopLoss,
            takeProfit:    signal.suggestedTakeProfit,
            strategyScore: signal.score,
            aiConfidence:  null,   // Phase 9: AI sets this
            signal,
            aiResult:      null,   // Phase 9: AI sets this
          };

          const riskResult = riskEngine.validate(proposal, account, state);

          // ── 5. Log decision ───────────────────────────────────────────────
          await prisma.tradeDecisionLog.create({
            data: {
              symbol,
              outcome:               riskResult.approved ? 'APPROVED' : 'REJECTED',
              strategyScore:         signal.score,
              requiredStrategyScore: riskSettings.minStrategyScore,
              strategyReasons:       signal.reasons,
              signalId:              dbSignal.id,
              aiDecision:            null,
              aiConfidence:          null,
              requiredAiConfidence:  riskSettings.minAIConfidence,
              aiReasons:             [],
              riskDecision:          riskResult.approved ? 'APPROVED' : 'REJECTED',
              riskRejectionReasons:  riskResult.rejectionReasons.map((r) => r.reason),
              riskReward:            signal.riskReward,
              requiredRiskReward:    riskSettings.minRiskReward,
              marketRegime:          signal.marketRegime,
              finalReason:           riskResult.approved
                ? `Approved — score ${signal.score}, R:R ${signal.riskReward}`
                : riskResult.rejectionReasons[0]?.reason ?? 'Risk validation failed',
            },
          });

          if (riskResult.approved) {
            await SystemEventRepo.logEvent({
              type: 'STRATEGY_SIGNAL', level: 'info',
              message: `✅ APPROVED: ${signal.direction} ${symbol}/${timeframe} score=${signal.score} R:R=${signal.riskReward}`,
              data: {
                symbol, timeframe, direction: signal.direction,
                score: signal.score, riskReward: signal.riskReward,
                positionSize: riskResult.positionSize,
                riskAmount:   riskResult.riskAmount,
              },
            });

            // ── Execute with distributed lock ─────────────────────────────
            const executeOrder = async (): Promise<void> => {
              const execResult = await this.executionProvider.openTrade({
                symbol,
                direction:      signal.direction as 'LONG' | 'SHORT',
                entryPrice:     entryPrice,
                quantity:       riskResult.positionSize!,
                stopLoss:       signal.suggestedStopLoss,
                takeProfit:     signal.suggestedTakeProfit,
                strategyScore:  signal.score,
                aiConfidence:   null,
                marketRegime:   signal.marketRegime,
                signalId:       dbSignal.id,
              });

              if (execResult.success) {
                this.logger.info({
                  positionId: execResult.positionId,
                  symbol, direction: signal.direction,
                  size:  riskResult.positionSize,
                  entry: entryPrice,
                }, '🎯 Trade executed successfully');

                if (execResult.positionId) {
                  await prisma.tradeDecisionLog.update({
                    where:  { id: dbSignal.id },
                    data:   { positionId: execResult.positionId },
                  }).catch(() => undefined);
                }
              } else {
                this.logger.error({ error: execResult.error, symbol }, 'Trade execution failed');
              }
            };

            if (this.execLock) {
              const { acquired } = await this.execLock.withLock(executeOrder);
              if (!acquired) {
                this.logger.warn({ symbol }, 'Execution lock held by another instance — skipping');
              }
            } else {
              await executeOrder();
            }

          } else {
            await SystemEventRepo.logEvent({
              type: 'RISK_REJECTION', level: 'info',
              message: `❌ REJECTED: ${symbol}/${timeframe} — ${riskResult.rejectionReasons[0]?.reason}`,
              data: { symbol, reasons: riskResult.rejectionReasons },
            });
          }

          await new Promise<void>((r) => setTimeout(r, 100));
        } catch (err) {
          this.logger.warn({ err, symbol, timeframe }, 'Strategy/risk cycle failed');
        }
      }
    }
  }

  private async handlePositionMonitoring(): Promise<void> {
    if (!this.positionMonitor) return;
    const closed = await this.positionMonitor.run(this.config.PAPER_TRADING);
    if (closed > 0) {
      this.logger.info({ closed }, 'Position monitor: positions closed');
    }
  }

  private async handleDailyStatistics(): Promise<void> {
    try {
      await calculateDailyStatistics(this.config.PAPER_TRADING);
      this.logger.info('Daily statistics calculated');
    } catch (err) {
      this.logger.error({ err }, 'Failed to calculate daily statistics');
    }
  }
  private async getStrategyId(name: string): Promise<string> {
    const existing = await prisma.strategy.findUnique({ where: { name } });
    if (existing) return existing.id;
    const created = await prisma.strategy.create({
      data: { name, displayName: name, isActive: true },
    });
    return created.id;
  }
    const marketHealthy = this.marketData?.isHealthy() ?? false;
    const dataHealth    = this.marketData?.getDataHealth() ?? [];
    const staleCount    = dataHealth.filter((d) => !d.fresh).length;

    this.logger.debug({
      status:     this.status,
      uptimeSec:  this.getUptimeSeconds(),
      memMb:      Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      marketData: marketHealthy ? 'healthy' : 'unhealthy',
      stale:      staleCount,
    }, 'Health check');

    if (staleCount > 0) {
      await SystemEventRepo.logEvent({
        type:    'MARKET_DATA_ERROR',
        level:   'warn',
        message: `${staleCount} symbol/timeframe pairs have stale data`,
        data:    { stale: dataHealth.filter((d) => !d.fresh) },
      });
    }
  }

  private async handleMarketDataUpdate(): Promise<void> {
    if (!this.marketData) return;

    try {
      await this.marketData.pollCandles();
      this.logger.debug('Market data poll complete');
    } catch (err) {
      this.logger.error({ err }, 'Market data poll failed');
      await SystemEventRepo.logEvent({
        type:    'MARKET_DATA_ERROR',
        level:   'warn',
        message: 'Market data poll failed',
        data:    { error: String(err) },
      });
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private getUptimeSeconds(): number {
    if (!this.startedAt) return 0;
    return Math.floor((Date.now() - this.startedAt.getTime()) / 1000);
  }

  private redisConnection(): { host: string; port: number } {
    try {
      const url = new URL(this.config.REDIS_URL);
      return { host: url.hostname, port: parseInt(url.port || '6379', 10) };
    } catch {
      return { host: 'localhost', port: 6379 };
    }
  }

  private keepAlive(): Promise<void> {
    return new Promise((_resolve) => {
      // BullMQ worker + heartbeat interval keep the event loop alive.
      // Process exits via SIGTERM/SIGINT → worker.stop()
    });
  }
}
