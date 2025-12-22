// ============================================================================
// ngrok Tunnel Provider
// ============================================================================

import { ChildProcess } from 'child_process'
import type { TunnelProvider, TunnelInstance } from '../types'
import { binaryExists, spawnTunnelProcess, pollUntil } from '../utils'

export class NgrokTunnelProvider implements TunnelProvider {
  id = 'ngrok'
  name = 'ngrok'
  supportsNamedTunnels = true
  private process: ChildProcess | null = null

  async isAvailable(): Promise<boolean> {
    return binaryExists('ngrok')
  }

  async start(localPort: number, namedUrl?: string): Promise<TunnelInstance> {
    const args = ['http', String(localPort)]

    // Add subdomain if provided (requires ngrok account)
    if (namedUrl) {
      const subdomain = namedUrl.replace(/\.ngrok\.(io|app)$/, '')
      args.push('--subdomain', subdomain)
    }

    this.process = spawnTunnelProcess('ngrok', args)

    // Poll ngrok's local API for tunnel URL
    const url = await pollUntil(async () => {
      try {
        const response = await fetch('http://127.0.0.1:4040/api/tunnels')
        if (!response.ok) return null

        const data = await response.json() as { tunnels: Array<{ public_url: string }> }
        const httpsTunnel = data.tunnels.find(t => t.public_url.startsWith('https://'))
        return httpsTunnel?.public_url || null
      } catch {
        return null
      }
    }, 30000).catch(() => {
      throw new Error('ngrok tunnel timeout')
    })

    const proc = this.process
    return {
      providerId: this.id,
      publicUrl: url,
      stop: () => {
        proc?.kill('SIGTERM')
        this.process = null
      }
    }
  }
}
