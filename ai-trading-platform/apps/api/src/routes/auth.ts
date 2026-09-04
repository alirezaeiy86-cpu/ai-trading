import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyPassword } from '../services/auth.service';

const loginSchema = z.object({
  password: z.string().min(1),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /auth/login
  fastify.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    handler: async (request, reply) => {
      const body = loginSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Password is required' },
          timestamp: new Date().toISOString(),
        });
      }

      const ok = await verifyPassword(body.data.password);
      if (!ok) {
        // Generic message — don't reveal what's wrong
        return reply.status(401).send({
          success: false,
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
          timestamp: new Date().toISOString(),
        });
      }

      const token = await reply.jwtSign({ sub: 'owner' });

      return reply
        .setCookie('trading_session', token, {
          path: '/',
          httpOnly: true,
          sameSite: 'strict',
          secure: process.env['NODE_ENV'] === 'production',
          signed: true,
          maxAge: 60 * 60 * 24, // 24h in seconds
        })
        .send({
          success: true,
          data: { message: 'Logged in' },
          timestamp: new Date().toISOString(),
        });
    },
  });

  // POST /auth/logout
  fastify.post('/logout', {
    handler: async (_request, reply) => {
      return reply
        .clearCookie('trading_session', { path: '/' })
        .send({
          success: true,
          data: { message: 'Logged out' },
          timestamp: new Date().toISOString(),
        });
    },
  });

  // GET /auth/me  — check if session is valid
  fastify.get('/me', {
    onRequest: [fastify.authenticate],
    handler: async (_request, reply) => {
      return reply.send({
        success: true,
        data: { authenticated: true },
        timestamp: new Date().toISOString(),
      });
    },
  });
};
