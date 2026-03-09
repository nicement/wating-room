# Tech Spec: 대기열 시스템 (Queueing Solution)

## 1. 개요 (Overview)
본 문서는 트래픽 폭주 시 백엔드 시스템을 보호하고 사용자에게 순차적인 접속을 보장하는 대기열 시스템의 기술 명세서(Tech Spec)입니다. 높은 동시성 처리와 낮은 지연 시간을 달성하기 위해 **Node.js + Fastify** 프레임워크와 인메모리 데이터 저장소인 **Redis**를 기반으로 설계되었습니다.

## 2. 기술 스택 (Technology Stack)
- **런타임 / 프레임워크**: Bun / Fastify
  - 선택 이유: Node.js 대비 압도적으로 빠른 비동기 I/O 처리 및 встроенный HTTP 서버 속도로 대규모 Polling 트래픽 처리에 적합. Fastify와의 결합도 성능이 매우 우수함.
- **데이터베이스 (In-Memory)**: Redis
  - 선택 이유: 싱글 스레드 기반의 원자적 연산(Atomic Operations)을 통해 동시성 이슈 없이 대기열 순번과 활성 세션을 초고속으로 관리.
- **인증/토큰**: JWT (JSON Web Tokens) 또는 Hmac 기반 서명 토큰
  - 선택 이유: 목적지 시스템 진입 시 위변조 방지를 위해 상태를 저장하지 않는(Stateless) 토큰 검증 방식 사용.

## 3. 시스템 아키텍처 (System Architecture)
```text
[ Client (Browser) ]
       │  (Polling / REST API)
       ▼
[ Load Balancer / Nginx ] (선택적 스케일 아웃을 위함)
       │
       ▼
[ Fastify Server (대기열 API) ] ───────── [ Destination Server (목적지) ]
       │                                     ▲
       ▼                                     │ (토큰 검증)
[ Redis (Queue & State Store) ] ─────────────┘
```

## 4. 데이터 모델 (Redis 자료구조)

Redis를 활용하여 대기열과 활성 사용자 상태를 관리합니다.

1. **활성 사용자(Active Users) 현황**
   - **Key**: `system:active_users` (Set 또는 Sorted Set)
   - **설명**: 현재 목적지 시스템에서 작업 중인(접속이 허용된) 사용자의 ID/티켓 목록.
   - 만료 시간(TTL)을 두거나 주기적인 Heartbeat를 통해 좀비 세션 제거.

2. **대기열 큐 (Waiting Queue)**
   - **Key**: `system:wait_queue` (Sorted Set - ZSET)
   - **Score**: 대기열 진입 시간 (Unix Timestamp + 밀리초)
   - **Value**: 대기 티켓 ID (UUID)
   - **설명**: 진입 시간에 따른 선착순(FIFO) 정렬 제공. `ZRank` 명령어를 통해 클라이언트의 현재 대기 순번을 O(log(N)) 시간에 즉시 조회 가능.

3. **티켓 상태 (Ticket State)**
   - **Key**: `ticket:{ticket_id}` (Hash 또는 String)
   - **설명**: 각 클라이언트의 마지막 Polling 시간을 기록(TTL 설정). 클라이언트가 이탈(창 닫기 등) 시 설정된 TTL이 만료되어 자동으로 대기열에서 삭제되도록 유도.

4. **설정값 (Configuration)**
   - **Key**: `config:max_capacity` (String/Integer)
   - **설명**: 목적지 시스템의 최대 허용 동시 접속자 수.

## 5. 핵심 API 명세 (API Specifications)

### 5.1 대기열 진입 (Join Queue)
- **Endpoint**: `POST /api/queue/join`
- **Description**: 서비스 진입 시 최초 호출. 활성 사용자 수와 수용 한도를 비교하여 즉시 진입 또는 대기열 등록을 결정.
- **Response**:
  - `status`: `"BYPASS"` (즉시 진입 가능) | `"WAIT"` (대기열 편입)
  - `ticketId`: 고유 대기 티켓 (status가 WAIT인 경우)
  - `token`: 진입용 접속 토큰 (status가 BYPASS인 경우)

