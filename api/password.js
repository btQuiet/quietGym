import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 5;
export const MAX_PASSWORD_BYTES = 1024;

// Deliberately above OWASP's current Argon2id minimum. These parameters are stored
// alongside the hash so they can be raised later without invalidating the password.
export const PASSWORD_PARAMS = Object.freeze({
  memory: 65536,
  passes: 3,
  parallelism: 1,
  tagLength: 32
});

function passwordBuffer(password) {
  if (typeof password !== 'string') throw new TypeError('password must be a string');
  const message = Buffer.from(password, 'utf8');
  if (message.length > MAX_PASSWORD_BYTES) throw new RangeError('password is too long');
  return message;
}

function derive(message, nonce, params) {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message, nonce, ...params }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function decoded(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try { return Buffer.from(value, 'base64url'); }
  catch { return null; }
}

export function validateNewPassword(password) {
  const message = passwordBuffer(password);
  if ([...password].length < MIN_PASSWORD_LENGTH)
    throw new RangeError(`password must contain at least ${MIN_PASSWORD_LENGTH} characters`);
  return message;
}

export function validatePasswordRecord(record) {
  if (!record || record.algorithm !== 'argon2id') throw new Error('unsupported password hash');
  const integer = key => Number.isInteger(record[key]);
  if (!integer('memory') || record.memory < 19456 || record.memory > 262144 ||
      !integer('passes') || record.passes < 2 || record.passes > 10 ||
      !integer('parallelism') || record.parallelism < 1 || record.parallelism > 16 ||
      !integer('tagLength') || record.tagLength < 16 || record.tagLength > 64)
    throw new Error('invalid password hash parameters');

  const salt = decoded(record.salt);
  const hash = decoded(record.hash);
  if (!salt || salt.length < 16 || salt.length > 64 || !hash || hash.length !== record.tagLength)
    throw new Error('invalid password hash data');
  return { salt, hash };
}

export async function hashPassword(password, params = PASSWORD_PARAMS) {
  const message = validateNewPassword(password);
  const salt = randomBytes(16);
  const hash = await derive(message, salt, params);
  return {
    algorithm: 'argon2id',
    ...params,
    salt: salt.toString('base64url'),
    hash: hash.toString('base64url')
  };
}

export async function verifyPassword(password, record) {
  const message = passwordBuffer(password);
  const { salt, hash } = validatePasswordRecord(record);
  const actual = await derive(message, salt, {
    memory: record.memory,
    passes: record.passes,
    parallelism: record.parallelism,
    tagLength: record.tagLength
  });
  return timingSafeEqual(actual, hash);
}
