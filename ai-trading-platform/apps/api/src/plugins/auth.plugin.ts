import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Config } from '@trading/config';

// Extend Fastify types so authenticate() is available on every route
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: { sub: string; iat: number; exp: number };
  }
}

interface AuthPluginOptions {
  config: Config;
}

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, opts) => {
  // httpOnly cookies — secrets never reach the browser's JS
  await fastify.register(fastifyCookie, {
    secret: opts.config.SESSION_SECRET,
    hook: 'onRequest',
  });

  await fastify.register(fastifyJwt, {
    secret: opts.config.JWT_SECRET,
    cookie: {
      cookieName: 'trading_session',
      signed: true,
    },
    sign: {
      expiresIn: '24h',
    },
  });

  // Decorator used by protected routes: fastify.authenticate
  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      try {
        await request.jwtVerify();
      } catch {
        void reply.status(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
          timestamp: new Date().toISOString(),
        });
      }
    },
  );
};

export default fp(authPlugin, { name: 'auth' });
