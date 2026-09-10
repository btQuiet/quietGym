import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { passwordLogin } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { useEffect, useRef, useState } from 'react'
import { Button, TextField } from '../components/ui.jsx'

export default function Login() {
  const { setUser, pullState, setGuest } = useStore()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const passwordRef = useRef(null)
  useEffect(() => { if (!DEMO) passwordRef.current?.focus() }, [])
  const signIn = async e => {
    e.preventDefault()
    if (!password) { useUI.getState().toast(t('Enter your password')); return }
    setBusy(true)
    try {
      const u = await passwordLogin(password)
      setPassword('')
      setUser(u)
      await pullState()
      useUI.getState().toast(t('Welcome!'))
    } catch (error) {
      useUI.getState().toast(error.status === 401 ? t('Incorrect password') : (error.message || t('Sign-in failed')))
    } finally { setBusy(false) }
  }
  const head = <>
    <img src={`${import.meta.env.BASE_URL}quietgym-icon-180.png`} alt="" width="72" height="72"
      style={{ display: 'block', margin: '0 auto', borderRadius: 18 }} />
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>quietGym</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Password sign-in and sync across your devices come with the quietGym server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      {head}
      <br />
      <form onSubmit={signIn}>
        <TextField ref={passwordRef} type="password" autoComplete="current-password"
          placeholder={t('Password')} aria-label={t('Password')} maxLength={1024}
          value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
        <div style={{ height: 12 }} />
        <Button type="submit" variant="primary" icon="lock" disabled={busy}>{t('Sign in')}</Button>
      </form>
    </div>
  )
}
