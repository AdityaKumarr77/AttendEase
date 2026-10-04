import { test } from 'node:test';
import assert from 'node:assert';
import { escapeCsvCell, hashPassword, verifyPassword } from '../src/index';
import { getDriveConfig, resetDriveCache } from '../src/drive';

test('Password hashing and verification', () => {
  const password = 'mySecretPassword123';
  const { salt, hash } = hashPassword(password);

  assert.ok(salt.length > 0, 'Salt should not be empty');
  assert.ok(hash.length > 0, 'Hash should not be empty');

  assert.strictEqual(verifyPassword(password, salt, hash), true, 'Valid password must verify');
  assert.strictEqual(verifyPassword('wrongPassword', salt, hash), false, 'Wrong password must fail');
  assert.strictEqual(verifyPassword(password, 'corruptedSalt', hash), false, 'Corrupted salt must fail');
});

test('CSV Cell Escaping and Formula Injection Mitigation', () => {
  // Safe string
  assert.strictEqual(escapeCsvCell('John Doe'), '"John Doe"');

  // Quotes inside
  assert.strictEqual(escapeCsvCell('John "Ace" Doe'), '"John ""Ace"" Doe"');

  // Formula injection with '='
  assert.strictEqual(escapeCsvCell('=cmd|"/C calc"!A0'), '"\'=cmd|""/C calc""!A0"');

  // Formula injection with '+'
  assert.strictEqual(escapeCsvCell('+123456789'), '"\'+123456789"');

  // Formula injection with '-'
  assert.strictEqual(escapeCsvCell('-2+3'), '"\'-2+3"');

  // Formula injection with '@'
  assert.strictEqual(escapeCsvCell('@SUM(1,2)'), '"\'@SUM(1,2)"');

  // Formula injection with tab '\t'
  assert.strictEqual(escapeCsvCell('\tMalicious'), '"\'\tMalicious"');

  // Formula injection with CR '\r'
  assert.strictEqual(escapeCsvCell('\rMalicious'), '"\'\rMalicious"');

  // Null and undefined
  assert.strictEqual(escapeCsvCell(null), '""');
  assert.strictEqual(escapeCsvCell(undefined), '""');

  // Numbers
  assert.strictEqual(escapeCsvCell(42), '"42"');
});

test('Google Drive configuration detection', () => {
  const oldClientId = process.env.GOOGLE_CLIENT_ID;
  const oldClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const oldRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  try {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;
    resetDriveCache();
    assert.strictEqual(getDriveConfig().isConfigured, false, 'Should be unconfigured when vars are missing');

    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    assert.strictEqual(getDriveConfig().isConfigured, false, 'Should be unconfigured when only client ID is set');

    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    assert.strictEqual(getDriveConfig().isConfigured, false, 'Should be unconfigured when refresh token is missing');

    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
    assert.strictEqual(getDriveConfig().isConfigured, true, 'Should be configured when all 3 vars are set');
  } finally {
    if (oldClientId) process.env.GOOGLE_CLIENT_ID = oldClientId; else delete process.env.GOOGLE_CLIENT_ID;
    if (oldClientSecret) process.env.GOOGLE_CLIENT_SECRET = oldClientSecret; else delete process.env.GOOGLE_CLIENT_SECRET;
    if (oldRefreshToken) process.env.GOOGLE_REFRESH_TOKEN = oldRefreshToken; else delete process.env.GOOGLE_REFRESH_TOKEN;
    resetDriveCache();
  }
});
