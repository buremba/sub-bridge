// ============================================================================
// Tunnel Registry - Manages providers and active tunnel
// ============================================================================

import type { TunnelProvider, TunnelInstance, TunnelStatus, ProviderInfo } from './types'
import { SERVICE_IDENTIFIER } from '../utils/port'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function verifyTunnelHealth(publicUrl: string, expectedPort: number): Promise<void> {
  const baseUrl = publicUrl.replace(/\/$/, '')
  const healthUrl = `${baseUrl}/health`
  const maxAttempts = 12
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    try {
      const response = await fetch(healthUrl, { signal: controller.signal })
      if (!response.ok) {
        throw new Error(`Tunnel check failed (HTTP ${response.status})`)
      }

      const data = await response.json() as { service?: string; port?: number }
      if (data.service !== SERVICE_IDENTIFIER) {
        throw new Error('Tunnel check failed (unexpected service)')
      }
      if (typeof data.port === 'number' && data.port !== expectedPort) {
        throw new Error(`Tunnel check failed (unexpected port ${data.port})`)
      }
      return
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error('Tunnel check timed out')
      } else if (error instanceof Error) {
        lastError = error
      } else {
        lastError = new Error(String(error))
      }
      if (attempt < maxAttempts) {
        await sleep(400)
        continue
      }
      throw new Error(`Tunnel check failed: ${lastError.message} (${healthUrl})`)
    } finally {
      clearTimeout(timeout)
    }
  }
}
import {
  CloudflareTunnelProvider,
  NgrokTunnelProvider,
  TailscaleTunnelProvider,
} from './providers'

export class TunnelRegistry {
  private providers: Map<string, TunnelProvider> = new Map()
  private activeTunnel: TunnelInstance | null = null
  private startedAt: string | null = null
  private lastError: string | null = null

  constructor() {
    const allProviders: TunnelProvider[] = [
      new CloudflareTunnelProvider(),
      new NgrokTunnelProvider(),
      new TailscaleTunnelProvider(),
    ]
    for (const provider of allProviders) {
      this.providers.set(provider.id, provider)
    }
  }

  async getProviders(): Promise<ProviderInfo[]> {
    const results: ProviderInfo[] = []
    for (const [id, provider] of this.providers) {
      results.push({
        id,
        name: provider.name,
        available: await provider.isAvailable(),
        supportsNamedTunnels: provider.supportsNamedTunnels,
      })
    }
    return results
  }

  getStatus(): TunnelStatus {
    if (this.activeTunnel) {
      return {
        active: true,
        providerId: this.activeTunnel.providerId,
        publicUrl: this.activeTunnel.publicUrl,
        startedAt: this.startedAt || undefined,
      }
    }
    return {
      active: false,
      error: this.lastError || undefined,
    }
  }

  async start(providerId: string, localPort: number, namedUrl?: string): Promise<TunnelStatus> {
    // Stop existing tunnel if any
    if (this.activeTunnel) {
      this.activeTunnel.stop()
      this.activeTunnel = null
    }

    const provider = this.providers.get(providerId)
    if (!provider) {
      throw new Error(`Unknown tunnel provider: ${providerId}`)
    }

    if (!await provider.isAvailable()) {
      throw new Error(`Tunnel provider ${provider.name} is not available`)
    }

    try {
      this.lastError = null
      this.activeTunnel = await provider.start(localPort, namedUrl)
      this.startedAt = new Date().toISOString()
      await verifyTunnelHealth(this.activeTunnel.publicUrl, localPort)
      return this.getStatus()
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      if (this.activeTunnel) {
        this.activeTunnel.stop()
        this.activeTunnel = null
        this.startedAt = null
      }
      throw error
    }
  }

  stop(): TunnelStatus {
    if (this.activeTunnel) {
      this.activeTunnel.stop()
      this.activeTunnel = null
      this.startedAt = null
    }
    return this.getStatus()
  }

  getPublicUrl(): string | null {
    return this.activeTunnel?.publicUrl || null
  }
}
