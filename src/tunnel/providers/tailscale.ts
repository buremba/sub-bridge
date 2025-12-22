// ============================================================================
// Tailscale Funnel Provider
// ============================================================================

import { spawn, ChildProcess } from 'child_process'
import type { TunnelProvider, TunnelInstance } from '../types'
import { binaryExists, spawnTunnelProcess, execJson } from '../utils'

export class TailscaleTunnelProvider implements TunnelProvider {
  id = 'tailscale'
  name = 'Tailscale Funnel'
  supportsNamedTunnels = false
  private process: ChildProcess | null = null

  async isAvailable(): Promise<boolean> {
    if (!await binaryExists('tailscale')) return false

    try {
      const status = await execJson<{ BackendState: string }>('tailscale status --json')
      return status.BackendState === 'Running'
    } catch {
      return false
    }
  }

  async start(localPort: number): Promise<TunnelInstance> {
    // Get hostname from Tailscale status
    const status = await execJson<{ Self?: { DNSName?: string } }>('tailscale status --json')
    const hostname = status.Self?.DNSName?.replace(/\.$/, '')

    if (!hostname) throw new Error('Could not determine Tailscale hostname')

    // Start funnel
    this.process = spawnTunnelProcess('tailscale', ['funnel', String(localPort)])

    // Wait for funnel to initialize
    await new Promise(r => setTimeout(r, 2000))

    const proc = this.process
    return {
      providerId: this.id,
      publicUrl: `https://${hostname}`,
      stop: () => {
        spawn('tailscale', ['funnel', 'off'], { stdio: 'ignore' })
        proc?.kill('SIGTERM')
        this.process = null
      }
    }
  }
}
