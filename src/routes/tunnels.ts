/**
 * Tunnel management routes
 */
import { Hono } from 'hono'
import { TunnelRegistry } from '../tunnel/registry'

export function createTunnelRoutes(tunnelRegistry: TunnelRegistry, getLocalPort: () => number) {
  const app = new Hono()

  // GET /api/tunnels - List available providers and current status
  app.get('/', async (c) => {
    const providers = await tunnelRegistry.getProviders()
    const status = tunnelRegistry.getStatus()
    return c.json({ providers, status })
  })

  // GET /api/tunnels/status - Just the current status as JSON
  app.get('/status', (c) => c.json(tunnelRegistry.getStatus()))

  // POST /api/tunnels/:provider/start - Start a tunnel
  app.post('/:provider/start', async (c) => {
    const providerId = c.req.param('provider')
    let namedUrl: string | undefined
    try {
      const body = await c.req.json().catch(() => ({}))
      namedUrl = body.namedUrl
    } catch {}
    try {
      await tunnelRegistry.start(providerId, getLocalPort(), namedUrl || undefined)
      const status = tunnelRegistry.getStatus()
      return c.json({ success: true, status })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return c.json({ success: false, error: message })
    }
  })

  // POST /api/tunnels/stop - Stop any active tunnel
  app.post('/stop', (c) => {
    tunnelRegistry.stop()
    return c.json({ success: true })
  })

  return app
}
