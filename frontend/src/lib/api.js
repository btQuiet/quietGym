// Backend helpers. Authentication is a single password exchange; the password is
// never persisted in browser storage and the server returns an HttpOnly session cookie.
export const IS_ANDROID = /Android/.test(navigator.userAgent)

export async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}

export async function passwordLogin(password) {
  const res = await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) })
  return res.user
}
