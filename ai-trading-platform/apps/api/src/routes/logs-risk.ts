import type { FastifyPluginAsync } from 'fastify';
import {
  SystemEventRepo,
  PositionRepo,
  PaperAccountRepo,
  SettingsRepo,
} from '@trading/database';
import type { LogLevel, SystemEventType } from '@trading/types';

export const logsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const query = request.query as { limit?: string; level?: string; type?: string };
      const limit = Math.min(parseInt(query.limit ?? '100', 10), 500);
      const events = await SystemEventRepo.getRecentEvents(
        limit,
        query.level as LogLevel | undefined,
        query.type as SystemEventType | undefined,
      );
      return reply.send({
        success: true, data: events,
        timestamp: new Date().toISOString(),
      });
    },
  });
};

export const riskRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/status', {
    onRequest: [fastify.authenticate],
    handler: async (_request, reply) => {
      const isPaper = process.env['PAPER_TRADING'] !== 'false';

      const [account, settings, openPositions, todayPnl, weekPnl, tradesToday] =
        await Promise.all([
          PaperAccountRepo.getPaperAccount(),
          SettingsRepo.getSettings(),
          PositionRepo.getOpenPositions(isPaper),
          PositionRepo.getTodayRealisedPnl(isPaper),
          PositionRepo.getWeekRealisedPnl(isPaper),
          PositionRepo.countTradesToday(isPaper),
        ]);

      const unrealisedPnl = openPositions.reduce((s, p) => s + p.unrealisedPnl, 0);
      const totalDayPnl   = todayPnl + unrealisedPnl;

      const drawdownPct   = account.highWaterMark > 0
        ? ((account.highWaterMark - account.equity) / account.highWaterMark) * 100
        : 0;
      const dailyLossPct  = totalDayPnl < 0 && account.currentBalance > 0
        ? (Math.abs(totalDayPnl) / account.currentBalance) * 100
        : 0;
      const weeklyLossPct = weekPnl < 0 && account.currentBalance > 0
        ? (Math.abs(weekPnl) / account.currentBalance) * 100
        : 0;

      return reply.send({
        success: true,
        data: {
          balance:          account.currentBalance,
          equity:           account.equity,
          highWaterMark:    account.highWaterMark,

          todayRealisedPnl:   todayPnl,
          todayUnrealisedPnl: unrealisedPnl,
          todayTotalPnl:      totalDayPnl,
          weekPnl,

          currentDrawdownPct:  drawdownPct,
          maxDrawdownPct:      settings.maxDrawdownPercent * 100,
          drawdownBreached:    drawdownPct >= settings.maxDrawdownPercent * 100,

          dailyLossPct,
          maxDailyLossPct:     settings.maxDailyLossPercent * 100,
          dailyLossBreached:   dailyLossPct >= settings.maxDailyLossPercent * 100,

          weeklyLossPct,
          maxWeeklyLossPct:    settings.maxWeeklyLossPercent * 100,
          weeklyLossBreached:  weeklyLossPct >= settings.maxWeeklyLossPercent * 100,

          tradesToday,
          maxTradesPerDay:     settings.maxTradesPerDay,
          tradesLimitReached:  tradesToday >= settings.maxTradesPerDay,

          openPositionsCount:  openPositions.length,
          maxOpenPositions:    settings.maxOpenPositions,
          positionsLimitReached: openPositions.length >= settings.maxOpenPositions,

          canTrade:
            dailyLossPct    < settings.maxDailyLossPercent  * 100 &&
            drawdownPct     < settings.maxDrawdownPercent    * 100 &&
            tradesToday     < settings.maxTradesPerDay       &&
            openPositions.length < settings.maxOpenPositions,
        },
        timestamp: new Date().toISOString(),
      });
    },
  });
};
