// ============================================================================
// Tunnel Utilities
// ============================================================================

import { exec, spawn, ChildProcess } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/**
 * Check if a binary exists in PATH
 */
export async function binaryExists(binary: string): Promise<boolean> {
  try {
    const cmd = process.platform === 'win32' ? `where ${binary}` : `which ${binary}`
    await execAsync(cmd)
    return true
  } catch {
    return false
  }
}

/**
 * Spawn a tunnel process with standard configuration
 */
export function spawnTunnelProcess(command: string, args: string[]): ChildProcess {
  return spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
}

/**
 * Poll a function until it returns a value or times out
 */
export async function pollUntil<T>(
  fn: () => Promise<T | null>,
  timeout: number = 30000,
  interval: number = 500
): Promise<T> {
  const start = Date.now()

  while (Date.now() - start < timeout) {
    try {
      const result = await fn()
      if (result !== null) return result
    } catch {
      // Continue polling on error
    }
    await new Promise(r => setTimeout(r, interval))
  }

  throw new Error('Polling timeout')
}

/**
 * Execute shell command and return parsed JSON output
 */
export async function execJson<T = any>(command: string): Promise<T> {
  const { stdout } = await execAsync(command)
  return JSON.parse(stdout)
}
