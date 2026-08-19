/**
 * Test bootstrap.
 *
 * Points every test at blob_test, runs migrations once, and gives each test file a
 * clean slate. Tests run against real Postgres and Redis — the behaviour worth
 * testing here (idempotent inserts, unread math, permission joins) lives in SQL, and
 * a mock would only prove the mock works.
 */

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://blob:blob@localhost:5432/blob_test';
process.env.REDIS_URL ??= 'redis://localhost:6379/15';
process.env.SESSION_SECRET ??= 'test-secret-that-is-at-least-32-characters-long';
process.env.PUBLIC_URL ??= 'http://localhost:5173';
process.env.SMTP_HOST ??= 'localhost';
process.env.SMTP_PORT ??= '1025';
