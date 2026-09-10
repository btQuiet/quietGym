#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../password.js';

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argIndex = process.argv.indexOf('--data-dir');
if (argIndex !== -1 && !process.argv[argIndex + 1]) {
  console.error('Usage: npm run password:set -- --data-dir /var/lib/quietgym');
  process.exit(1);
}
const dataDir = path.resolve(argIndex === -1
  ? (process.env.DATA_DIR || path.join(apiDir, '..', 'data'))
  : process.argv[argIndex + 1]);

function readSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('an interactive terminal is required');

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\u0003') return finish(new Error('cancelled'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') value = [...value].slice(0, -1).join('');
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

function readDatabase(file) {
  if (!fs.existsSync(file)) return { users: [], subs: [] };
  let db;
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`cannot read ${file}: ${error.message}`); }
  if (!db || !Array.isArray(db.users) || !Array.isArray(db.subs || []))
    throw new Error(`${file} has an invalid structure`);
  if (db.users.length > 1)
    throw new Error('refusing to choose between multiple existing users');
  db.subs ??= [];
  return db;
}

function atomicWrite(file, content) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, content, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

try {
  const first = await readSecret(`New password (minimum ${MIN_PASSWORD_LENGTH} characters): `);
  const second = await readSecret('Repeat password: ');
  if (first !== second) throw new Error('passwords do not match');

  const password = await hashPassword(first);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const dbFile = path.join(dataDir, 'db.json');
  const db = readDatabase(dbFile);
  const previous = db.users[0];
  const owner = previous
    ? { ...previous, password, sv: (previous.sv || 0) + 1 }
    : { id: 'owner', created: new Date().toISOString(), sv: 0, password };

  delete owner.name;
  delete owner.admin;
  delete owner.disabled;
  delete owner.invitedBy;
  db.users = [owner];
  delete db.creds;
  delete db.invites;
  atomicWrite(dbFile, JSON.stringify(db, null, 2));
  console.log(previous
    ? `Owner password updated in ${dbFile}. Existing sessions were revoked.`
    : `Owner password created in ${dbFile}.`);
} catch (error) {
  console.error(`Password not changed: ${error.message}`);
  process.exitCode = 1;
}
