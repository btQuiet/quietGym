import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPassword,
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  validateNewPassword,
  validatePasswordRecord,
  verifyPassword
} from './password.js';

const password = 'correct horse battery staple';

test('Argon2id hashes and verifies a password without storing the plaintext', async () => {
  const record = await hashPassword(password);
  assert.equal(record.algorithm, 'argon2id');
  assert.equal(Buffer.from(record.salt, 'base64url').length, 16);
  assert.equal(JSON.stringify(record).includes(password), false);
  assert.equal(await verifyPassword(password, record), true);
  assert.equal(await verifyPassword('this is not the password', record), false);
});

test('the same password receives a fresh salt and hash', async () => {
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
});

test('new passwords have sensible length bounds', () => {
  assert.throws(() => validateNewPassword('x'.repeat(MIN_PASSWORD_LENGTH - 1)), /at least/);
  assert.throws(() => validateNewPassword('x'.repeat(MAX_PASSWORD_BYTES + 1)), /too long/);
});

test('unsafe stored work factors are rejected before hashing', async () => {
  const record = await hashPassword(password);
  assert.throws(() => validatePasswordRecord({ ...record, memory: 2 ** 30 }), /parameters/);
});
