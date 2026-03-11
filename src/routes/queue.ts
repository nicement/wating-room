import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { config } from '../config/env';
import { REDIS_KEYS } from '../constants';
import { QueueStatus, type JoinBypassResponse, type JoinWaitResponse, type StatusReadyResponse, type StatusWaitingResponse, type ErrorResponse } from '../types';

// ──────────────────────────────────────────────
// Swagger Schema Definitions (핸들러와 시각적 분리)
// ──────────────────────────────────────────────

const joinSchema = {
  tags: ['Queue'],
  summary: '대기열 진입',
  description: '사용자가 목적지 서비스에 진입하기 직전에 호출합니다. 수용 가능하면 즉시 입장(BYPASS), 초과 시 대기열에 편입(WAIT)됩니다.',
  response: {
    200: {
      description: '성공 응답',
      type: 'object',
      properties: {
        status: { type: 'string', enum: [QueueStatus.BYPASS, QueueStatus.WAIT], description: 'BYPASS: 즉시 입장 / WAIT: 대기열 편입' },
        token: { type: 'string', description: 'BYPASS 시 발급되는 JWT 토큰' },
        ticketId: { type: 'string', description: 'WAIT 시 발급되는 대기표 ID' },
        position: { type: 'number', description: 'WAIT 시 현재 대기 순번' },
      },
    },
  },
} as const;

const statusSchema = {
  tags: ['Queue'],
  summary: '대기열 상태 확인 (Polling)',
  description: '대기 중인 클라이언트가 3~5초 주기로 호출하여 자신의 순번을 갱신합니다. 순서가 되면 JWT 토큰이 발급됩니다.',
  // Removed querystring schema for ticketId since we're using cookies
  // querystring: {
  //   type: 'object',
  //   required: ['ticketId'],
  //   properties: {
  //     ticketId: { type: 'string', description: '대기열 진입 시 발급받은 티켓 ID' },
  //   },
  // },
  response: {
    200: {
      description: '성공 응답',
      type: 'object',
      properties: {
        status: { type: 'string', enum: [QueueStatus.READY, QueueStatus.WAITING], description: 'READY: 입장 가능 / WAITING: 대기 중' },
        token: { type: 'string', description: 'READY 상태일 때 발급되는 JWT 토큰' },
        destination: { type: 'string', description: 'READY 상태일 때 이동할 목적지 URL' },
        position: { type: 'number', description: 'WAITING 상태일 때의 현재 대기 순번' },
      },
    },
    400: {
      description: 'ticketId 누락',
      type: 'object',
      properties: { error: { type: 'string' } },
    },
    404: {
      description: '티켓 미존재 또는 만료',
      type: 'object',
      properties: { error: { type: 'string' } },
    },
  },
} as const;

// ──────────────────────────────────────────────
// Route Handlers
// ──────────────────────────────────────────────

export default async function queueRoutes(fastify: FastifyInstance) {
  const { redis } = fastify;
  const CAPACITY = config.MAX_CAPACITY;
  const TICKET_TTL = config.TICKET_TTL_SECONDS;

  /**
   * POST /api/queue/join
   * 수용 가능 인원이 남아있고 대기열이 비어있으면 BYPASS, 아니면 WAIT
   */
  fastify.post<{ Reply: JoinBypassResponse | JoinWaitResponse }>('/api/queue/join', { schema: joinSchema }, async (_request, reply) => {
    const [activeCount, waitCount] = await Promise.all([
      redis.scard(REDIS_KEYS.ACTIVE_USERS),
      redis.zcard(REDIS_KEYS.WAIT_QUEUE),
    ]);

    // 즉시 입장 (Bypass)
    if (activeCount < CAPACITY && waitCount === 0) {
      const ticketId = randomUUID();
      const token = fastify.jwt.sign({ ticketId, scope: 'entrance' });
      await redis.sadd(REDIS_KEYS.ACTIVE_USERS, ticketId);

      return reply.send({ status: QueueStatus.BYPASS, token });
    }

    // 대기열 편입
    const ticketId = randomUUID();
    const joinTime = Date.now();

    await redis.pipeline()
      .zadd(REDIS_KEYS.WAIT_QUEUE, joinTime, ticketId)
      .set(REDIS_KEYS.ticketKey(ticketId), String(joinTime), 'EX', TICKET_TTL)
      .exec();

    const rawPosition = await redis.zrank(REDIS_KEYS.WAIT_QUEUE, ticketId);
    const position = rawPosition !== null ? rawPosition + 1 : -1;

    return reply.send({ status: QueueStatus.WAIT, ticketId, position });
  });

  /**
   * GET /api/queue/status
   * 대기 중인 사용자의 순번을 갱신하거나 입장 준비 상태를 반환
   */
  fastify.get<{ Reply: StatusReadyResponse | StatusWaitingResponse | ErrorResponse }>(
    '/api/queue/status',
    { schema: statusSchema },
    async (request, reply) => {
      const ticketId = request.cookies.ticketId;

      if (!ticketId) {
        return reply.status(400).send({ error: 'ticketId is required' });
      }

      // 활성 사용자(입장 허용) 목록에 존재하는지 최우선 확인
      const isReady = await redis.sismember(REDIS_KEYS.ACTIVE_USERS, ticketId);
      if (isReady) {
        const token = fastify.jwt.sign({ ticketId, scope: 'entrance' });
        reply.setCookie('access_token', token, {
          path: '/',
          httpOnly: true,
          secure: config.IS_PRODUCTION,
          sameSite: 'lax',
        });
        return reply.send({ status: QueueStatus.READY, token, destination: config.DESTINATION_URL });
      }

      // 대기열 위치 조회
      const rawPosition = await redis.zrank(REDIS_KEYS.WAIT_QUEUE, ticketId);
      if (rawPosition === null) {
        return reply.status(404).send({ error: 'Ticket not found or expired' });
      }

      // 하트비트: TTL 연장
      await redis.expire(REDIS_KEYS.ticketKey(ticketId), TICKET_TTL);

      return reply.send({ status: QueueStatus.WAITING, position: rawPosition + 1 });
    },
  );
}
