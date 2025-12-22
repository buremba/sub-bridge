// ============================================================================
// Cloudflare Tunnel Provider
// ============================================================================

import { Tunnel } from 'cloudflared'
import type { TunnelProvider, TunnelInstance } from '../types'

export class CloudflareTunnelProvider implements TunnelProvider {
  id = 'cloudflare'
  name = 'Cloudflare'
  supportsNamedTunnels = true

  async isAvailable(): Promise<boolean> {
    // The cloudflared npm package auto-installs the binary
    return true
  }

  async start(localPort: number, namedUrl?: string): Promise<TunnelInstance> {
    if (namedUrl) {
      // Named tunnel: user provides their own tunnel hostname
      // They need to configure this in Cloudflare dashboard and run cloudflared separately
      return {
        providerId: this.id,
        publicUrl: namedUrl.startsWith('https://') ? namedUrl : `https://${namedUrl}`,
        stop: () => {}
      }
    }

    // Anonymous tunnel using cloudflared npm package
    const tunnel = Tunnel.quick(`http://localhost:${localPort}`)

    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tunnel timeout (30s)')), 30000)
      tunnel.once('url', (tunnelUrl: string) => {
        clearTimeout(timeout)
        resolve(tunnelUrl)
      })
      tunnel.once('error', (err: Error) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    return {
      providerId: this.id,
      publicUrl: url,
      stop: () => tunnel.stop()
    }
  }
}
