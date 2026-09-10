import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function startApi(dataDir, port, overrides = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
      ORIGIN: 'https://gym.example.test',
      RP_ID: 'gym.example.test',
      RP_NAME: 'quietGym test',
      INVITE_ONLY: 'true',
      SESSION_DAYS: '30',
      WEBAUTHN_USER_VERIFICATION: 'required',
      AUTH_RATE_LIMIT_MAX: '2',
      AUTH_RATE_LIMIT_WINDOW_SECONDS: '60',
      VAPID_SUBJECT: 'mailto:admin@example.test',
      ...overrides
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });

  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`API did not start\nstdout: ${stdout}\nstderr: ${stderr}`)), 10000);
    const inspect = () => {
      if (!stdout.includes('gym-api on ')) return;
      clearTimeout(timeout);
      resolve();
    };
    child.stdout.on('data', inspect);
    child.once('exit', code => {
      if (!stdout.includes('gym-api on ')) {
        clearTimeout(timeout);
        reject(new Error(`API exited with ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    });
  });

  return { child, ready, output: () => ({ stdout, stderr }) };
}

async function stopApi(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise(resolve => child.once('exit', resolve));
}

test('production HTTP protections work end to end', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quietgym-api-'));
  const port = await freePort();
  const api = startApi(dataDir, port);
  t.after(async () => {
    await stopApi(api.child);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await api.ready;

  assert.equal(fs.existsSync(path.join(dataDir, 'secret')), true);
  assert.equal(fs.existsSync(path.join(dataDir, 'vapid.json')), true);

  const base = `http://127.0.0.1:${port}`;
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await health.json(), { ok: true });

  const missingOrigin = await fetch(`${base}/api/login/options`, { method: 'POST' });
  assert.equal(missingOrigin.status, 403);

  const wrongOrigin = await fetch(`${base}/api/login/options`, {
    method: 'POST',
    headers: { Origin: 'https://evil.example.test' }
  });
  assert.equal(wrongOrigin.status, 403);

  const validRequest = () => fetch(`${base}/api/login/options`, {
    method: 'POST',
    headers: { Origin: 'https://gym.example.test' }
  });
  const firstValid = await validRequest();
  assert.equal(firstValid.status, 200);
  assert.equal((await firstValid.json()).options.userVerification, 'required');
  assert.equal((await validRequest()).status, 200);
  const limited = await validRequest();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
});

test('a corrupt database stops startup instead of being replaced', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quietgym-corrupt-'));
  fs.writeFileSync(path.join(dataDir, 'db.json'), '{not-json');
  const port = await freePort();
  const api = startApi(dataDir, port);
  const startupResult = api.ready.catch(error => error);
  t.after(async () => {
    await stopApi(api.child);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const result = await new Promise(resolve => {
    const timeout = setTimeout(() => resolve({ timedOut: true, code: null }), 10000);
    api.child.once('exit', code => {
      clearTimeout(timeout);
      resolve({ timedOut: false, code });
    });
  });
  assert.equal(result.timedOut, false);
  assert.notEqual(result.code, 0);
  assert.equal((await startupResult) instanceof Error, true);
  assert.match(api.output().stderr, /Cannot read database/);
  assert.equal(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'), '{not-json');
});
