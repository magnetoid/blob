/** HTTP + WebSocket server. */

import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import { config } from './config.ts';
import { closePool, pool } from './db/pool.ts';
import { migrate } from './db/migrate.ts';
import { AppError } from './lib/errors.ts';
import { resolveSession, SESSION_COOKIE, type SessionUser } from './lib/auth.ts';
import { closeQueue } from './lib/queue.ts';
import { closeRedis, redis } from './lib/redis.ts';
import { authRoutes } from './routes/auth.ts';
import { channelRoutes } from './routes/channels.ts';
import { fileRoutes } from './routes/files.ts';
import { messageRoutes } from './routes/messages.ts';
import { searchRoutes } from './routes/search.ts';
import { userRoutes } from './routes/users.ts';
import * as hub from './realtime/hub.ts';
import { attachWebSocketServer } from './realtime/ws.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

/** Routes reachable without a session. Everything else requires one. */
const PUBLIC_ROUTES = new Set([
  'GET /healthz',
  'GET /api/auth/state',
  'POST /api/auth/signup',
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'POST /api/auth/forgot-password',
  'POST /api/auth/reset-password',
]);

export async function buildApp() {
  const app = Fastify({
    logger: config.isTest
      ? false
      : {
          level: config.isProd ? 'info' : 'debug',
          transport: config.isProd
            ? undefined
            : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
        },
    trustProxy: true,
    bodyLimit: 1_000_000,
  });

  await app.register(cookie, { secret: config.SESSION_SECRET });

  app.decorateRequest('user', null);

  // Resolve the session once per request; routes call requireUser() to enforce.
  app.addHook('onRequest', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    req.user = token ? await resolveSession(token) : null;

    const key = `${req.method} ${req.routeOptions.url ?? req.url}`;
    const isPublic =
      PUBLIC_ROUTES.has(key) ||
      req.url.startsWith('/api/invites/') ||
      req.url.startsWith('/api/hooks/');

    if (!isPublic && req.url.startsWith('/api/') && !req.user) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Sign in to continue.' } });
    }

    // Cookies are SameSite=Lax, but check Origin too on state-changing requests.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin && !isAllowedOrigin(origin)) {
        return reply.code(403).send({ error: { code: 'forbidden', message: 'Blocked request.' } });
      }
    }
    return undefined;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({
        error: {
          code: 'invalid_input',
          message: first?.message ?? 'That input is not valid.',
          field: first?.path.join('.'),
        },
      });
    }
    // Fastify's own 4xx (malformed JSON, missing body) carry a usable message.
    const fastifyError = err as { statusCode?: number; message?: string };
    if (fastifyError.statusCode === 400) {
      return reply.code(400).send({
        error: { code: 'bad_request', message: fastifyError.message ?? 'That request is not valid.' },
      });
    }
    req.log.error({ err }, 'unhandled error');
    return reply
      .code(500)
      .send({ error: { code: 'internal', message: 'Something went wrong on our side.' } });
  });

  app.get('/healthz', async () => {
    await pool.query('SELECT 1');
    await redis.ping();
    return { ok: true, ...hub.stats() };
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(channelRoutes);
  await app.register(messageRoutes);
  await app.register(searchRoutes);
  await app.register(fileRoutes);

  return app;
}

function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    const allowed = new URL(config.PUBLIC_URL);
    if (url.host === allowed.host) return true;
    // Vite's dev server runs on a different port than the API.
    return !config.isProd && url.hostname === 'localhost';
  } catch {
    return false;
  }
}

async function start() {
  await migrate((msg) => console.log(`[migrate] ${msg}`));

  const app = await buildApp();
  await hub.startRedisBridge();

  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  attachWebSocketServer(app.server);
  app.log.info(`listening on :${config.PORT}`);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await Promise.allSettled([closeQueue(), closeRedis(), closePool()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
