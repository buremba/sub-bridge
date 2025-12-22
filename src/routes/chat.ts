/**
 * Chat completion routes - handles OpenAI and Claude API proxying
 */
import { Hono, Context } from 'hono'
import { stream } from 'hono/streaming'
import {
  createConverterState,
  processChunk,
  convertNonStreamingResponse,
} from '../utils/anthropic-to-openai-converter'
import {
  isCursorKeyCheck,
  createCursorBypassResponse,
} from '../utils/cursor-byok-bypass'
import { logRequest, logResponse, logError } from '../utils/logger'
import { getChatGptInstructions } from '../utils/chatgpt-instructions'
import { convertToResponsesFormat } from '../utils/chat-to-responses'

// Model alias mapping (short names → full Claude model IDs)
const MODEL_ALIASES: Record<string, string> = {
  'opus-4.5': 'claude-opus-4-5-20251101',
  'sonnet-4.5': 'claude-sonnet-4-5-20250514',
}

interface ModelMapping {
  from: string   // e.g., 'o3'
  to: string     // e.g., 'claude-opus-4-5-20251101'
}

interface KeyConfig {
  mappings: ModelMapping[]
  apiKey: string
  accountId?: string
}

interface ParsedKeys {
  configs: KeyConfig[]
  defaultKey?: string   // fallback for ultrathink/unmatched
  defaultAccountId?: string
}

interface TokenInfo {
  token: string
  accountId?: string
}

const CHATGPT_BASE_URL = process.env.CHATGPT_BASE_URL || 'https://chatgpt.com/backend-api/codex'
const CHATGPT_DEFAULT_MODEL = process.env.CHATGPT_DEFAULT_MODEL || 'gpt-5.2-codex'

function splitProviderTokens(fullToken: string): string[] {
  if (!fullToken) return []
  const bySpace = fullToken.split(/\s+/).filter(Boolean)
  if (bySpace.length > 1) return bySpace

  const single = bySpace[0] || ''
  if (!single.includes(',')) return single ? [single] : []

  const lastColon = single.lastIndexOf(':')
  if (lastColon !== -1) {
    const mappingPart = single.slice(0, lastColon)
    const tokenPart = single.slice(lastColon + 1)
    if (tokenPart.includes(',')) {
      const splitTokens = tokenPart.split(',').map((t) => t.trim()).filter(Boolean)
      if (splitTokens.length > 0) {
        return [`${mappingPart}:${splitTokens[0]}`, ...splitTokens.slice(1)]
      }
    }
  }

  return single.split(',').map((t) => t.trim()).filter(Boolean)
}

function parseTokenWithAccount(token: string): TokenInfo {
  const hashIndex = token.indexOf('#')
  if (hashIndex > 0) {
    return {
      token: token.slice(0, hashIndex),
      accountId: token.slice(hashIndex + 1),
    }
  }
  return { token }
}

function isJwtToken(token: string): boolean {
  const parts = token.split('.')
  return parts.length === 3 && parts.every((p) => p.length > 0)
}

function normalizeChatGptModel(requestedModel: string): string {
  if (!requestedModel) return CHATGPT_DEFAULT_MODEL
  if (requestedModel.includes('codex')) return requestedModel
  if (requestedModel.startsWith('gpt-5.2')) return CHATGPT_DEFAULT_MODEL
  if (requestedModel.startsWith('gpt-5')) return CHATGPT_DEFAULT_MODEL
  return CHATGPT_DEFAULT_MODEL
}

/**
 * Parse routed API keys from Authorization header
 * Format: "o3=opus-4.5,o3-mini=sonnet-4.5:sk-ant-xxx sk-xxx" (space-separated tokens; comma fallback supported) or just "sk-ant-xxx" for default
 */
