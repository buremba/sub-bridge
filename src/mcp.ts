#!/usr/bin/env node
/**
 * Thin MCP Proxy Entry Point
 *
 * This is the entry point for Cursor's MCP integration.
 * It discovers or starts an HTTP server and forwards tool calls to it.
 *
 * Dev mode: Developer runs HTTP server separately with `tsx watch src/server.ts`
 * Production: MCP proxy starts HTTP server inline if not found
 */
import { program } from 'commander'
import { findPort } from './utils/port'
import { startServer, type ServerConfig } from './server'
import { startMcpServer } from './mcp/proxy'
import { addSharedOptions } from './utils/cli-args'

const log = (...args: Parameters<typeof console.error>) => console.error(...args)

async function main() {
  // Parse CLI arguments
  addSharedOptions(program).parse()
  const opts = program.opts()

  const cliPort = opts.port ? parseInt(opts.port, 10) : undefined
  const tunnelUrl = opts.tunnel || process.env.TUNNEL_URL
  const verbose = opts.verbose || process.env.VERBOSE === 'true'

  // Discover existing server or find a free port
  const discovery = await findPort(cliPort)

  let serverPort = discovery.port

  if (discovery.hasServer) {
    log(`[mcp] Found existing HTTP server on port ${serverPort}`)
  } else {
    log(`[mcp] No HTTP server found, starting inline on port ${serverPort}`)

    // Start HTTP server inline (production mode)
    const config: ServerConfig = {
      port: serverPort,
      tunnelUrl,
      verbose,
    }

    const server = await startServer(config)
    serverPort = server.port
    log(`[mcp] HTTP server started on port ${serverPort}`)
  }

  await startMcpServer(serverPort, log)
}

main().catch((error) => {
  log('[mcp] Fatal error:', error)
  process.exit(1)
})
