// ============================================================================
// Tunnel Types
// ============================================================================

export interface TunnelProvider {
  id: string
  name: string
  supportsNamedTunnels: boolean
  isAvailable(): Promise<boolean>
  start(localPort: number, namedUrl?: string): Promise<TunnelInstance>
}

export interface TunnelInstance {
  providerId: string
  publicUrl: string
  stop(): void
}

export interface TunnelStatus {
  active: boolean
  providerId?: string
  publicUrl?: string
  startedAt?: string
  error?: string
}

export interface ProviderInfo {
  id: string
  name: string
  available: boolean
  supportsNamedTunnels: boolean
}
