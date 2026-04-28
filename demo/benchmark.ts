/**
 * Benchmark: ApiExecutor vs WebExecutor (Playwright)
 *
 * Spins up a lightweight mock API server and runs equivalent flows through
 * both executors N times, printing a timing comparison.
 *
 * Usage:
 *   npx tsx demo/benchmark.ts [--runs N]
 */
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { parseArgs } from 'util';
import { chromium } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import { ApiExecutor, applyLisaDbMigrations } from '../dist/index.js';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { runs: { type: 'string', default: '10' } },
});

const RUNS = Math.max(1, parseInt(values.runs as string, 10) || 10);

// ---------------------------------------------------------------------------
// Mock API server
// ---------------------------------------------------------------------------

interface MockUser {
  id: string;
  email: string;
  token: string;
  tasks: { id: string; title: string; done: boolean }[];
}

const USERS: Record<string, MockUser> = {
  'demo@example.com': {
    id: 'user-001',
    email: 'demo@example.com',
    token: 'tok-abc123',
    tasks: [
      { id: 't1', title: 'Build feature', done: false },
      { id: 't2', title: 'Write tests', done: false },
    ],
  },
};

function startMockApiServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'POST' && req.url === '/auth/login') {
          const { email } = JSON.parse(body || '{}');
          const user = USERS[email];
          if (user) {
            res.writeHead(200);
            res.end(JSON.stringify({ token: user.token }));
          } else {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'Unauthorized' }));
          }
          return;
        }

        if (req.method === 'GET' && req.url === '/api/tasks') {
          const auth = req.headers['authorization'] ?? '';
          const token = auth.replace('Bearer ', '');
          const user = Object.values(USERS).find((u) => u.token === token);
          if (user) {
            res.writeHead(200);
            res.end(JSON.stringify({ tasks: user.tasks }));
          } else {
            res.writeHead(401);
            res.end(JSON.stringify({ error: 'Unauthorized' }));
          }
          return;
        }

        if (req.method === 'POST' && req.url?.startsWith('/api/tasks/') && req.url.endsWith('/complete')) {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        url,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

async function runApiFlow(baseUrl: string, dbPath: string): Promise<number> {
  const start = Date.now();
  const api = new ApiExecutor({
    baseUrl,
    dbPath,
    simulationId: 'bench-sim',
    agentId: 'bench-agent',
  });
  await api.login('/auth/login', { email: 'demo@example.com', password: 'pass' });
  await api.get('/api/tasks');
  await api.post('/api/tasks/t1/complete');
  await api.post('/api/tasks/t2/complete');
  api.flush();
  return Date.now() - start;
}

async function runBrowserFlow(appDir: string): Promise<number> {
  const start = Date.now();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Load login page, fill form, navigate to dashboard, load profile
  await page.goto(`file://${appDir}/login.html`);
  await page.waitForSelector('[data-testid="login-title"]');
  await page.fill('[data-testid="login-email"]', 'demo@example.com');
  await page.fill('[data-testid="login-password"]', 'password');
  await page.goto(`file://${appDir}/dashboard.html`);
  await page.waitForSelector('[data-testid="task-list"]');
  await page.goto(`file://${appDir}/profile.html`);
  await page.waitForSelector('[data-testid="profile-title"]');
  await browser.close();
  return Date.now() - start;
}

async function main() {
  const appDir = path.join(__dirname, 'app');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fab-bench-'));
  const dbPath = path.join(tmpDir, 'lisa.db');
  applyLisaDbMigrations(new BetterSqlite3(dbPath));

  const server = await startMockApiServer();
  console.log(`\nBenchmark: ${RUNS} runs each\n`);

  // --- ApiExecutor ---
  const apiTimes: number[] = [];
  process.stdout.write('ApiExecutor  ');
  for (let i = 0; i < RUNS; i++) {
    apiTimes.push(await runApiFlow(server.url, dbPath));
    process.stdout.write('.');
  }
  console.log();

  // --- Playwright ---
  const browserTimes: number[] = [];
  process.stdout.write('Playwright   ');
  for (let i = 0; i < RUNS; i++) {
    browserTimes.push(await runBrowserFlow(appDir));
    process.stdout.write('.');
  }
  console.log();

  await server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // --- Report ---
  const apiMedian   = median(apiTimes);
  const apiAvg      = avg(apiTimes);
  const brwMedian   = median(browserTimes);
  const brwAvg      = avg(browserTimes);
  const speedup     = brwMedian / apiMedian;

  console.log('\n┌─────────────────────────────────────────────┐');
  console.log('│           Executor Benchmark Results        │');
  console.log('├──────────────┬──────────────┬───────────────┤');
  console.log('│ Executor     │ Median (ms)  │  Avg (ms)     │');
  console.log('├──────────────┼──────────────┼───────────────┤');
  console.log(`│ ApiExecutor  │ ${pad(apiMedian)}    │ ${pad(apiAvg)}      │`);
  console.log(`│ Playwright   │ ${pad(brwMedian)}    │ ${pad(brwAvg)}      │`);
  console.log('├──────────────┴──────────────┴───────────────┤');
  console.log(`│ Speedup: ${speedup.toFixed(1)}x faster via ApiExecutor     │`);
  console.log('└─────────────────────────────────────────────┘\n');

  if (speedup < 3) {
    console.warn('⚠  Speedup < 3x — ApiExecutor may have overhead or Playwright is already fast on this machine.');
  }
}

function median(vals: number[]): number {
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function avg(vals: number[]): number {
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function pad(n: number): string {
  return String(n).padStart(6);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
