import { config } from '../src/config/env';

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────

const TOTAL_USERS = 12_000;
const BATCH_SIZE = 2_000; // 커넥션 풀 고갈 방지를 위해 배치 단위로 전송
const API_URL = `http://127.0.0.1:${config.PORT}`;

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface TestResult {
  bypassed: number;
  waiting: number;
  errors: number;
  rateLimited: number;
}

// ──────────────────────────────────────────────
// Core
// ──────────────────────────────────────────────

async function joinQueue(): Promise<'BYPASS' | 'WAIT' | 'RATE_LIMITED' | 'ERROR'> {
  const res = await fetch(`${API_URL}/api/queue/join`, { method: 'POST' });

  if (res.status === 429) return 'RATE_LIMITED';
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const body = (await res.json()) as { status: string };
  return body.status as 'BYPASS' | 'WAIT';
}

async function runBatch(size: number, result: TestResult): Promise<void> {
  const tasks = Array.from({ length: size }, async () => {
    try {
      const status = await joinQueue();
      switch (status) {
        case 'BYPASS':      result.bypassed++; break;
        case 'WAIT':        result.waiting++; break;
        case 'RATE_LIMITED': result.rateLimited++; break;
      }
    } catch {
      result.errors++;
    }
  });

  await Promise.all(tasks);
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  console.log(`🚀 Starting load test: ${TOTAL_USERS} users (batch size: ${BATCH_SIZE})\n`);

  const result: TestResult = { bypassed: 0, waiting: 0, errors: 0, rateLimited: 0 };
  const startTime = Date.now();

  // 배치 단위로 점진 전송
  for (let offset = 0; offset < TOTAL_USERS; offset += BATCH_SIZE) {
    const currentBatch = Math.min(BATCH_SIZE, TOTAL_USERS - offset);
    await runBatch(currentBatch, result);
    process.stdout.write(`  ✓ Batch ${Math.floor(offset / BATCH_SIZE) + 1} complete (${offset + currentBatch}/${TOTAL_USERS})\n`);
  }

  const duration = ((Date.now() - startTime) / 1_000).toFixed(2);

  console.log('\n============= TEST RESULT =============');
  console.log(`⏱  Time taken   : ${duration}s`);
  console.log(`✅ Bypassed     : ${result.bypassed}`);
  console.log(`⏳ Waiting      : ${result.waiting}`);
  console.log(`🚫 Rate Limited : ${result.rateLimited}`);
  console.log(`❌ Errors       : ${result.errors}`);
  console.log('=======================================\n');
}

main();
