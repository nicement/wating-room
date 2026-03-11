/**
 * Queue Status Enum
 * API 응답에 포함되는 대기열 상태값을 타입-세이프하게 관리합니다.
 */
export const QueueStatus = {
  BYPASS: 'BYPASS',
  WAIT: 'WAIT',
  READY: 'READY',
  WAITING: 'WAITING',
} as const;

export type QueueStatusType = (typeof QueueStatus)[keyof typeof QueueStatus];

/**
 * API Response Interfaces
 */
export interface JoinBypassResponse {
  status: typeof QueueStatus.BYPASS;
  token: string;
}

export interface JoinWaitResponse {
  status: typeof QueueStatus.WAIT;
  ticketId: string;
  position: number;
}

export type JoinResponse = JoinBypassResponse | JoinWaitResponse;

export interface StatusReadyResponse {
  status: typeof QueueStatus.READY;
  token: string;
  destination: string;
}

export interface StatusWaitingResponse {
  status: typeof QueueStatus.WAITING;
  position: number;
}

export interface ErrorResponse {
  error: string;
}
