import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SettingsRepo } from '@trading/database';
import { SystemEventRepo } from '@trading/database';

// Zod schema for partial settings update — every field optional
const settingsUpdateSchema = z.object({
  riskPerTradePercent:    z.number().min(0.001).max(0.1).optional(),
  minRiskReward:          z.number().min(1).max(20).optional(),
  maxDailyLossPercent:    z.number().min(0.001).max(0.5).optional(),
  maxWeeklyLossPercent:   z.number().min(0.001).max(0.5).optional(),
  maxDrawdownPercent:     z.number().min(0.001).max(1).optional(),
  maxTradesPerDay:        z.number().int().min(1).max(50).optional(),
  maxOpenPositions:       z.number().int().min(1).max(20).optional(),
  maxLeverage:            z.number().int().min(1).max(100).optional(),
  minStrategyScore:       z.number().int().min(0).max(100).optional(),
  minAiConfidence:        z.number().min(0).max(1).optional(),
  longEnabled:            z.boolean().optional(),
  shortEnabled:           z.boolean().optional(),
  stopLossMode:           z.enum(['fixed', 'atr', 'structure']).optional(),
  takeProfitMode:         z.enum(['fixed', 'rr_ratio', 'structure']).optional(),
  trailingStopEnabled:    z.boolean().optional(),
  breakEvenEnabled:       z.boolean().optional(),
  tradingHoursStart:      z.string().regex(/^\d{2}:\d{2}$/).optional(),
  tradingHoursEnd:        z.string().regex(/^\d{2}:\d{2}$/).optional(),
  cooldownAfterTradeMs:   z.number().int().min(0).optional(),
  cooldownAfterLossMs:    z.number().int().min(0).optional(),
  allowedSymbols:         z.array(z.string()).optional(),
  allowedTimeframes:      z.array(z.enum(['1m','5m','15m','1h','4h','1d'])).optional(),
  aiEnabled:              z.boolean().optional(),
  aiUnavailableMode:      z.enum(['NO_TRADE', 'RULE_BASED']).optional(),
  dailyProfitTargetPercent: z.number().min(0).optional().nullable(),
  dailyProfitTargetAmount:  z.number().min(0).optional().nullable(),
}).strict();

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /settings
  fastify.get('/', {
    onRequest: [fastify.authenticate],
    handler: async (_request, reply) => {
      const settings = await SettingsRepo.getSettings();
      return reply.send({
        success: true,
        data: settings,
        timestamp: new Date().toISOString(),
      });
    },
  });

  // PATCH /settings
  fastify.patch('/', {
    onRequest: [fastify.authenticate],
    handler: async (request, reply) => {
      const parsed = settingsUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid settings data',
            details: parsed.error.flatten(),
          },
          timestamp: new Date().toISOString(),
        });
      }

      // Safety guard: cannot enable live trading via API alone
      if ('liveTrading' in parsed.data) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Live trading mode cannot be changed via API. Update the server environment variable LIVE_TRADING.',
          },
          timestamp: new Date().toISOString(),
        });
      }

      const updated = await SettingsRepo.updateSettings(parsed.data);

      await SystemEventRepo.logEvent({
        type: 'CONFIG_CHANGED',
        level: 'info',
        message: 'Trading settings updated',
        data: { changed: Object.keys(parsed.data) },
      });

      return reply.send({
        success: true,
        data: updated,
        timestamp: new Date().toISOString(),
      });
    },
  });
};