function parseRoutedKeys(authHeader: string | undefined): ParsedKeys {
  if (!authHeader) return { configs: [] }
  const fullToken = authHeader.replace(/^Bearer\s+/i, '').trim()

  // Split by space (or comma fallback) to handle multiple provider tokens
  const tokens = splitProviderTokens(fullToken)
  const configs: KeyConfig[] = []
  let defaultKey: string | undefined
  let defaultAccountId: string | undefined

  for (const token of tokens) {
    if (!token) continue

    // Check if it's a routed key (contains '=')
    if (!token.includes('=')) {
      // Plain key without routing - use as default
      if (!defaultKey) {
        const parsed = parseTokenWithAccount(token)
        defaultKey = parsed.token
        defaultAccountId = parsed.accountId
      }
      continue
    }

    // Split by last colon to separate mappings from key
    const lastColon = token.lastIndexOf(':')
    if (lastColon === -1) {
      // No colon found in routed key, skip it
      continue
    }

    const mappingsPart = token.slice(0, lastColon)
    const parsedToken = parseTokenWithAccount(token.slice(lastColon + 1))
    const apiKey = parsedToken.token

    const mappings = mappingsPart.split(',').map(m => {
      const [from, to] = m.split('=')
      const resolvedTo = MODEL_ALIASES[to] || to
      return { from: from.trim(), to: resolvedTo }
    })

    configs.push({ mappings, apiKey, accountId: parsedToken.accountId })
  }

  return { configs, defaultKey, defaultAccountId }
}

/**
 * Find the Claude model and API key for a given requested model
 */
function resolveModelRouting(requestedModel: string, parsedKeys: ParsedKeys): { claudeModel: string; apiKey: string } | null {
  // Check all configs for a matching route
  for (const config of parsedKeys.configs) {
    for (const mapping of config.mappings) {
      if (mapping.from === requestedModel) {
        return { claudeModel: mapping.to, apiKey: config.apiKey }
      }
    }
  }

  // If model starts with 'claude-', use default key
  if (requestedModel.startsWith('claude-') && parsedKeys.defaultKey) {
    return { claudeModel: requestedModel, apiKey: parsedKeys.defaultKey }
  }

  // Fallback to default key with the model as-is (for ultrathink)
  if (parsedKeys.defaultKey) {
    return { claudeModel: requestedModel, apiKey: parsedKeys.defaultKey }
  }

  return null
}

function convertMessages(messages: any[]): any[] {
  const converted: any[] = []

  for (const msg of messages) {
    if (msg.type === 'custom_tool_call' || msg.type === 'function_call') {
      let toolInput = msg.input || msg.arguments
      if (typeof toolInput === 'string') {
        try { toolInput = JSON.parse(toolInput) } catch { toolInput = { command: toolInput } }
      }
      const toolUse = { type: 'tool_use', id: msg.call_id, name: msg.name, input: toolInput || {} }
      const last = converted[converted.length - 1]
      if (last?.role === 'assistant' && Array.isArray(last.content)) last.content.push(toolUse)
      else converted.push({ role: 'assistant', content: [toolUse] })
      continue
    }

    if (msg.type === 'custom_tool_call_output' || msg.type === 'function_call_output') {
      const toolResult = { type: 'tool_result', tool_use_id: msg.call_id, content: msg.output || '' }
      const last = converted[converted.length - 1]
      if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') last.content.push(toolResult)
      else converted.push({ role: 'user', content: [toolResult] })
      continue
    }

    if (!msg.role) continue

    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const content: any[] = msg.content ? [{ type: 'text', text: msg.content }] : []
      for (const tc of msg.tool_calls) {
        content.push({
          type: 'tool_use', id: tc.id, name: tc.function?.name || tc.name,
          input: typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function?.arguments || tc.arguments || {})
        })
      }
      converted.push({ role: 'assistant', content })
      continue
    }

    if (msg.role === 'tool') {
      const toolResult = { type: 'tool_result', tool_use_id: msg.tool_call_id, content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }
      const last = converted[converted.length - 1]
      if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') last.content.push(toolResult)
      else converted.push({ role: 'user', content: [toolResult] })
      continue
    }

    converted.push({ role: msg.role, content: msg.content ?? '' })
  }

  const last = converted[converted.length - 1]
  if (last?.role === 'assistant') {
    if (typeof last.content === 'string') last.content = last.content.trimEnd() || '...'
    else if (Array.isArray(last.content)) {
      for (const block of last.content) {
        if (block.type === 'text') block.text = (block.text?.trimEnd()) || '...'
      }
    }
  }

  return converted
}

