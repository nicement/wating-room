import fp from 'fastify-plugin';
import Redis from 'ioredis';
import { FastifyInstance } from 'fastify';
import { config } from '../config/env';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

const MAX_RETRY_DELAY_MS = 3_000;
const MAX_RETRIES = 20;

async function redisPlugin(fastify: FastifyInstance) {
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy(times: number) {
      if (times > MAX_RETRIES) {
        fastify.log.error(`[Redis] Exceeded max retries (${MAX_RETRIES}). Giving up.`);
        return null; // stop retrying
      }
      const delay = Math.min(times * 200, MAX_RETRY_DELAY_MS);
      fastify.log.warn(`[Redis] Reconnecting in ${delay}ms (attempt ${times}/${MAX_RETRIES})...`);
      return delay;
    },
  });

  redis.on('ready', () => {
    fastify.log.info('[Redis] Connected and ready.');
  });

  redis.on('error', (err) => {
    fastify.log.error(err, '[Redis] Connection error');
  });

  await redis.connect();

  fastify.decorate('redis', redis);

  fastify.addHook('onClose', async () => {
    await redis.quit();
  });
}

export default fp(redisPlugin, { name: 'redis' });
