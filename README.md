<div align="center">
  <h1>wating-room</h1>
  <p><strong>A high-performance queueing solution built on Bun, Fastify, and Redis to protect your backend from traffic spikes.</strong></p>
</div>

---

## 🚀 Overview

**wating-room**는 초당 수만 건의 갑작스러운 트래픽 폭주(Spike) 상황에서 백엔드 서버를 다운타임으로부터 보호하고, 사용자에게 공정한 선착순(FIFO) 접속 경험을 제공하는 초고성능 대기열 시스템입니다.

Node.js 대신 [Bun](https://bun.sh/) 런타임을 채택하고, [Fastify](https://fastify.dev/) 프레임워크와 인메모리 데이터 저장소인 [Redis](https://redis.io/)를 활용 결합하여 극단적인 지연 시간 최소화(Low Latency)와 높은 동시 접속 처리를 달성했습니다. 단일 인스턴스 기준 10,000명 단위의 동시 Polling 트래픽을 거뜬히 견딜 수 있습니다.

## 🌟 Key Features

- **능동적인 트래픽 제어 (Active Capacity Control)**: 연결된 목적지 서버의 한계치(Capacity)를 설정하고, 초과된 트래픽을 가상 대기열 구조로 안전하게 바이패스/격리합니다.
- **실시간 대기 순번 부여 (Real-time Polling API)**: Redis의 Sorted Set 데이터 구조를 활용하여 O(logN) 속도로 1초 미만마다 사용자의 정확한 대기 순번을 응답합니다.
- **안전한 보안 토큰 발급 (JWT)**: 순서가 도달해 입장 가능한 사용자에게 비대칭/대칭 서명된 JWT 토큰을 발급하여 우회 접속(Bypass Attack)을 차단합니다.
- **자동 이탈 관리 스케줄러 (GC)**: 네트워크 단절이나 브라우저 닫힘으로 인해 Polling을 멈춘 허수 대기자를 능동적으로 찾아내어 제거합니다 (Garbage Collection).
- **Rate-limiting 기본 내장**: 악의적 목적의 과열된 F5(새로고침) 및 DDOS를 막기 위한 라우팅 레벨의 방어 로직이 적용되어 있습니다.

## 🛠 Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Framework**: [Fastify](https://fastify.dev) (TypeScript)
- **Database**: [Redis](https://redis.io) (`ioredis`)
- **Container**: [Docker & Docker Compose](https://www.docker.com/)

---

## 🏃 Getting Started

### Prerequisites

이 프로젝트를 로컬에서 실행하려면 **Bun** 및 **Redis**(또는 Docker)가 설치되어 있어야 합니다.

```bash
# Bun 설치 가이드
curl -fsSL https://bun.sh/install | bash
```

### Installation

1. 저장소를 클론합니다.
```bash
git clone https://github.com/your-username/wating-room.git
cd wating-room
```

3. `.env.sample`을 참고하여 `.env` 파일을 복사하고 환경에 맞게 값을 수정합니다.
```bash
cp .env.sample .env
```

### Environment Variables

프로젝트를 실행하려면 다음 환경 변수들이 설정되어야 합니다:

| Variable | Default Value | Description |
|----------|---------------|-------------|
| `PORT` | 3000 | Fastify 애플리케이션이 구동될 포트 |
| `REDIS_URL` | redis://localhost:6379 | 대기열 및 세션을 저장할 Redis 주소 |
| `MAX_CAPACITY` | 10000 | 한 번에 목적지 서버로 바이패스(허용)할 수 있는 최대 동시 접속자 수 |
| `JWT_SECRET` | super_secret_key... | 목적지 진입이 허가된 사용자에게 발급할 JWT 서명용 비밀키 |

4. 의존성을 설치합니다.
```bash
bun install
```

### Run Locally (Development)

로컬에 설치된 Redis 노드가 동작 중인 상태에서 다음 명령어를 실행합니다.

```bash
bun run dev
```

### Run with Docker Compose (Production Recommended)

Docker가 설치된 환경에서는 손쉽게 Redis와 애플리케이션을 하나로 묶어 동작시킬 수 있습니다.

```bash
docker-compose up -d --build
```
- 서버는 `http://localhost:3000`에서 실행됩니다.

---

## 📚 API References

### 1. 큐 진입하기 (`POST /api/queue/join`)
사용자가 목적지 서비스에 진입하기 직전에 처음 호출합니다. 

- **응답 (즉시 진입이 가능할 때)**:
  ```json
  {
    "status": "BYPASS",
    "token": "eyJhbG..." // 사용자를 대상 서버로 통과시킬 JWT 토큰
  }
  ```
- **응답 (대기열에 갇혔을 때)**:
  ```json
  {
    "status": "WAIT",
    "ticketId": "aa11-bb22-cc33",
    "position": 125 // 현재 125번째 대기 중
  }
  ```

### 2. 큐 상태 확인 (`GET /api/queue/status?ticketId={ticketId}`)
대기 중인 클라이언트가 3~5초 주기로 Polling 호출하여 순번을 갱신합니다.

- **응답 (여전히 대기 중일 때)**:
  ```json
  {
    "status": "WAITING",
    "position": 85 // 앞쪽 사람들이 빠져 85번째로 줄어듦
  }
  ```
- **응답 (내 순서가 되었을 때)**:
  ```json
  {
    "status": "READY",
    "token": "eyJhbG..." // 목적지 입장 토큰 발급 완료
  }
  ```

### 3. 목적지 서버에서의 토큰 검증 (Destination Verification)
대기열을 통과(Bypass 또는 Ready)하여 응답받은 사용자는 획득한 `token`을 지참하여 본래의 목적지 서버(회원가입, 수강신청 등 실제 트래픽이 몰리는 곳)로 이동해야 합니다. 

목적지 서버는 비정상적인 우회 접속(대기열을 서지 않고 바로 들어온 요청)을 차단하기 위해 **JWT 검증**을 수행해야 합니다.

1. **토큰 전달 방식**: 클라이언트가 목적지 API 호출 시 헤더(예: `Authorization: Bearer <token>`)나 쿼리 스트링에 토큰을 포함시킵니다.
2. **검증 로직**: 목적지 서버는 대기열 서버와 동일한 `JWT_SECRET`을 공유하고 있어야 합니다. (만약 비대칭 키를 사용하도록 코드를 수정했다면 공개키로 검증)
3. **만료시간 (Expiration)**: 토큰에는 약 5분 정도의 매우 짧은 만료 시간이 설정되어 있습니다. (코드 상 `expiresIn: '5m'`). 따라서 재활용 공격 방지를 위해 목적지 서버는 만료된 토큰의 접근을 단호히 거부해야 합니다.

---

## 🧪 Testing

강력한 부하를 직접 시뮬레이션 해볼 수 있는 자체 로드 테스트 스크립트가 내장되어 있습니다. 약 12,000명의 동시 접속자를 발생시켜 병목을 테스트합니다.

```bash
# Redis 및 Web 서버 구동 상태에서 다른 터미널에 실행
bun run test:load
```

---

## 📂 Project Architecture

```
wating-room/
├── src/
│   ├── config/      # 환경변수 로더 등 전역 설정
│   ├── plugins/     # Fastify 기반 Redis 매니저 통합
│   ├── routes/      # 진입/폴링 API 정의
│   ├── scheduler/   # 입장 및 이탈을 처리하는 백그라운드 Worker
│   └── index.ts     # 부트스트랩 및 로거, JWT 셋업
├── tests/           # 스트레스 테스트 스크립트
├── docs/            # 기술 및 요구사항 명세서 (PRD / Tech Specs)
└── docker-compose.yml 
```

---

## 🤝 Contributing

언제나 이슈 등록, 버그 리포트, Pull Request 등 다양한 기여를 환영합니다. 코드 퀄리티를 유지하기 위해 PR 전에 린터 검사를 진행해 주시기 바랍니다.

## 📄 License

이 프로젝트는 [MIT License](LICENSE)의 규정을 따릅니다. 오픈소스로서 자유롭게 서비스에 복제, 수정 및 적용할 수 있습니다.
