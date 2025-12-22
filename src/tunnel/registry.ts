// ============================================================================
// Tunnel Registry - Manages providers and active tunnel
// ============================================================================

import type { TunnelProvider, TunnelInstance, TunnelStatus, ProviderInfo } from './types'
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
      return this.getStatus()
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
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
