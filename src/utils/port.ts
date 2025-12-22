/**
 * Port discovery utilities for MCP and HTTP server coordination.
 * Both use the same algorithm to find each other naturally.
 */

const SERVICE_IDENTIFIER = 'sub-bridge'
const DEFAULT_PORT = 8787
const MAX_PORT_TRIES = 10

export interface PortDiscoveryResult {
  port: number
  hasServer: boolean
}

export interface HealthResponse {
  status: string
  service: string
  port: number
}

/**
 * Check if a port has our server running on it.
 * Returns 'our-server' if sub-bridge is running, 'other-service' if something else,
 * or 'free' if nothing is listening.
 */
async function checkPort(port: number): Promise<'free' | 'our-server' | 'other-service'> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1000)

    const res = await fetch(`http://localhost:${port}/health`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok) {
      return 'other-service'
    }

    const data = await res.json() as HealthResponse
    return data.service === SERVICE_IDENTIFIER ? 'our-server' : 'other-service'
  } catch {
    // Connection refused or timeout = port is free
    return 'free'
  }
}

/**
 * Find a port where our server is running, or find a free port.
 * Used by MCP to discover existing server or decide where to start one.
 */
export async function findPort(startPort?: number): Promise<PortDiscoveryResult> {
  const envPort = parseInt(process.env.PORT || '', 10)
  const port = startPort ?? (envPort || DEFAULT_PORT)

  for (let p = port; p < port + MAX_PORT_TRIES; p++) {
    const status = await checkPort(p)

    if (status === 'our-server') {
      return { port: p, hasServer: true }
    }

    if (status === 'free') {
      return { port: p, hasServer: false }
    }

    // status === 'other-service', try next port
  }

  throw new Error(`No available port found in range ${port}-${port + MAX_PORT_TRIES - 1}`)
}

/**
 * Find a free port to bind to.
 * Used by HTTP server when starting up.
 */
export async function findFreePort(startPort?: number): Promise<number> {
  const envPort = parseInt(process.env.PORT || '', 10)
  const port = startPort ?? (envPort || DEFAULT_PORT)

  for (let p = port; p < port + MAX_PORT_TRIES; p++) {
    const status = await checkPort(p)

    if (status === 'free') {
      return p
    }

    if (status === 'our-server') {
      // Another instance is already running on this port
      // Continue to find a free port for a new instance
    }

    // status === 'other-service', try next port
  }

  throw new Error(`No free port found in range ${port}-${port + MAX_PORT_TRIES - 1}`)
}

export { SERVICE_IDENTIFIER, DEFAULT_PORT }
