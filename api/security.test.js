import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clientIp,
  createFixedWindowRateLimiter,
  isLoopbackAddress,
  requestOriginAllowed,
  validateRuntimeConfig
} from './security.js';

const productionConfig = {
  production: true,
  host: '127.0.0.1',
  allowNonLoopback: false,
  port: 3000,
  dataDir: '/var/lib/quietgym',
  origin: 'https://gym.example.com',
  rpId: 'gym.example.com',
  vapidSubject: 'mailto:admin@example.com',
  userVerification: 'required',
  sessionDays: 90,
  authRateLimitMax: 30,
  authRateLimitWindowSeconds: 300
};

test('accepts a hardened production configuration', () => {
  assert.doesNotThrow(() => validateRuntimeConfig(productionConfig));
});

test('rejects public binding, HTTP and optional user verification in production', () => {
  assert.throws(
    () => validateRuntimeConfig({
      ...productionConfig,
      host: '0.0.0.0',
      origin: 'http://gym.example.com',
      userVerification: 'preferred'
    }),
    error => {
      assert.match(error.message, /loopback/);
      assert.match(error.message, /HTTPS/);
      assert.match(error.message, /must be "required"/);
      return true;
    }
  );
});

test('allows an explicit non-loopback bind for an isolated container network', () => {
  assert.doesNotThrow(() => validateRuntimeConfig({
    ...productionConfig,
    host: '0.0.0.0',
    allowNonLoopback: true
  }));
});

test('rejects an RP ID unrelated to the public origin', () => {
  assert.throws(
    () => validateRuntimeConfig({ ...productionConfig, rpId: 'unrelated.example' }),
    /RP_ID must equal ORIGIN hostname/
  );
});

test('requires an exact Origin on unsafe production requests', () => {
  const expected = productionConfig.origin;
  assert.equal(requestOriginAllowed('GET', undefined, expected, true), true);
  assert.equal(requestOriginAllowed('POST', undefined, expected, true), false);
  assert.equal(requestOriginAllowed('PUT', 'https://evil.example', expected, true), false);
  assert.equal(requestOriginAllowed('POST', expected, expected, true), true);
  assert.equal(requestOriginAllowed('POST', undefined, expected, false), true);
});

test('uses a proxy address only when the direct peer is loopback', () => {
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(clientIp('127.0.0.1', '198.51.100.1, 203.0.113.8'), '203.0.113.8');
  assert.equal(clientIp('192.0.2.10', '203.0.113.8'), '192.0.2.10');
  assert.equal(clientIp('127.0.0.1', 'not-an-ip'), '127.0.0.1');
});

test('rate limiter blocks a key until its window expires', () => {
  let clock = 1000;
  const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 5000, now: () => clock });

  assert.deepEqual(limiter.check('client').allowed, true);
  assert.deepEqual(limiter.check('client').remaining, 0);
  assert.deepEqual(limiter.check('client').allowed, false);

  clock = 6000;
  assert.deepEqual(limiter.check('client').allowed, true);
});