### 5.2 대기열 상태 확인 (Polling Status)
- **Endpoint**: `GET /api/queue/status`
- **Query Params**: `ticketId={uuid}`
- **Description**: 클라이언트가 주기적(예: 3초)으로 호출하여 자신의 대기 순번을 확인. 호출 시 Redis의 해당 티켓 TTL(마지막 활동 시간)을 연장.
- **Response**:
  - `status`: `"WAITINTG"` | `"READY"`
  - `position`: 현재 대기열 내 순번 (status가 WAITING인 경우)
  - `token`: 목적지 시스템 진입을 위한 접속 토큰 (status가 READY인 경우)

## 6. 핵심 설계 로직 (Core Logic & Workflow)

1. **상태 갱신 및 순번 체크 (Polling Handle)**
   - 클라이언트 시스템이 `status` API 호출.
   - Fastify 서버는 `redis.zrank('system:wait_queue', ticketId)`를 실행하여 클라이언트의 번호를 획득. 반환된 Index를 통해 `position` 응답.
   - 동시에 `ticket:{ticket_id}`의 TTL을 연장(예: 10초)하여 연결 유지 상태 기록.

2. **접속 허가 스케줄러 (Admission Controller)**
   - 백그라운드 워커(또는 Polling API 호출 시 트리거되는 Lazy Logic)가 지속적으로 여유 공간 체크.
   - `여유 공간 = max_capacity - active_users_count`
   - 여유 공간이 발생하면, `ZPOPMIN` 명령어로 `wait_queue`의 맨 앞 사용자들을 추출하여 `active_users`로 이동시키고, 해당 티켓의 상태를 `READY`로 변경 및 접속 토큰 발급.

3. **이탈자 관리 (Cleanup / Eviction)**
   - 브라우저를 닫거나 네트워크가 끊겨 Polling을 멈춘 사용자는 `ticket:{ticket_id}`의 TTL이 만료됨.
   - 주기적(예: 1분)으로 실행되는 정리(Garbage Collection) 로직이 대기열(`wait_queue`)에서 TTL이 만료되거나 존재하지 않는 티켓을 삭제하여 허수 대기자 제거.

## 7. 보안 및 유효성 검증 (Security & Validation)
- **목적지 서버의 토큰 검증**: 목적지 시스템은 대기열 시스템이 발급한 토큰(JWT 등)을 헤더에서 검사하여, 유효한 토큰일 경우에만 서비스를 제공합니다. 토큰에는 짧은 만료 시간(예: 1~3분)을 설정하여 재사용을 방지합니다.
- **Rate Limiting**: 악의적인 잦은 Polling 요청을 막기 위해 Fastify 플러그인(`@fastify/rate-limit`)을 활용하여 IP 또는 티켓당 API 호출 횟수를 제한합니다.

## 8. 단일 인스턴스 1만 동시 접속(CCU) 처리 방안 (Performance Tuning)

단일 인스턴스에서 1만 명 이상의 동시 접속을 안정적으로 처리하기 위해 다음과 같은 최적화 기법을 적용합니다.

1. **Bun 런타임 도입의 효과**
   - Bun의 네이티브 네트워크 I/O 및 빠른 JS 엔진 덕분에 수많은 클라이언트의 동시 Polling 시 Node.js보다 훨씬 더 나은 지연 시간(Latency)과 초당 처리량(RPS)을 보입니다.
2. **OS 커널 파라미터 최적화 (File Descriptors)**
   - 리눅스 등 OS에서 프로세스당 열 수 있는 최대 파일 개수(`ulimit -n`) 기본값(보통 1024)을 65535 이상으로 대폭 상향 설정하여 1만 개 이상의 동시 TCP 소켓 연결을 수용합니다.
3. **HTTP Keep-Alive 설정 활성화**
   - 수많은 클라이언트가 3~5초마다 Polling을 할 때 3-Way Handshake 비용을 아끼기 위해 HTTP Keep-Alive(`Connection: keep-alive`) 연결 풀링을 최대한 유지합니다.
4. **로깅 오버헤드 최소화**
   - 초당 수천~수만 건의 인입 시 불필요한 콘솔 출력을 제한하고 Fastify 내장 고성능 로거인 `pino`를 활용하되 로그 출력을 극도로 최소화합니다.
5. **Redis 커넥션 효율화 (Pipelining / Connection Pool)**
   - `ioredis` 등을 사용하여 Redis 커넥션 풀을 캐싱하고 여러 티켓의 갱신을 Pipelining으로 그룹화하여 네트워크 RTT 비용을 아낍니다.
