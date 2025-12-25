// ============================================================================
// Manual/Custom URL Provider - User provides their own public URL
// ============================================================================

import type { TunnelProvider, TunnelInstance, NamedTunnelInfo } from '../types'

export class ManualTunnelProvider implements TunnelProvider {
  id = 'manual'
  name = 'Custom URL'
  supportsNamedTunnels = false

  async isAvailable(): Promise<boolean> {
    return true // Always available - no dependencies
  }

  async isAuthenticated(): Promise<boolean> {
    return true // No authentication needed
  }

  async listTunnels(): Promise<NamedTunnelInfo[]> {
    return [] // No named tunnels for manual provider
  }

  async start(localPort: number, customUrl?: string): Promise<TunnelInstance> {
    if (!customUrl) {
      throw new Error('Custom URL is required. Enter your public URL (e.g., https://api.mydomain.com)')
    }

    // Normalize URL - ensure it has a protocol
    let publicUrl = customUrl.trim()
    if (!publicUrl.startsWith('http://') && !publicUrl.startsWith('https://')) {
      publicUrl = 'https://' + publicUrl
    }

    // Remove trailing slash for consistency
    publicUrl = publicUrl.replace(/\/$/, '')

    return {
      providerId: this.id,
      publicUrl,
      stop: () => {
        // No-op - nothing to stop since no process was started
      }
    }
  }
}
