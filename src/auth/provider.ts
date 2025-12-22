import crypto from 'crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// ============================================================================
// Types
// ============================================================================

export interface AuthSession {
  authUrl: string
  userCode?: string  // For device flow (OpenAI)
  interval?: number // Polling interval in seconds (OpenAI)
  sessionId: string
  expiresAt: number
}

export interface TokenResult {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  accountId?: string
  email?: string
}

export interface AuthProvider {
  id: string
  name: string
  startAuth(): Promise<AuthSession>
  completeAuth(input: string, sessionId: string): Promise<TokenResult>
}

// ============================================================================
// Claude Provider - OAuth + PKCE
// ============================================================================

const CLAUDE_CLIENT_ID =
  process.env.ANTHROPIC_OAUTH_CLIENT_ID || '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const CLAUDE_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback'
const CLAUDE_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token'

export class ClaudeProvider implements AuthProvider {
  id = 'claude'
  name = 'Claude'

  async startAuth(): Promise<AuthSession> {
    const verifier = crypto.randomBytes(32).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')

    const authUrl = new URL('https://claude.ai/oauth/authorize')
    authUrl.searchParams.set('code', 'true')
    authUrl.searchParams.set('client_id', CLAUDE_CLIENT_ID)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', CLAUDE_REDIRECT_URI)
    authUrl.searchParams.set('scope', 'org:create_api_key user:profile user:inference')
    authUrl.searchParams.set('code_challenge', challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('state', verifier)

    return {
      authUrl: authUrl.toString(),
      sessionId: verifier,
      expiresAt: Date.now() + 15 * 60 * 1000,
    }
  }

  async completeAuth(codeInput: string, sessionId: string): Promise<TokenResult> {
    // Parse CODE#STATE format
    const parts = codeInput.trim().split('#')
    const code = parts[0]
    const state = parts[1] || sessionId

    const response = await fetch(CLAUDE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        state,
        grant_type: 'authorization_code',
        client_id: CLAUDE_CLIENT_ID,
        redirect_uri: CLAUDE_REDIRECT_URI,
        code_verifier: sessionId,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Claude token exchange failed: ${error}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
      account?: {
        uuid: string
        email_address: string
      }
      organization?: {
        uuid: string
        name: string
      }
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      email: data.account?.email_address,
    }
  }
}

// ============================================================================
// OpenAI Provider - Device Code Flow
// ============================================================================

const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_AUTH_BASE_URL = 'https://auth.openai.com'
const OPENAI_DEVICE_AUTH_BASE_URL = `${OPENAI_AUTH_BASE_URL}/api/accounts`
const OPENAI_DEVICE_CODE_URL = `${OPENAI_DEVICE_AUTH_BASE_URL}/deviceauth/usercode`
const OPENAI_DEVICE_POLL_URL = `${OPENAI_DEVICE_AUTH_BASE_URL}/deviceauth/token`
const OPENAI_DEVICE_REDIRECT_URI = `${OPENAI_AUTH_BASE_URL}/deviceauth/callback`
const OPENAI_TOKEN_URL = `${OPENAI_AUTH_BASE_URL}/oauth/token`
const OPENAI_USER_AUTH_URL = `${OPENAI_AUTH_BASE_URL}/codex/device`
const OPENAI_OAUTH_SCOPE = process.env.OPENAI_OAUTH_SCOPE || 'model.request'
const OPENAI_DEVICE_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'reqwest/0.12.24',
}
const OPENAI_TOKEN_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': 'reqwest/0.12.24',
}

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
  try {
    const decoded = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractChatGptAccountId(idToken: string | undefined, accessToken?: string): string | undefined {
  const tokens = [idToken, accessToken].filter((value): value is string => Boolean(value))
  for (const token of tokens) {
    const payload = parseJwtPayload(token)
    if (!payload) continue
    const direct = payload?.chatgpt_account_id
    if (typeof direct === 'string' && direct.trim()) return direct
    const authClaim = payload?.['https://api.openai.com/auth']
    const nested = (authClaim as Record<string, unknown> | undefined)?.chatgpt_account_id
    if (typeof nested === 'string' && nested.trim()) return nested
  }
  return undefined
}

function extractEmailFromIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined
  const payload = parseJwtPayload(idToken)
  if (!payload) return undefined
  const email = payload?.email
  if (typeof email === 'string' && email.trim()) return email
  return undefined
}

const execFileAsync = promisify(execFile)

type HttpResult = {
  status: number
  ok: boolean
  text: string
}

function parseCurlResult(stdout: string): HttpResult {
  const marker = '\n__STATUS__:'
  const idx = stdout.lastIndexOf(marker)
  if (idx === -1) {
    return { status: 0, ok: false, text: stdout }
  }
  const body = stdout.slice(0, idx)
  const statusText = stdout.slice(idx + marker.length).trim()
  const status = parseInt(statusText, 10)
  return { status, ok: status >= 200 && status < 300, text: body }
}

