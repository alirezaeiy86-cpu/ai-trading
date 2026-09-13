import type { FastifyPluginAsync } from 'fastify';
import {
  PaperAccountRepo,
  PositionRepo,
  StatisticsRepo,
  HeartbeatRepo,
  SystemEventRepo,
} from '@trading/database';

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /dashboard  — everything the main page needs in one call
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    handler: async (_request, reply) => {
      const isPaper = process.env['PAPER_TRADING'] !== 'false';
      const staleMs = parseInt(process.env['WORKER_STALE_THRESHOLD_MS'] ?? '60000', 10);

      const [account, openPositions, todayStats, allTimeStats, workerHeartbeat, recentEvents] =
        await Promise.all([
          PaperAccountRepo.getPaperAccount(),
          PositionRepo.getOpenPositions(isPaper),
          StatisticsRepo.getTodayStatistics(isPaper),
          StatisticsRepo.getAllTimeStats(isPaper),
          HeartbeatRepo.getLatestHeartbeat(),
          SystemEventRepo.getRecentEvents(20),
        ]);

      // Worker liveness
      const workerAlive = workerHeartbeat
        ? Date.now() - workerHeartbeat.lastSeenAt.getTime() < staleMs
        : false;
      const workerStatus = !workerHeartbeat
        ? 'offline'
        : workerAlive
          ? 'online'
          : 'stale';

      // Drawdown from high water mark
      const drawdownPct =
        account.highWaterMark > 0
          ? ((account.highWaterMark - account.equity) / account.highWaterMark) * 100
          : 0;

      return reply.send({
        success: true,
        data: {
          // Account
          balance: account.currentBalance,
          equity: account.equity,
          availableBalance: account.currentBalance,
          highWaterMark: account.highWaterMark,
          currency: account.currency,
          isPaper,

          // P&L
          todayPnl: todayStats?.pnl ?? 0,
          todayPnlPercent: todayStats?.pnlPercent ?? 0,
          drawdownPercent: drawdownPct,

          // Trades today
          tradesToday: todayStats?.totalTrades ?? 0,
          winningToday: todayStats?.winningTrades ?? 0,
          losingToday: todayStats?.losingTrades ?? 0,
          winRateToday: todayStats?.winRate ?? 0,

          // All-time
          allTimePnl: allTimeStats.totalPnl,
          allTimeTrades: allTimeStats.totalTrades,
          allTimeWins: allTimeStats.winningTrades,
          allTimeLosses: allTimeStats.losingTrades,
          allTimeFees: allTimeStats.totalFees,

          // Open positions
          openPositions: openPositions.map((p) => ({
            id: p.id,
            symbol: p.symbol,
            side: p.side,
            entryPrice: p.entryPrice,
            currentPrice: p.currentPrice,
            quantity: p.quantity,
            stopLoss: p.stopLoss,
            takeProfit: p.takeProfit,
            unrealisedPnl: p.unrealisedPnl,
            openedAt: p.openedAt,
          })),

          // Worker
          worker: {
            status: workerStatus,
            lastHeartbeat: workerHeartbeat?.lastSeenAt ?? null,
            uptimeSeconds: workerHeartbeat?.uptimeSeconds ?? 0,
            tradingMode: workerHeartbeat?.tradingMode ?? (isPaper ? 'PAPER' : 'LIVE'),
            memoryMb: workerHeartbeat?.memoryUsageMb ?? 0,
          },

          // Recent system events
          recentEvents: recentEvents.map((e) => ({
            id: e.id,
            type: e.type,
            level: e.level,
            message: e.message,
            createdAt: e.createdAt,
          })),
        },
        timestamp: new Date().toISOString(),
      });
    },
  });
};