function toResponseContentItems(content: any, role: string): any[] {
  const items: any[] = []
  const textType = role === 'assistant' ? 'output_text' : 'input_text'

  if (typeof content === 'string') {
    if (content.trim()) items.push({ type: textType, text: content })
    return items
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block) continue
      // Handle both 'text' (OpenAI format) and 'input_text'/'output_text' (Responses API format)
      if ((block.type === 'text' || block.type === 'input_text' || block.type === 'output_text') && typeof block.text === 'string') {
        items.push({ type: textType, text: block.text })
      } else if (block.type === 'image_url') {
        const url = typeof block.image_url === 'string' ? block.image_url : block.image_url?.url
        if (typeof url === 'string' && url) items.push({ type: 'input_image', image_url: url })
      }
    }
    return items
  }

  if (content !== null && content !== undefined) {
    items.push({ type: textType, text: JSON.stringify(content) })
  }
  return items
}

function buildChatGptResponsesBody(body: any, requestedModel: string, isStreaming: boolean) {
  // ChatGPT backend requires EXACTLY the base codex prompt as instructions
  const instructions = getChatGptInstructions()

  // Use the robust converter to handle all message formats
  const { input, developerMessages } = convertToResponsesFormat(body)

  // Prepend developer messages to input
  const fullInput = [...developerMessages, ...input]

  // Fallback if no input
  if (fullInput.length === 0) {
    fullInput.push({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Hello.' }],
    })
  }

  const tools = Array.isArray(body.tools) ? body.tools : []

  return {
    model: requestedModel,
    instructions,
    input: fullInput,
    tools,
    tool_choice: 'auto',
    parallel_tool_calls: false,
    stream: true,  // Backend REQUIRES stream: true
    store: false,
  }
}

function createChatGptStreamState(model: string) {
  const now = Math.floor(Date.now() / 1000)
  return {
    buffer: '',
    id: `chatcmpl-${Date.now().toString(36)}`,
    model,
    created: now,
    roleSent: false,
    sawTextDelta: false,
    toolCallsSeen: false,
    toolCallIndex: 0,
  }
}

function createChatChunk(state: ReturnType<typeof createChatGptStreamState>, delta: any, finishReason: string | null, usage?: any) {
  return {
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
    ...(usage ? { usage } : {}),
  }
}

function mapUsage(usage: any) {
  if (!usage) return undefined
  const prompt = usage.input_tokens ?? usage.prompt_tokens ?? 0
  const completion = usage.output_tokens ?? usage.completion_tokens ?? 0
  const total = usage.total_tokens ?? (prompt + completion)
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  }
}

