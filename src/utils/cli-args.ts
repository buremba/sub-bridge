import { Command } from 'commander'

export function addSharedOptions(program: Command) {
  return program
    .option('-p, --port <number>', 'Local proxy port (default: 8787 or next available)')
    .option('--tunnel <url>', 'Existing tunnel URL (e.g., local.buremba.com)')
    .option('--verbose', 'Show full messages and tools without truncation')
}
