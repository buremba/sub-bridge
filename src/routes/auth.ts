/**
 * Authentication routes for Claude and OpenAI OAuth
 */
import { Hono } from 'hono'
import { claudeProvider, openaiProvider, type AuthSession } from '../auth/provider'

// Auth session storage
const AUTH_SESSION_TTL_MS = 15 * 60 * 1000
const authSessions = new Map<string, AuthSession & { createdAt: number }>()

function storeAuthSession(session: AuthSession) {
  authSessions.set(session.sessionId, { ...session, createdAt: Date.now() })
  const now = Date.now()
  for (const [id, s] of authSessions.entries()) {
    if (now - s.createdAt > AUTH_SESSION_TTL_MS) {
      authSessions.delete(id)
    }
  }
}

function getAuthSession(sessionId: string): (AuthSession & { createdAt: number }) | null {
  const session = authSessions.get(sessionId)
  if (!session) return null
  if (Date.now() - session.createdAt > AUTH_SESSION_TTL_MS) {
    authSessions.delete(sessionId)
    return null
  }
  return session
}

export function createAuthRoutes() {
  const app = new Hono()

  // OpenAI: Redirect to auth page
  app.get('/openai', async (c) => {
    try {
      return c.redirect(openaiProvider.getAuthUrl())
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      return c.text(`Error: ${msg}`, 500)
    }
  })

  // OpenAI: Debug device code endpoint
  app.get('/openai/device-code', async (c) => {
    try {
      const session = await openaiProvider.startAuth()
      storeAuthSession(session)
      return c.json({
        sessionId: session.sessionId,
        userCode: session.userCode,
        authUrl: openaiProvider.getAuthUrl(),
        expiresAt: session.expiresAt,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      return c.json({ error: msg }, 500)
    }
  })

  // Claude: Redirect to auth page
  app.get('/claude', async (c) => {
    try {
      const session = await claudeProvider.startAuth()
      storeAuthSession(session)
      return c.redirect(session.authUrl)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      return c.text(`Error: ${msg}`, 500)
    }
  })

  // Claude: Start auth
  app.post('/claude/start', async (c) => {
    try {
      const session = await claudeProvider.startAuth()
      storeAuthSession(session)
      return c.redirect(session.authUrl)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      return c.text(`Error: ${msg}`, 500)
    }
  })

  // Claude: Complete auth (returns JSON)
  app.post('/claude/complete', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({})) as { code?: string; sessionId?: string }
      const codeInput = body.code?.trim() || ''
      const sessionId = body.sessionId || codeInput.split('#')[1]
      if (!codeInput) {
        return c.json({ success: false, error: 'Missing code' })
      }
      if (!sessionId) {
        return c.json({ success: false, error: 'Missing state. Paste CODE#STATE.' })
      }
      const result = await claudeProvider.completeAuth(codeInput, sessionId)
      return c.json({ success: true, accessToken: result.accessToken })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      return c.json({ success: false, error: msg })
    }
  })

  // OpenAI: Start auth (returns JSON)
  app.post('/openai/start', async (c) => {
    try {
      const session = await openaiProvider.startAuth()
      storeAuthSession(session)
      return c.json({
        sessionId: session.sessionId,
        userCode: session.userCode,
        authUrl: openaiProvider.getAuthUrl(),
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      return c.json({ error: msg }, 500)
    }
  })

  // OpenAI: Poll for auth (returns JSON)
  app.post('/openai/poll', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({})) as { sessionId?: string }
      const sessionId = body.sessionId
      if (!sessionId) {
        return c.json({ status: 'error', error: 'Missing session' })
      }
      const session = getAuthSession(sessionId)
      if (!session) {
        return c.json({ status: 'error', error: 'Session expired' })
      }
      const result = await openaiProvider.completeAuth('', sessionId)
      return c.json({
        status: 'success',
        accessToken: result.accessToken,
        accountId: result.accountId,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      if (msg === 'PENDING') {
        return c.json({ status: 'pending' })
      }
      return c.json({ status: 'error', error: msg })
    }
  })

  return app
}