function convertResponsesToChatCompletion(responseData: any, requestedModel: string) {
  const output = responseData?.output || responseData?.response?.output || []
  const model = responseData?.model || requestedModel
  const responseId = responseData?.id || responseData?.response?.id || `resp_${Date.now()}`

  let content = ''
  const toolCalls: any[] = []

  for (const item of output) {
    if (item?.type === 'message' && item.role === 'assistant') {
      const blocks = Array.isArray(item.content) ? item.content : []
      for (const block of blocks) {
        if (block?.type === 'output_text' && typeof block.text === 'string') {
          content += block.text
        }
      }
    } else if (item?.type === 'function_call') {
      toolCalls.push({
        id: item.call_id || item.id || `call_${toolCalls.length}`,
        type: 'function',
        function: {
          name: item.name || 'unknown',
          arguments: item.arguments || '',
        },
      })
    }
  }

  return {
    id: `chatcmpl-${responseId.toString().replace(/^resp_/, '')}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls,
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      },
    ],
    usage: mapUsage(responseData?.usage || responseData?.response?.usage) || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  }
}

function processChatGptChunk(state: ReturnType<typeof createChatGptStreamState>, chunk: string) {
  state.buffer += chunk
  const results: Array<{ type: 'chunk' | 'done'; data?: any }> = []
  const parts = state.buffer.split('\n\n')
  state.buffer = parts.pop() || ''

  for (const part of parts) {
    const lines = part.split('\n')
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let payload: any
      try {
        payload = JSON.parse(data)
      } catch {
        continue
      }
      const kind = payload?.type
      if (kind === 'response.created' && payload.response?.id) {
        state.id = `chatcmpl-${String(payload.response.id).replace(/^resp_/, '')}`
        continue
      }
      if (kind === 'response.output_text.delta' && typeof payload.delta === 'string') {
        const delta: any = { content: payload.delta }
        if (!state.roleSent) {
          delta.role = 'assistant'
          state.roleSent = true
        }
        state.sawTextDelta = true
        results.push({ type: 'chunk', data: createChatChunk(state, delta, null) })
        continue
      }
      if (kind === 'response.output_item.done' && payload.item) {
        const item = payload.item
        if (item.type === 'message' && item.role === 'assistant' && !state.sawTextDelta) {
          const blocks = Array.isArray(item.content) ? item.content : []
          const text = blocks
            .filter((b: any) => b?.type === 'output_text' && typeof b.text === 'string')
            .map((b: any) => b.text)
            .join('')
          if (text) {
            const delta: any = { content: text }
            if (!state.roleSent) {
              delta.role = 'assistant'
              state.roleSent = true
            }
            results.push({ type: 'chunk', data: createChatChunk(state, delta, null) })
          }
        } else if (item.type === 'function_call') {
          state.toolCallsSeen = true
          const delta: any = {
            tool_calls: [
              {
                index: state.toolCallIndex++,
                id: item.call_id || item.id || `call_${state.toolCallIndex}`,
                type: 'function',
                function: {
                  name: item.name || 'unknown',
                  arguments: item.arguments || '',
                },
              },
            ],
          }
          if (!state.roleSent) {
            delta.role = 'assistant'
            state.roleSent = true
          }
          results.push({ type: 'chunk', data: createChatChunk(state, delta, null) })
        }
        continue
      }
      if (kind === 'response.completed') {
        const usage = mapUsage(payload.response?.usage)
        const finish = state.toolCallsSeen ? 'tool_calls' : 'stop'
        results.push({ type: 'chunk', data: createChatChunk(state, {}, finish, usage) })
        results.push({ type: 'done' })
      }
    }
  }

  return results
}

async function handleOpenAIProxy(c: Context, body: any, requestedModel: string, openaiToken: string, isStreaming: boolean) {
  logRequest('openai', requestedModel, {})

  // Forward request directly to OpenAI API
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${openaiToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logError(errorText.slice(0, 200))

    // Try to parse OpenAI error
    try {
      const openAIError = JSON.parse(errorText)
      return c.json(openAIError, response.status as any)
    } catch (parseError) {
      return new Response(errorText, { status: response.status })
    }
  }

  logResponse(response.status)

  // For streaming, pass through the stream
  if (isStreaming) {
    return new Response(response.body, {
      status: response.status,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      },
    })
  } else {
    // For non-streaming, pass through the JSON response
    const responseData = await response.json()
    return c.json(responseData)
  }
}

async function handleChatGptProxy(
  c: Context,
  body: any,
  requestedModel: string,
  tokenInfo: TokenInfo,
  isStreaming: boolean,
) {
  const chatgptModel = normalizeChatGptModel(requestedModel)
  // DEBUG: Log full body
  console.error('DEBUG full body:', JSON.stringify(body, null, 2).slice(0, 3000))
  const responseBody = buildChatGptResponsesBody(body, chatgptModel, isStreaming)
  // DEBUG: Log actual input being sent
  console.error('DEBUG input:', JSON.stringify(responseBody.input, null, 2))
  logRequest('chatgpt', `${requestedModel} → ${chatgptModel}`, {
    system: responseBody.instructions,
    messages: responseBody.input,
    tools: responseBody.tools,
  })

  if (!tokenInfo.accountId) {
    return c.json({
      error: {
        message: 'ChatGPT account id missing. Re-login to refresh your ChatGPT token.',
        type: 'authentication_error',
        code: 'authentication_error',
      }
    }, 401)
  }

  const baseUrl = CHATGPT_BASE_URL.replace(/\/$/, '')

  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${tokenInfo.token}`,
      'chatgpt-account-id': tokenInfo.accountId,
      'originator': 'codex_cli_rs',
      'accept': 'text/event-stream',  // Backend always requires streaming
    },
    body: JSON.stringify(responseBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logError(errorText.slice(0, 200))
    try {
      const parsed = JSON.parse(errorText)
      return c.json(parsed, response.status as any)
    } catch {
      return new Response(errorText, { status: response.status })
    }
  }

  logResponse(response.status)

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const state = createChatGptStreamState(chatgptModel)

  if (isStreaming) {
    return stream(c, async (s) => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const results = processChatGptChunk(state, chunk)
        for (const result of results) {
          if (result.type === 'chunk') {
            await s.write(`data: ${JSON.stringify(result.data)}\n\n`)
          } else if (result.type === 'done') {
            await s.write('data: [DONE]\n\n')
          }
        }
      }
      reader.releaseLock()
    })
  }

  // Non-streaming: aggregate the stream into a final response
  let fullContent = ''
  const toolCalls: any[] = []
  let usage: any = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    const results = processChatGptChunk(state, chunk)
    for (const result of results) {
      if (result.type === 'chunk' && result.data?.choices?.[0]?.delta) {
        const delta = result.data.choices[0].delta
        if (delta.content) fullContent += delta.content
        if (delta.tool_calls) toolCalls.push(...delta.tool_calls)
        if (result.data.usage) usage = result.data.usage
      }
    }
  }
  reader.releaseLock()

  return c.json({
    id: state.id,
    object: 'chat.completion',
    created: state.created,
    model: chatgptModel,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: fullContent || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    }],
    usage: usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  })
}

