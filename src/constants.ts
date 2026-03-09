/**
 * Redis Key Patterns
 * 모든 Redis 키를 중앙에서 관리하여 오타로 인한 런타임 버그를 원천 차단합니다.
 */
export const REDIS_KEYS = {
  ACTIVE_USERS: 'system:active_users',
  WAIT_QUEUE: 'system:wait_queue',
  ticketKey: (ticketId: string) => `ticket:${ticketId}` as const,
} as const;

/**
 * Scheduler Timing (ms)
 */
export const SCHEDULER = {
  ADMISSION_INTERVAL_MS: 1_000,
  GC_INTERVAL_MS: 5_000,
  GC_SCAN_COUNT: 100,
} as const;

/**
 * Ticket Defaults
 */
export const TICKET = {
  TTL_SECONDS: 60,
} as const;
