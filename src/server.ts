#!/usr/bin/env node
/**
 * HTTP Server Entry Point
 *
 * Run directly for development:
 *   tsx watch src/server.ts
 *
 * Or import and use programmatically from MCP proxy.
 */
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { program } from 'commander'
import chalk from 'chalk'
import fs from 'node:fs/promises'
import path from 'node:path'
import { TunnelRegistry } from './tunnel/registry'
import { corsPreflightHandler, corsMiddleware } from './utils/cors-bypass'
import { findFreePort, SERVICE_IDENTIFIER } from './utils/port'
import { log, setVerbose } from './utils/logger'
import { createAuthRoutes } from './routes/auth'
import { createTunnelRoutes } from './routes/tunnels'
import { createChatRoutes } from './routes/chat'
import { createOAuthRoutes } from './routes/oauth'
import { addSharedOptions } from './utils/cli-args'
import { buildStatusText } from './utils/setup-instructions'

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface ServerConfig {
  port?: number
  tunnelUrl?: string
  verbose: boolean
}

// Tunnel registry (singleton)
const tunnelRegistry = new TunnelRegistry()

// ============================================================================
// LANDING PAGE
// ============================================================================

const LANDING_PAGE_PATH = path.resolve(__dirname, '..', 'index.html')

async function getLandingPageHtml(): Promise<string> {
  return fs.readFile(LANDING_PAGE_PATH, 'utf8')
}

// ============================================================================
// SERVER APP
// ============================================================================

export function createServerApp(config: ServerConfig, getPublicUrl: () => string, localPort: { value: number }) {
  const app = new Hono()

  app.options('*', corsPreflightHandler)
  app.use('*', corsMiddleware)

  // Landing page
  app.get('/', async (c) => {
    const html = await getLandingPageHtml()
    c.header('Cache-Control', 'no-store')
    return c.html(html)
  })

  // Static assets (for setup.png)
  app.get('/assets/*', async (c) => {
    const filePath = c.req.path.replace('/assets/', '')
    const fullPath = path.resolve(__dirname, '..', 'public', 'assets', filePath)
    try {
      const file = await fs.readFile(fullPath)
      const ext = path.extname(filePath).toLowerCase()
      const contentType = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream'
      return new Response(file, { headers: { 'Content-Type': contentType } })
    } catch {
      return c.text('Not found', 404)
    }
  })

  // Health check with service identifier
  app.get('/health', (c) => c.json({
    status: 'ok',
    service: SERVICE_IDENTIFIER,
    port: localPort.value,
  }))

  // API config for frontend
  app.get('/api/config', (c) => c.json({
    publicUrl: getPublicUrl(),
    port: localPort.value,
  }))

  // MCP tool forwarding endpoint
  app.post('/mcp/tools/:name', async (c) => {
    const toolName = c.req.param('name')

    if (toolName === 'get_status') {
      const publicUrl = getPublicUrl()
      const tunnelStatus = tunnelRegistry.getStatus()
      const isLocalOnly = publicUrl.startsWith('http://localhost')

      const statusText = buildStatusText({
        mode: 'server',
        baseUrl: publicUrl,
        isLocalOnly,
        tunnelActive: tunnelStatus.active,
      })

      return c.json({
        content: [{ type: 'text', text: statusText }],
      })
    }

    return c.json({ error: `Unknown tool: ${toolName}` }, 404)
  })

  // Mount routes
  app.route('/auth', createAuthRoutes())
  app.route('/api/tunnels', createTunnelRoutes(tunnelRegistry, () => localPort.value))
  app.route('/v1', createChatRoutes())

  // OAuth routes (MCP OAuth Authorization Server)
  // Mounted at root for /.well-known/oauth-authorization-server and /oauth/*
  app.route('/', createOAuthRoutes(getPublicUrl))

  return app
}

// ============================================================================
// SERVER STARTUP
// ============================================================================

export interface StartedServer {
  port: number
  publicUrl: string
  stop: () => void
}

export async function startServer(config: ServerConfig): Promise<StartedServer> {
  setVerbose(config.verbose)

  const port = config.port ?? await findFreePort()
  const localPort = { value: port }
  const runningConfig = { ...config, port }

  let publicUrl = `http://localhost:${port}`

  const app = createServerApp(runningConfig, () => publicUrl, localPort)

  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      localPort.value = info.port
      publicUrl = config.tunnelUrl
        ? `https://${config.tunnelUrl}`
        : `http://localhost:${info.port}`

      log()
      log(chalk.bold.cyan('  Sub Bridge OpenAI API Gateway and MCP Server'))
      log(chalk.dim('  ─────────────────────────────────────'))
      log()
      log(' ', chalk.green(publicUrl))
      log(chalk.dim(`  Port: ${info.port}`))
      log()
      log(chalk.dim('  API key format: o3=opus-4.5,o3-mini=sonnet-4.5:sk-ant-xxx'))

      resolve({
        port: info.port,
        publicUrl,
        stop: () => server.close(),
      })
    })
  })
}

// ============================================================================
// CLI ENTRY POINT (when run directly)
// ============================================================================

async function main() {
  addSharedOptions(program).parse()

  const opts = program.opts()
  const envPort = parseInt(process.env.PORT || '', 10)

  const config: ServerConfig = {
    port: opts.port ? parseInt(opts.port, 10) : (envPort || undefined),
    tunnelUrl: opts.tunnel || process.env.TUNNEL_URL,
    verbose: opts.verbose || process.env.VERBOSE === 'true',
  }

  await startServer(config)
  log(chalk.dim('  Press Ctrl+C to stop'))
}

// Only run main if this is the entry point
const isMainModule = process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')
if (isMainModule) {
  main().catch((error) => {
    log('[sub-bridge] Fatal error:', error)
    process.exit(1)
  })
}
