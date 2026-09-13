import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma, SettingsRepo, CandleRepo } from '@trading/database';
import { BacktestEngine, formatBacktestReport, serializeBacktestResult } from '@trading/backtesting';
import type { BacktestConfig } from '@trading/backtesting';
import type { Timeframe, RiskSettings } from '@trading/types';

const runSchema = z.object({
  strategyName:   z.string().min(1),
  symbol:         z.string().min(1).default('BTCUSDT'),
  timeframe:      z.enum(['1m','5m','15m','1h','4h','1d']).default('1h'),
  startDate:      z.string().datetime(),
  endDate:        z.string().datetime(),
  initialBalance: z.number().positive().default(10_000),
  // Allow override of individual risk settings
  riskPerTradePercent: z.number().min(0.001).max(0.1).optional(),
  minRiskReward:       z.number().min(1).optional(),
  minStrategyScore:    z.number().int().min(0).max(100).optional(),
});

export const backtestRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /backtest/run
  fastify.post('/run', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const parsed = runSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid backtest config', details: parsed.error.flatten() },
          timestamp: new Date().toISOString(),
        });
      }

      const body = parsed.data;

      // Load DB settings as base, allow per-request overrides
      const dbSettings = await SettingsRepo.getSettings();
      const riskSettings: RiskSettings = {
        ...SettingsRepo.toRiskSettings(dbSettings),
        riskPerTradePercent:  body.riskPerTradePercent  ?? dbSettings.riskPerTradePercent,
        minRiskReward:        body.minRiskReward        ?? dbSettings.minRiskReward,
        minStrategyScore:     body.minStrategyScore     ?? dbSettings.minStrategyScore,
        // Backtest always uses rule-based (no AI)
        aiEnabled:            false,
        aiUnavailableMode:    'RULE_BASED',
        // No cooldowns in backtest (would block signals unrealistically)
        cooldownAfterTradeMs: 0,
        cooldownAfterLossMs:  0,
      };

      // Create a PENDING DB record
      const run = await prisma.backtestRun.create({
        data: {
          strategyName:   body.strategyName,
          symbol:         body.symbol,
          timeframe:      body.timeframe,
          startDate:      new Date(body.startDate),
          endDate:        new Date(body.endDate),
          initialBalance: body.initialBalance,
          status:         'RUNNING',
          riskConfig:     riskSettings as never,
        },
      });

      // Run async — don't block the HTTP response
      void (async () => {
        try {
          // Fetch candles from DB (need 250 warmup bars before startDate)
          const startWithWarmup = new Date(body.startDate);
          startWithWarmup.setDate(startWithWarmup.getDate() - 30); // rough warmup window

          const dbCandles = await CandleRepo.getCandlesInRange(
            body.symbol,
            body.timeframe as Timeframe,
            startWithWarmup,
            new Date(body.endDate),
          );

          const candles = dbCandles.map(CandleRepo.toCandle);

          if (candles.length < 260) {
            await prisma.backtestRun.update({
              where: { id: run.id },
              data:  { status: 'FAILED', error: `Insufficient candle data: ${candles.length} bars (need 260+). Ensure the worker has collected enough history first.` },
            });
            return;
          }

          const config: BacktestConfig = {
            strategyName:   body.strategyName,
            symbol:         body.symbol,
            timeframe:      body.timeframe as Timeframe,
            startDate:      new Date(body.startDate),
            endDate:        new Date(body.endDate),
            initialBalance: body.initialBalance,
            riskSettings,
          };

          const engine = new BacktestEngine(config);
          const result = engine.run(candles, 250);
          const serialized = serializeBacktestResult(result);
          const report = formatBacktestReport(result);

          await prisma.backtestRun.update({
            where: { id: run.id },
            data: {
              status:        result.status,
              error:         result.error,
              totalTrades:   result.totalTrades,
              winningTrades: result.winningTrades,
              losingTrades:  result.losingTrades,
              winRate:       result.winRate,
              netPnl:        result.netPnl,
              netPnlPercent: result.netPnlPercent,
              profitFactor:  isFinite(result.profitFactor) ? result.profitFactor : null,
              avgR:          result.avgR,
              maxDrawdown:   result.maxDrawdown,
              maxDrawdownPct: result.maxDrawdownPct,
              largestWin:    result.largestWin,
              largestLoss:   result.largestLoss,
              avgTrade:      result.avgTrade,
              totalFees:     result.totalFees,
              tradeList:     serialized['trades'] as never,
              equityCurve:   serialized['equityCurve'] as never,
            },
          });

          // Log the report to system events
          await prisma.systemEvent.create({
            data: {
              type:    'DAILY_STATS',
              level:   'info',
              message: `Backtest completed: ${body.strategyName} — ${result.totalTrades} trades, PnL: $${result.netPnl.toFixed(2)}`,
              data:    { backtestId: run.id, report: report.slice(0, 2000) },
            },
          });
        } catch (err) {
          await prisma.backtestRun.update({
            where: { id: run.id },
            data:  { status: 'FAILED', error: String(err) },
          }).catch(() => undefined);
        }
      })();

      return reply.status(202).send({
        success: true,
        data: { id: run.id, status: 'RUNNING', message: 'Backtest started. Poll /backtest/:id for results.' },
        timestamp: new Date().toISOString(),
      });
    },
  });

  // GET /backtest/:id
  fastify.get('/:id', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const run = await prisma.backtestRun.findUnique({ where: { id } });

      if (!run) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: `Backtest ${id} not found` },
          timestamp: new Date().toISOString(),
        });
      }

      return reply.send({
        success: true,
        data: run,
        timestamp: new Date().toISOString(),
      });
    },
  });

  // GET /backtest  — list recent runs
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const query = request.query as { limit?: string };
      const limit = Math.min(parseInt(query.limit ?? '20', 10), 100);

      const runs = await prisma.backtestRun.findMany({
        orderBy: { createdAt: 'desc' },
        take:    limit,
        select: {
          id:            true,
          strategyName:  true,
          symbol:        true,
          timeframe:     true,
          startDate:     true,
          endDate:       true,
          initialBalance: true,
          status:        true,
          netPnl:        true,
          netPnlPercent: true,
          winRate:       true,
          totalTrades:   true,
          maxDrawdownPct: true,
          createdAt:     true,
        },
      });

      return reply.send({
        success: true,
        data: runs,
        timestamp: new Date().toISOString(),
      });
    },
  });
};
