import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { config } from '../config/env';
import { REDIS_KEYS } from '../constants';

export default async function pageRoutes(fastify: FastifyInstance) {
  const { redis } = fastify;
  const CAPACITY = config.MAX_CAPACITY;
  const TICKET_TTL = config.TICKET_TTL_SECONDS;

  /**
   * GET /
   * Entry Gateway.
   * If BYPASS, issues token and redirects to DESTINATION_URL.
   * If WAIT, generates ticket and redirects to /waiting-room.
   */
  fastify.get('/', async (request, reply) => {
    // We can allow users who already have a ticketId in query to bypass if ready, but let's keep it simple.
    // If they land on /, we check capacity.

    const [activeCount, waitCount] = await Promise.all([
      redis.scard(REDIS_KEYS.ACTIVE_USERS),
      redis.zcard(REDIS_KEYS.WAIT_QUEUE),
    ]);

    if (activeCount < CAPACITY && waitCount === 0) {
      // Bypass
      const ticketId = randomUUID();
      const token = fastify.jwt.sign({ ticketId, scope: 'entrance' });
      await redis.sadd(REDIS_KEYS.ACTIVE_USERS, ticketId);

      reply.setCookie('access_token', token, {
        path: '/',
        httpOnly: true,
        secure: config.IS_PRODUCTION,
        sameSite: 'lax',
      });

      return reply.redirect(config.DESTINATION_URL);
    }

    // Wait
    const ticketId = randomUUID();
    const joinTime = Date.now();

    await redis.pipeline()
      .zadd(REDIS_KEYS.WAIT_QUEUE, joinTime, ticketId)
      .set(REDIS_KEYS.ticketKey(ticketId), String(joinTime), 'EX', TICKET_TTL)
      .exec();

    reply.setCookie('ticketId', ticketId, {
      path: '/',
      httpOnly: true,
      secure: config.IS_PRODUCTION,
      sameSite: 'lax',
      maxAge: TICKET_TTL,
    });

    return reply.redirect(`/waiting-room`);
  });

  /**
   * GET /waiting-room
   * Serves the static HTML.
   */
  fastify.get('/waiting-room', async (request, reply) => {
    return reply.sendFile('index.html');
  });
}
