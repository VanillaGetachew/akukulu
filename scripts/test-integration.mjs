// Runs the API test suite including the PostgreSQL integration tests.
// Start the database first: `docker compose up -d postgres` (host port: POSTGRES_HOST_PORT, default 5432).
import { spawnSync } from 'node:child_process';

const port = process.env.POSTGRES_HOST_PORT ?? '5432';
const env = {
  ...process.env,
  TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? `postgres://akukulu:akukulu@127.0.0.1:${port}/akukulu_test`,
};
console.log(`Integration database: ${env.TEST_DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`);
const res = spawnSync('npm', ['run', 'test', '-w', '@akukulu/api'], { stdio: 'inherit', env, shell: true });
process.exit(res.status ?? 1);
