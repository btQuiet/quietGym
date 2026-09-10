import net from 'node:net';
import path from 'node:path';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function normalizedIp(value) {
  const ip = String(value || '').trim().toLowerCase();
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function isLoopbackAddress(value) {
  const ip = normalizedIp(value);
  if (ip === '::1') return true;
  if (net.isIP(ip) !== 4) return false;
  return ip.split('.')[0] === '127';
}

export function clientIp(remoteAddress, forwardedFor) {
  const remote = normalizedIp(remoteAddress) || 'unknown';
  if (!isLoopbackAddress(remote)) return remote;

  const forwarded = Array.isArray(forwardedFor) ? forwardedFor.join(',') : String(forwardedFor || '');
  const candidates = forwarded.split(',').map(normalizedIp).filter(Boolean);
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    if (net.isIP(candidates[i])) return candidates[i];
  }
  return remote;
}

export function validateRuntimeConfig({
  production,
  host,
  allowNonLoopback,
  port,
  dataDir,
  origin,
  rpId,
  vapidSubject,
  userVerification,
  sessionDays,
  authRateLimitMax,
  authRateLimitWindowSeconds
}) {
  const errors = [];

  if (!Number.isInteger(port) || port < 1 || port > 65535)
    errors.push('PORT must be an integer between 1 and 65535');
  if (!Number.isInteger(authRateLimitMax) || authRateLimitMax < 1)
    errors.push('AUTH_RATE_LIMIT_MAX must be a positive integer');
  if (!Number.isInteger(authRateLimitWindowSeconds) || authRateLimitWindowSeconds < 1)
    errors.push('AUTH_RATE_LIMIT_WINDOW_SECONDS must be a positive integer');
  if (!['preferred', 'required'].includes(userVerification))
    errors.push('WEBAUTHN_USER_VERIFICATION must be "preferred" or "required"');
  if (!Number.isInteger(sessionDays) || sessionDays < 1 || sessionDays > 365)
    errors.push('SESSION_DAYS must be an integer between 1 and 365');

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
    if (parsedOrigin.origin !== origin || parsedOrigin.username || parsedOrigin.password)
      errors.push('ORIGIN must be an exact origin without credentials, a path or a trailing slash');
  } catch {
    errors.push('ORIGIN must be a valid URL origin');
  }

  const normalizedRpId = String(rpId || '').toLowerCase();
  if (!normalizedRpId || normalizedRpId.includes('://') || normalizedRpId.includes('/') || normalizedRpId.includes(':'))
    errors.push('RP_ID must be a hostname without a scheme, port or path');
  else if (parsedOrigin) {
    const originHost = parsedOrigin.hostname.toLowerCase();
    if (originHost !== normalizedRpId && !originHost.endsWith(`.${normalizedRpId}`))
      errors.push('RP_ID must equal ORIGIN hostname or one of its parent domains');
  }

  if (production) {
    if (!allowNonLoopback && !isLoopbackAddress(host))
      errors.push('HOST must be a loopback address in production (127.0.0.1 or ::1)');
    if (!path.posix.isAbsolute(dataDir) && !path.win32.isAbsolute(dataDir))
      errors.push('DATA_DIR must be an absolute path in production');
    if (parsedOrigin?.protocol !== 'https:')
      errors.push('ORIGIN must use HTTPS in production');
    if (userVerification !== 'required')
      errors.push('WEBAUTHN_USER_VERIFICATION must be "required" in production');

    try {
      const subject = new URL(vapidSubject);
      if (!['https:', 'mailto:'].includes(subject.protocol))
        errors.push('VAPID_SUBJECT must use https: or mailto:');
      else if (subject.protocol === 'https:' && !subject.hostname)
        errors.push('VAPID_SUBJECT https: URL must include a hostname');
      else if (subject.protocol === 'mailto:' && !subject.pathname.includes('@'))
        errors.push('VAPID_SUBJECT mailto: URL must include an email address');
    } catch {
      errors.push('VAPID_SUBJECT must be a valid https: or mailto: URL');
    }
  }

  if (errors.length) throw new Error(`Invalid runtime configuration:\n- ${errors.join('\n- ')}`);
}

export function requestOriginAllowed(method, suppliedOrigin, expectedOrigin, required) {
  if (!required || !UNSAFE_METHODS.has(String(method || '').toUpperCase())) return true;
  if (Array.isArray(suppliedOrigin) || !suppliedOrigin) return false;
  return suppliedOrigin === expectedOrigin;
}

export function createFixedWindowRateLimiter({ limit, windowMs, now = Date.now, maxEntries = 10000 }) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('rate limit must be a positive integer');
  if (!Number.isInteger(windowMs) || windowMs < 1) throw new Error('rate-limit window must be a positive integer');

  const buckets = new Map();
  const cleanup = (at = now()) => {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= at) buckets.delete(key);
    }
  };

  const check = rawKey => {
    const at = now();
    const key = String(rawKey || 'unknown');
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= at) {
      if (buckets.size >= maxEntries) cleanup(at);
      if (buckets.size >= maxEntries) buckets.delete(buckets.keys().next().value);
      bucket = { count: 0, resetAt: at + windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: bucket.resetAt,
        retryAfter: Math.max(1, Math.ceil((bucket.resetAt - at) / 1000))
      };
    }

    bucket.count += 1;
    return {
      allowed: true,
      limit,
      remaining: limit - bucket.count,
      resetAt: bucket.resetAt,
      retryAfter: 0
    };
  };

  return { check, cleanup, size: () => buckets.size };
}
