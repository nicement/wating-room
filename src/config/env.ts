import 'dotenv/config';

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  /** Server */
  PORT: Number(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DESTINATION_URL: process.env.DESTINATION_URL || 'https://naver.com',
  IS_PRODUCTION: isProduction,

  /** Redis */
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  /** Queue */
  MAX_CAPACITY: Number(process.env.MAX_CAPACITY) || 10_000,

  /** JWT */
  JWT_SECRET: process.env.JWT_SECRET || 'secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '5m',

  /** Rate Limiting */
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX) || 100,
  RATE_LIMIT_WINDOW: process.env.RATE_LIMIT_WINDOW || '1 minute',

  /** Scheduler */
  ADMISSION_INTERVAL_MS: Number(process.env.ADMISSION_INTERVAL_MS) || 1_000,
  GC_INTERVAL_MS: Number(process.env.GC_INTERVAL_MS) || 5_000,
  GC_SCAN_COUNT: Number(process.env.GC_SCAN_COUNT) || 100,

  /** Ticket */
  TICKET_TTL_SECONDS: Number(process.env.TICKET_TTL_SECONDS) || 60,
} as const;

/** 프로덕션 환경에서 기본 JWT 시크릿 사용 시 경고 */
if (isProduction && config.JWT_SECRET === 'secret') {
  console.warn(
    '⚠️  [SECURITY] JWT_SECRET is using the default value. ' +
    'Set a strong, unique secret via the JWT_SECRET environment variable before deploying to production.'
  );
}
