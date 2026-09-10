# Security policy

quietGym is a self-hosted, single-owner application. Only the latest release receives fixes.

## Reporting a vulnerability

Use GitHub private vulnerability reporting when available. Do not publish a working exploit that
could be used against other installations.

Useful information includes the version or commit, the configured `ORIGIN`, the reverse proxy in
front of the API, reproduction steps and the impact.

## Authentication model

- There is exactly one owner and no public registration route, usernames, invitations or admin
  dashboard. The owner password can only be created or changed from an interactive terminal with
  `npm run password:set`.
- The password is never stored. The server stores an Argon2id result with a random 16-byte salt,
  64 MiB of memory, three passes and parallelism one. Verification uses Node's asynchronous
  implementation and a timing-safe comparison.
- Passwords must contain at least 15 characters. Unicode and spaces are accepted, values are not
  silently trimmed or truncated, and inputs larger than 1024 UTF-8 bytes are rejected.
- Login failures return one generic response. Login is limited per client address; production
  defaults to five attempts per 15 minutes.
- Production requires an exact HTTPS `ORIGIN`, a loopback API binding and an absolute `DATA_DIR`.
  Unsafe requests must carry that exact Origin. Caddy is the public TLS endpoint.

## Sessions and data access

- A successful login creates a signed `gymsid` cookie carrying the owner id, expiry and session
  version. It is `HttpOnly`, `SameSite=Lax` and `Secure` under the required production HTTPS
  origin. The default lifetime is 90 days.
- `POST /api/logout/all` increments the owner's session version, immediately invalidating all
  previously issued cookies. Changing the password with `npm run password:set` does the same.
- `GET` and `PUT /api/data` derive the state filename from the authenticated session; callers
  cannot choose another identity or path.
- The browser never persists the password. Its `localStorage` copy of workout state is an offline
  cache, not proof of authentication; the server cookie is required for every protected API call.
- Guest mode is unavailable in a hosted build. It remains only in the static demo and native
  offline app, neither of which has access to server data.

## Files on the server

`DATA_DIR` contains:

- `db.json`: the owner password hash, password parameters and push subscriptions.
- `state-owner.json`: workouts, routines, body weight and settings.
- `secret`: the HMAC key for session cookies.
- `vapid.json`: Web Push keys.

These files are written with mode `0600`, but they are not encrypted. Anyone who can read the
server data directory can read the workout data and, with the session secret, forge sessions.
Host access is therefore trusted by design.

## Operational requirements

- Run Node 24.7.0 or newer; Argon2 support is provided by `node:crypto`.
- Keep the API on `127.0.0.1` and expose it only through Caddy over HTTPS.
- Never place the plaintext password in `.env`, a command argument, source code or logs.
- The password-setting command refuses malformed databases and databases containing more than
  one existing user instead of silently choosing or overwriting one.