async function curlPost(url: string, contentType: string, body: string): Promise<HttpResult> {
  const args = [
    '-sS',
    '-X',
    'POST',
    url,
    '-H',
    `Content-Type: ${contentType}`,
    '-H',
    'User-Agent: reqwest/0.12.24',
    '-d',
    body,
    '-w',
    '\n__STATUS__:%{http_code}',
  ]
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 5 * 1024 * 1024 })
  return parseCurlResult(stdout)
}

async function postWithFallback(
  url: string,
  headers: Record<string, string>,
  body: string,
  contentType: string,
): Promise<HttpResult> {
  const response = await fetch(url, { method: 'POST', headers, body })
  const text = await response.text()
  if (response.ok) {
    return { status: response.status, ok: true, text }
  }
  if (text.includes('cdn-cgi/challenge-platform')) {
    try {
      return await curlPost(url, contentType, body)
    } catch {
      return { status: response.status, ok: false, text }
    }
  }
  return { status: response.status, ok: false, text }
}

function normalizeOpenAIError(status: number, body: string) {
  const trimmed = body.trim()
  if (!trimmed) return `HTTP ${status}`
  if (trimmed.startsWith('<') || trimmed.includes('cdn-cgi/challenge-platform')) {
    return `OpenAI auth endpoint returned a Cloudflare challenge (HTTP ${status}).`
  }
  return trimmed
}

interface DeviceCodeResponse {
  device_auth_id: string
  user_code: string
  interval: number | string
}

interface DevicePollResponse {
  authorization_code: string
  code_challenge: string
  code_verifier: string
}

// Store active device sessions for polling
const deviceSessions = new Map<
  string,
  {
    deviceAuthId: string
    userCode: string
    interval: number
    createdAt: number
  }
>()

export class OpenAIProvider implements AuthProvider {
  id = 'openai'
  name = 'ChatGPT'

  getAuthUrl(): string {
    return OPENAI_USER_AUTH_URL
  }

  async startAuth(): Promise<AuthSession> {
    const body = JSON.stringify({ client_id: OPENAI_CLIENT_ID, scope: OPENAI_OAUTH_SCOPE })
    const response = await postWithFallback(
      OPENAI_DEVICE_CODE_URL,
      OPENAI_DEVICE_HEADERS,
      body,
      'application/json',
    )

    if (!response.ok) {
      throw new Error(`Failed to get device code: ${normalizeOpenAIError(response.status, response.text)}`)
    }

    const data = JSON.parse(response.text) as DeviceCodeResponse
    const sessionId = data.device_auth_id
    const interval = typeof data.interval === 'string' ? parseInt(data.interval, 10) : data.interval
    const safeInterval = Number.isFinite(interval) && interval > 0 ? interval : 5

    // Store session for polling
    deviceSessions.set(sessionId, {
      deviceAuthId: data.device_auth_id,
      userCode: data.user_code,
      interval: safeInterval,
      createdAt: Date.now(),
    })

    return {
      authUrl: OPENAI_USER_AUTH_URL,
      userCode: data.user_code,
      interval: safeInterval,
      sessionId,
      expiresAt: Date.now() + 15 * 60 * 1000,
    }
  }

  async completeAuth(_input: string, sessionId: string): Promise<TokenResult> {
    const session = deviceSessions.get(sessionId)
    if (!session) {
      throw new Error('Session not found or expired')
    }

    // Poll for authorization
    const pollBody = JSON.stringify({
      device_auth_id: session.deviceAuthId,
      user_code: session.userCode,
    })
    const pollResponse = await postWithFallback(
      OPENAI_DEVICE_POLL_URL,
      OPENAI_DEVICE_HEADERS,
      pollBody,
      'application/json',
    )

    if (!pollResponse.ok) {
      if (pollResponse.status === 403 || pollResponse.status === 404 || pollResponse.status === 429) {
        throw new Error('PENDING') // User hasn't authorized yet
      }
      throw new Error(`Poll failed: ${normalizeOpenAIError(pollResponse.status, pollResponse.text)}`)
    }

    const pollData = JSON.parse(pollResponse.text) as DevicePollResponse

    // Exchange authorization code for tokens
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: OPENAI_CLIENT_ID,
      code: pollData.authorization_code,
      code_verifier: pollData.code_verifier,
      redirect_uri: OPENAI_DEVICE_REDIRECT_URI,
      scope: OPENAI_OAUTH_SCOPE,
    }).toString()
    const tokenResponse = await postWithFallback(
      OPENAI_TOKEN_URL,
      OPENAI_TOKEN_HEADERS,
      tokenBody,
      'application/x-www-form-urlencoded',
    )

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${normalizeOpenAIError(tokenResponse.status, tokenResponse.text)}`)
    }

    const tokenData = JSON.parse(tokenResponse.text) as {
      access_token: string
      refresh_token: string
      id_token: string
      expires_in: number
    }

    const accountId = extractChatGptAccountId(tokenData.id_token, tokenData.access_token)
    const email = extractEmailFromIdToken(tokenData.id_token)

    // Clean up session
    deviceSessions.delete(sessionId)

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      accountId,
      email,
    }
  }

  // Get session info for polling UI
  getSession(sessionId: string) {
    return deviceSessions.get(sessionId)
  }
}

// Export singleton instances
export const claudeProvider = new ClaudeProvider()
export const openaiProvider = new OpenAIProvider()
