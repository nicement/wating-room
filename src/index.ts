import Fastify, { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyJwt from '@fastify/jwt';

import { config } from './config/env';
import redisPlugin from './plugins/redis';
import queueRoutes from './routes/queue';
import schedulerPlugin from './scheduler';

// ──────────────────────────────────────────────
// App Factory (테스트 환경에서의 인스턴스 재사용 가능)
// ──────────────────────────────────────────────

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.IS_PRODUCTION ? 'warn' : 'info',
    },
    keepAliveTimeout: 30_000,
  });

  // ── Swagger (개발 모드 전용) ──
  if (!config.IS_PRODUCTION) {
    app.register(fastifySwagger, {
      openapi: {
        info: {
          title: 'wating-room API',
          description: '대기열 시스템 API — 트래픽 폭주 상황에서 사용자 대기열을 관리하고 순차적으로 목적지 서버로 진입시킵니다.',
          version: '1.0.0',
        },
        tags: [{ name: 'Queue', description: '대기열 관련 API' }],
      },
    });

    app.register(fastifySwaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list', deepLinking: true },
    });
  }

  // ── Core Plugins ──
  app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: config.JWT_EXPIRES_IN },
  });

  app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
  });

  // ── Application Plugins ──
  app.register(redisPlugin);
  app.register(queueRoutes);
  app.register(schedulerPlugin);

  return app;
}

// ──────────────────────────────────────────────
// Bootstrap
// ──────────────────────────────────────────────

async function main() {
  const app = buildApp();

  // Graceful Shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`[Shutdown] Received ${signal}. Closing server...`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`🚀 Queue Server running on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err, 'Failed to start server');
    process.exit(1);
  }
}

main();