async function handleChatCompletion(c: Context) {
  const body = await c.req.json()
  const requestedModel = body.model || ''
  const isStreaming = body.stream === true

  if (isCursorKeyCheck(body)) {
    logRequest('bypass', requestedModel, {})
    logResponse(200)
    return c.json(createCursorBypassResponse())
  }

  const parsedKeys = parseRoutedKeys(c.req.header('authorization'))
  const routing = resolveModelRouting(requestedModel, parsedKeys)
  const isClaude = routing !== null && (routing.claudeModel.startsWith('claude-') || parsedKeys.configs.some(c => c.mappings.some(m => m.from === requestedModel)))

  // If not a Claude model and we have a default key, proxy to OpenAI or ChatGPT backend
  if (!isClaude && parsedKeys.defaultKey) {
    const tokenInfo: TokenInfo = {
      token: parsedKeys.defaultKey,
      accountId: parsedKeys.defaultAccountId,
    }
    const useChatGpt = Boolean(tokenInfo.accountId) || isJwtToken(tokenInfo.token)
    if (useChatGpt) {
      return handleChatGptProxy(c, body, requestedModel, tokenInfo, isStreaming)
    }
    return handleOpenAIProxy(c, body, requestedModel, tokenInfo.token, isStreaming)
  }

  if (!isClaude || !routing) {
    logRequest('bypass', requestedModel, {})
    const instructions = `Model "${requestedModel}" not configured. Set up routing in your API key:

Format: o3=opus-4.5,o3-mini=sonnet-4.5:sk-ant-xxx

Examples:
  o3=opus-4.5:sk-ant-xxx              # Single routing
  o3=opus-4.5,o3-mini=sonnet-4.5:sk-ant-xxx  # Multiple routings
  sk-ant-xxx                          # Default key for claude-* models`
    return c.json({
      id: 'error', object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: instructions }, finish_reason: 'stop' }]
    })
  }

  const { claudeModel, apiKey: anthropicKey } = routing

  body.model = claudeModel

  if (body.input !== undefined && !body.messages) {
    if (typeof body.input === 'string') body.messages = [{ role: 'user', content: body.input }]
    else if (Array.isArray(body.input)) body.messages = body.input
    if (body.user && typeof body.user === 'string') body.messages = [{ role: 'system', content: body.user }, ...body.messages]
  }

  const systemMessages = body.messages?.filter((msg: any) => msg.role === 'system') || []
  body.messages = body.messages?.filter((msg: any) => msg.role !== 'system') || []

  if (body.messages.length === 0) {
    logError('No user messages in request')
    return c.json({ error: 'No messages provided' }, 400)
  }

  body.system = [
    { type: 'text', text: "You are Claude Code, Anthropic's official CLI for Claude." },
    ...systemMessages.map((msg: any) => ({ type: 'text', text: msg.content || '' })),
  ]

  const contextSize = JSON.stringify(body.messages || []).length
  const contextTokensEstimate = Math.ceil(contextSize / 4)
  const systemText = body.system.map((s: any) => s.text).join('\n')
  logRequest('claude', `${requestedModel} → ${claudeModel}`, {
    system: systemText, messages: body.messages, tools: body.tools, tokens: contextTokensEstimate
  })

  body.max_tokens = claudeModel.includes('opus') ? 32_000 : 64_000
  body.messages = convertMessages(body.messages)

  if (body.tools?.length) {
    body.tools = body.tools.map((tool: any, idx: number) => {
      let converted: any
      if (tool.type === 'function' && tool.function) {
        converted = { name: tool.function.name, description: tool.function.description || '', input_schema: tool.function.parameters || { type: 'object', properties: {} } }
      } else if (tool.name) {
        converted = { name: tool.name, description: tool.description || '', input_schema: tool.input_schema || tool.parameters || { type: 'object', properties: {} } }
      } else { converted = tool }
      if (idx === body.tools.length - 1) converted.cache_control = { type: 'ephemeral' }
      return converted
    })
  }

  if (body.tool_choice === 'auto') body.tool_choice = { type: 'auto' }
  else if (body.tool_choice === 'none' || body.tool_choice === null) delete body.tool_choice
  else if (body.tool_choice === 'required') body.tool_choice = { type: 'any' }
  else if (body.tool_choice?.function?.name) body.tool_choice = { type: 'tool', name: body.tool_choice.function.name }

  if (body.system.length > 0) body.system[body.system.length - 1].cache_control = { type: 'ephemeral' }

  const cleanBody: any = {}
  const allowedFields = ['model', 'messages', 'max_tokens', 'stop_sequences', 'stream', 'system', 'temperature', 'top_p', 'top_k', 'tools', 'tool_choice']
  for (const field of allowedFields) if (body[field] !== undefined) cleanBody[field] = body[field]

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${anthropicKey}`,
      'anthropic-beta': 'oauth-2025-04-20,prompt-caching-2024-07-31',
      'anthropic-version': '2023-06-01',
      'accept': isStreaming ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(cleanBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logError(errorText.slice(0, 200))

    // Try to parse the Anthropic error and convert to OpenAI format
    try {
      const anthropicError = JSON.parse(errorText)
      const errorMessage = anthropicError.error?.message || 'Unknown error'
      const errorType = anthropicError.error?.type || 'api_error'

      // Map Anthropic error types to user-friendly messages
      let userMessage = errorMessage
      if (errorType === 'rate_limit_error') {
        userMessage = `Rate limit exceeded: ${errorMessage}`
      } else if (errorType === 'authentication_error') {
        userMessage = `Authentication failed: ${errorMessage}`
      } else if (errorType === 'invalid_request_error') {
        userMessage = `Invalid request: ${errorMessage}`
      }

      // Return OpenAI-compatible error format
      const openAIError = {
        error: {
          message: userMessage,
          type: errorType,
          code: errorType,
        }
      }

      return c.json(openAIError, response.status as any)
    } catch (parseError) {
      // If parsing fails, return raw error
      return new Response(errorText, { status: response.status })
    }
  }

  logResponse(response.status)

  if (isStreaming) {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    const converterState = createConverterState()
    return stream(c, async (s) => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        const results = processChunk(converterState, chunk, false)
        for (const result of results) {
          if (result.type === 'chunk') await s.write(`data: ${JSON.stringify(result.data)}\n\n`)
          else if (result.type === 'done') await s.write('data: [DONE]\n\n')
        }
      }
      reader.releaseLock()
    })
  } else {
    const responseData = await response.json()
    const openAIResponse = convertNonStreamingResponse(responseData as any)
    return c.json(openAIResponse)
  }
}

export function createChatRoutes() {
  const app = new Hono()

  // Models endpoint
  app.get('/models', async (c) => {
    const response = await fetch('https://models.dev/api.json')
    if (!response.ok) return c.json({ object: 'list', data: [] })
    const modelsData = await response.json() as any
    const anthropicModels = modelsData.anthropic?.models || {}
    const models = Object.entries(anthropicModels).map(([modelId, modelData]: [string, any]) => ({
      id: modelId, object: 'model' as const,
      created: Math.floor(new Date(modelData.release_date || '1970-01-01').getTime() / 1000),
      owned_by: 'anthropic',
    }))
    return c.json({ object: 'list', data: models })
  })

  // Chat completions
  app.post('/chat/completions', (c) => handleChatCompletion(c))
  app.post('/messages', (c) => handleChatCompletion(c))

  return app
}
