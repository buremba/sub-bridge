/**
 * Logging utilities for request/response logging
 */
import chalk from 'chalk'

export const log = (...args: Parameters<typeof console.error>) => console.error(...args)

let verboseMode = false

export function setVerbose(verbose: boolean) {
  verboseMode = verbose
}

export function isVerbose(): boolean {
  return verboseMode
}

let requestCounter = 0

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 3) + '...'
}

export function logRequest(
  route: 'claude' | 'openai' | 'chatgpt' | 'bypass',
  model: string,
  data: {
    system?: string
    messages?: any[]
    tools?: any[]
    tokens?: number
  }
) {
  requestCounter++
  const routeColors = { claude: chalk.cyan, openai: chalk.yellow, chatgpt: chalk.green, bypass: chalk.gray }
  const routeLabels = { claude: 'Claude', openai: 'OpenAI', chatgpt: 'ChatGPT', bypass: 'Bypass' }
  const roleColors: Record<string, typeof chalk.blue> = {
    user: chalk.blue, assistant: chalk.green, system: chalk.magenta, tool: chalk.yellow
  }

  log()
  const tokenInfo = data.tokens ? ` ${chalk.dim(`(~${data.tokens.toLocaleString()} tokens)`)}` : ''
  log(`${routeColors[route]('⏺')} ${chalk.bold(routeLabels[route])} ${chalk.dim(`#${requestCounter}`)} ${chalk.dim('·')} ${model}${tokenInfo}`)

  if (data.tools?.length) {
    log()
    log(`  ${chalk.green('⏺')} ${chalk.green('Tools')} ${chalk.dim(`(${data.tools.length})`)}`)
    const toolNames = data.tools.map((t: any) => t.name || t.function?.name || '?')
    if (verboseMode) {
      for (const name of toolNames) log(`    ${chalk.dim(name)}`)
    } else {
      const shown = toolNames.slice(0, 8)
      log(`    ${chalk.dim(shown.join(', '))}${toolNames.length > 8 ? chalk.dim(` ... +${toolNames.length - 8} more`) : ''}`)
    }
  }

  if (data.system) {
    log()
    log(`  ${chalk.magenta('⏺')} ${chalk.magenta('System')}`)
    if (verboseMode) {
      for (const line of data.system.split('\n')) log(`    ${chalk.dim(line)}`)
    } else {
      const preview = data.system.replace(/\n/g, ' ').slice(0, 200)
      log(`    ${chalk.dim(preview)}${data.system.length > 200 ? '...' : ''}`)
    }
  }

  if (data.messages?.length) {
    log()
    const messagesToShow = verboseMode ? data.messages : data.messages.slice(-5)
    if (!verboseMode && data.messages.length > 5) {
      log(`  ${chalk.dim('⏺')} ${chalk.dim(`... ${data.messages.length - 5} earlier messages`)}`)
      log()
    }
    for (const msg of messagesToShow) {
      let role = msg.role
      if (!role) {
        if (msg.type === 'human') role = 'user'
        else if (msg.type === 'ai') role = 'assistant'
        else if (msg.type === 'function' || msg.type === 'tool') role = 'tool'
        else if (msg.type === 'system') role = 'system'
        else if (msg.type === 'function_call') role = 'tool'
        else if (msg.type === 'function_call_output') role = 'tool'
      }
      let content = ''

      // Handle Responses API function_call type
      if (msg.type === 'function_call') {
        const argsPreview = verboseMode ? msg.arguments : truncate(msg.arguments || '', 50)
        content = `[call: ${msg.name}(${argsPreview})]`
      }
      // Handle Responses API function_call_output type
      else if (msg.type === 'function_call_output') {
        const outputPreview = verboseMode ? String(msg.output || '') : truncate(String(msg.output || ''), 50)
        content = `[result: ${outputPreview}]`
      }
      // Handle regular message content
      else if (typeof msg.content === 'string') {
        content = msg.content
      } else if (Array.isArray(msg.content)) {
        const parts: string[] = []
        for (const block of msg.content) {
          if ((block.type === 'text' || block.type === 'input_text' || block.type === 'output_text') && block.text) {
            parts.push(block.text)
          } else if (block.type === 'tool_use') parts.push(`[tool: ${block.name}]`)
          else if (block.type === 'tool_result') {
            const resultContent = verboseMode ? String(block.content || '') : truncate(String(block.content || ''), 50)
            parts.push(`[result: ${resultContent}]`)
          } else if (block.type === 'image' || block.type === 'image_url' || block.type === 'input_image') parts.push('[image]')
          else parts.push(`[${block.type || '?'}]`)
        }
        content = parts.join(' ')
      }
      if (msg.tool_calls?.length) {
        const toolNames = msg.tool_calls.map((tc: any) => tc.function?.name || tc.name || '?')
        content = content ? `${content} → [tools: ${toolNames.join(', ')}]` : `[tools: ${toolNames.join(', ')}]`
      }
      if (!role && !content) continue
      if (!role) role = 'unknown'
      const color = roleColors[role] || chalk.gray
      log(`  ${color('⏺')} ${color(role)}`)
      if (verboseMode) {
        for (const line of content.split('\n')) log(`    ${chalk.dim(line)}`)
      } else {
        const preview = content.replace(/\n/g, ' ').slice(0, 150)
        log(`    ${chalk.dim(preview)}${content.length > 150 ? '...' : ''}`)
      }
    }
  }
}

export function logResponse(status: number, tokens?: { input?: number, output?: number, cached?: number }) {
  const statusColor = status < 400 ? chalk.green : chalk.red
  const statusText = status < 400 ? 'OK' : 'Error'
  let tokenInfo = ''
  if (tokens?.input || tokens?.output) {
    const parts = []
    if (tokens.input) parts.push(`${tokens.input} in`)
    if (tokens.output) parts.push(`${tokens.output} out`)
    if (tokens.cached) parts.push(chalk.cyan(`${tokens.cached} cached`))
    tokenInfo = ` ${chalk.dim('·')} ${parts.join(' → ')}`
  }
  log()
  log(`  ${statusColor('⏺')} ${statusColor(statusText)} ${chalk.dim(status)}${tokenInfo}`)
  log()
}

export function logError(message: string) {
  log()
  log(`  ${chalk.red('⏺')} ${chalk.red('Error')}: ${message}`)
  log()
}

export function logHeaders(label: string, headers: Record<string, string>) {
  if (!verboseMode) return
  log()
  log(`  ${chalk.cyan('⏺')} ${chalk.cyan(label)}`)
  for (const [key, value] of Object.entries(headers)) {
    const displayValue = key.toLowerCase().includes('auth') ? truncate(value, 20) : value
    log(`    ${chalk.dim(key)}: ${chalk.dim(displayValue)}`)
  }
}

export function logStreamChunk(chunk: string) {
  if (!verboseMode) return
  log(`  ${chalk.gray('⏺')} ${chalk.gray('Stream chunk')} ${chalk.dim(`(${chunk.length} bytes)`)}`)
  for (const line of chunk.split('\n').slice(0, 5)) {
    if (line) log(`    ${chalk.dim(truncate(line, 100))}`)
  }
  if (chunk.split('\n').length > 5) {
    log(`    ${chalk.dim('...')}`)
  }
}
