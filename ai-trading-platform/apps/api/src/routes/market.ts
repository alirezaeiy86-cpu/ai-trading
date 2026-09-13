import type { FastifyPluginAsync } from 'fastify';
import { CandleRepo } from '@trading/database';
import type { Timeframe } from '@trading/types';

const SYMBOLS    = ['BTCUSDT', 'ETHUSDT'];
const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h'];

export const marketDataRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /market/health — freshness check for all tracked pairs
  fastify.get('/health', {
    onRequest: [fastify.authenticate],
    handler: async (_request, reply) => {
      const results = await Promise.all(
        SYMBOLS.flatMap((symbol) =>
          TIMEFRAMES.map(async (timeframe) => {
            const latest = await CandleRepo.getLatestCandleTime(symbol, timeframe);
            const ageMs  = latest ? Date.now() - latest.getTime() : null;
            return {
              symbol,
              timeframe,
              lastCandle: latest,
              ageMinutes: ageMs !== null ? Math.round(ageMs / 60_000) : null,
              fresh:      ageMs !== null && ageMs < 300_000, // 5 min threshold
            };
          }),
        ),
      );

      const allFresh = results.every((r) => r.fresh);
      return reply.send({
        success: true,
        data: { allFresh, pairs: results },
        timestamp: new Date().toISOString(),
      });
    },
  });

  // GET /market/candles?symbol=BTCUSDT&timeframe=1h&limit=50
  fastify.get('/candles', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const query = request.query as {
        symbol?: string;
        timeframe?: string;
        limit?: string;
      };

      const symbol    = query.symbol    ?? 'BTCUSDT';
      const timeframe = (query.timeframe ?? '1h') as Timeframe;
      const limit     = Math.min(parseInt(query.limit ?? '100', 10), 500);

      const rows = await CandleRepo.getRecentCandles(symbol, timeframe, limit);
      return reply.send({
        success: true,
        data: rows.map(CandleRepo.toCandle),
        timestamp: new Date().toISOString(),
      });
    },
  });
};
