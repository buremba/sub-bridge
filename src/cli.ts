#!/usr/bin/env node
/**
 * Sub Bridge CLI
 *
 * Main entry point that can run in different modes:
 * - Default: Starts HTTP server + MCP server (original behavior)
 * - --server-only: Just HTTP server
 * - --mcp-only: Just MCP proxy (discovers/starts HTTP server)
 *
 * For development, use the separate entry points:
 * - npm run dev:server - HTTP server with hot reload
 * - npm run dev:mcp - MCP proxy (connects to existing server or starts inline)
 */
import { program } from 'commander'
import chalk from 'chalk'
import { startServer, type ServerConfig } from './server'
import { findPort } from './utils/port'
import { startMcpServer } from './mcp/proxy'
import { addSharedOptions } from './utils/cli-args'

const log = (...args: Parameters<typeof console.error>) => console.error(...args)

async function main() {
  const prog = program
    .name('sub-bridge')
    .description('MCP bridge for ChatGPT Pro, Claude Max, etc. in Cursor')
  
  addSharedOptions(prog)
    .option('--server-only', 'Run HTTP server only (no MCP)')
    .option('--mcp-only', 'Run MCP proxy only (discovers existing server)')
    .parse()

  const opts = program.opts()

  const config: ServerConfig = {
    port: opts.port ? parseInt(opts.port, 10) : undefined,
    tunnelUrl: opts.tunnel,
    verbose: opts.verbose || false,
  }

  // MCP-only mode: just run the thin proxy
  if (opts.mcpOnly) {
    const discovery = await findPort(config.port)

    if (discovery.hasServer) {
      log(`[sub-bridge] Found existing HTTP server on port ${discovery.port}`)
      await startMcpServer(discovery.port, log)
    } else {
      log(`[sub-bridge] No HTTP server found, starting inline on port ${discovery.port}`)
      const server = await startServer({ ...config, port: discovery.port })
      await startMcpServer(server.port, log)
    }
    return
  }

  // Server-only mode: just run the HTTP server
  if (opts.serverOnly) {
    await startServer(config)
    log(chalk.dim('  Press Ctrl+C to stop'))
    return
  }

  // Default mode: start HTTP server + MCP (original behavior)
  const server = await startServer(config)

  printSetupInstructions(server.publicUrl)

  await startMcpServer(server.port, log)
}

function printSetupInstructions(publicUrl: string) {
  log()
  log(chalk.dim('  Getting API keys:'))
  log(chalk.dim('    • Open'), chalk.cyan(publicUrl), chalk.dim('in your external browser and click Login buttons'))
  log()
  log(chalk.dim('  Use MCP tool: "get_status" to get URL anytime'))
  log()
}

main().catch((error) => {
  log('[sub-bridge] Fatal error:', error)
  process.exit(1)
})
