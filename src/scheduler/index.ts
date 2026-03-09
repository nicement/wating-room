import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { config } from '../config/env';
import { REDIS_KEYS } from '../constants';

async function schedulerPlugin(fastify: FastifyInstance) {
  const { redis } = fastify;
  const CAPACITY = config.MAX_CAPACITY;

  // ──────────────────────────────────────────────
  // Admission Controller (1초 주기)
  // 활성 유저 빈자리를 확인하고 대기열 유저를 승격시킵니다.
  // ──────────────────────────────────────────────
  const admissionInterval = setInterval(async () => {
    try {
      const activeCount = await redis.scard(REDIS_KEYS.ACTIVE_USERS);
      const availableSpace = CAPACITY - activeCount;
      if (availableSpace <= 0) return;

      const popped = await redis.zpopmin(REDIS_KEYS.WAIT_QUEUE, availableSpace);
      if (popped.length === 0) return;

      // zpopmin 결과: [ticketId, score, ticketId, score, ...]
      // for 루프로 처리하여 .filter() 배열 복사 오버헤드 제거
      const ticketsToPromote: string[] = [];
      for (let i = 0; i < popped.length; i += 2) {
        ticketsToPromote.push(popped[i]);
      }

      if (ticketsToPromote.length > 0) {
        await redis.sadd(REDIS_KEYS.ACTIVE_USERS, ...ticketsToPromote);
        fastify.log.info(`[Admission] Promoted ${ticketsToPromote.length} users to active.`);
      }
    } catch (err) {
      fastify.log.error(err, '[Admission] Controller error');
    }
  }, config.ADMISSION_INTERVAL_MS);

  // ──────────────────────────────────────────────
  // Garbage Collector (5초 주기)
  // TTL 갱신(Polling)을 멈춘 좀비 티켓을 대기열에서 제거합니다.
  // ──────────────────────────────────────────────
  const gcInterval = setInterval(async () => {
    try {
      const candidates = await redis.zrange(REDIS_KEYS.WAIT_QUEUE, 0, config.GC_SCAN_COUNT - 1);
      if (candidates.length === 0) return;

      // Pipeline으로 ticket 키 존재 여부를 일괄 확인
      const pipeline = redis.pipeline();
      for (const ticketId of candidates) {
        pipeline.exists(REDIS_KEYS.ticketKey(ticketId));
      }
      const results = await pipeline.exec();

      const deadTickets: string[] = [];
      for (let i = 0; i < candidates.length; i++) {
        // exec 결과: [[err, 0|1], ...] — 0이면 TTL 만료(dead)
        if (results![i][1] === 0) {
          deadTickets.push(candidates[i]);
        }
      }

      if (deadTickets.length > 0) {
        await redis.zrem(REDIS_KEYS.WAIT_QUEUE, ...deadTickets);
        fastify.log.info(`[GC] Removed ${deadTickets.length} zombie tickets.`);
      }
    } catch (err) {
      fastify.log.error(err, '[GC] Error');
    }
  }, config.GC_INTERVAL_MS);

  // Graceful cleanup
  fastify.addHook('onClose', async () => {
    clearInterval(admissionInterval);
    clearInterval(gcInterval);
  });
}

export default fp(schedulerPlugin, {
  name: 'scheduler',
  dependencies: ['redis'],
});
