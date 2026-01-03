import type { AnthropicResponse } from '../types'

// Anthropic types
interface AnthropicMessage {
  id: string
  model: string
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
  stop_reason?: string
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use'
  id?: string
  name?: string
  text?: string
  input?: unknown
}

interface AnthropicStreamEvent {
  type: string
  message?: AnthropicMessage
  content_block?: AnthropicContentBlock
  delta?: {
    text?: string
    partial_json?: string
    stop_reason?: string
  }
  index?: number
  model?: string
  stop_reason?: string
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

interface AnthropicFullResponse {
  id: string
  model: string
  content: AnthropicContentBlock[]
  stop_reason: string
  usage?: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

// OpenAI types
interface OpenAIStreamChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string
      tool_calls?: Array<{
        index: number
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

interface OpenAIResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string | null
      tool_calls: Array<{
        id: string
        type: 'function'
        function: {
          name: string
          arguments: string
        }
      }>
    }
    finish_reason: string | null
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// Internal types
interface ToolCallTracker {
  id: string
  name: string
  arguments: string
}

interface MetricsData {
  model: string
  stop_reason: string | null
  input_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  output_tokens: number
  messageId: string | null
  openAIId: string | null
}

interface ProcessResult {
  type: 'chunk' | 'done'
  data?: OpenAIStreamChunk
}

// Converter state that needs to be maintained during streaming
export interface ConverterState {
  toolCallsTracker: Map<number, ToolCallTracker>
  metricsData: MetricsData
}

// Create initial converter state
export function createConverterState(): ConverterState {
  return {
    toolCallsTracker: new Map(),
    metricsData: {
      model: '',
      stop_reason: null,
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
      messageId: null,
      openAIId: null,
    },
  }
}

// Convert non-streaming response to OpenAI format (stateless)
export function convertNonStreamingResponse(
  anthropicResponse: AnthropicResponse | AnthropicFullResponse,
): OpenAIResponse {
  const openAIResponse: OpenAIResponse = {
    id:
      'chatcmpl-' +
      (anthropicResponse.id || Date.now()).toString().replace('msg_', ''),
    object: 'chat.completion' as const,
    created: Math.floor(Date.now() / 1000),
    model: anthropicResponse.model || 'claude-unknown',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant' as const,
          content: null,
          tool_calls: [],
        },
        finish_reason:
          anthropicResponse.stop_reason === 'end_turn'
            ? 'stop'
            : anthropicResponse.stop_reason === 'tool_use'
            ? 'tool_calls'
            : anthropicResponse.stop_reason || null,
      },
    ],
    usage: {
      prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
      completion_tokens: anthropicResponse.usage?.output_tokens || 0,
      total_tokens:
        (anthropicResponse.usage?.input_tokens || 0) +
        (anthropicResponse.usage?.output_tokens || 0),
    },
  }

  // Process content blocks
  let textContent = ''
  for (const block of anthropicResponse.content || []) {
    if (block.type === 'text') {
      textContent += block.text
    } else if (block.type === 'tool_use' && block.id && block.name) {
      openAIResponse.choices[0].message.tool_calls.push({
        id: block.id,
        type: 'function' as const,
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
      })
    }
  }

  // Set content only if there's text
  if (textContent) {
    openAIResponse.choices[0].message.content = textContent
  }

  return openAIResponse
}

// Process a chunk and update the state
export function processChunk(
  state: ConverterState,
  chunk: string,
  enableLogging: boolean = false,
): ProcessResult[] {
  const results: ProcessResult[] = []
  const lines = chunk.split('\n')

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (trimmedLine === '') continue

    // Skip event lines in OpenAI format
    if (trimmedLine.startsWith('event:')) {
      continue
    }

    if (trimmedLine.startsWith('data: ') && trimmedLine.includes('{')) {
      try {
        const data: AnthropicStreamEvent = JSON.parse(
          trimmedLine.replace(/^data: /, ''),
        )

        // Skip certain event types that OpenAI doesn't use
        if (data.type === 'ping' || data.type === 'content_block_stop') {
          continue
        }

        // Skip text content_block_start (we only care about tool_use blocks)
        if (
          data.type === 'content_block_start' &&
          data.content_block?.type === 'text'
        ) {
          continue
        }

        // Update metrics
        updateMetrics(state.metricsData, data)

        // Transform to OpenAI format
        const openAIChunk = transformToOpenAI(state, data, enableLogging)

        if (openAIChunk) {
          results.push({
            type: 'chunk',
            data: openAIChunk,
          })
        }

        // Send usage chunk and [DONE] when message stops
        if (data.type === 'message_stop') {
          // Send usage information chunk before [DONE]
          const usageChunk = createUsageChunk(state)
          if (usageChunk) {
            results.push({
              type: 'chunk',
              data: usageChunk,
            })
          }

          results.push({
            type: 'done',
          })
        }
      } catch (parseError) {
        if (enableLogging) {
          console.error('Parse error:', parseError)
        }
      }
    }
  }

  return results
}

// Update metrics data
function updateMetrics(
  metricsData: MetricsData,
  data: AnthropicStreamEvent,
): void {
  if (data.type === 'message_start' && data.message) {
    metricsData.messageId = data.message.id
    if (data.message.model) {
      metricsData.model = data.message.model
    }
  }

  if (data.model) {
    metricsData.model = data.model
  }

  if (data.stop_reason) {
    metricsData.stop_reason = data.stop_reason
  }

  if (data.type === 'message_delta' && data?.delta?.stop_reason) {
    metricsData.stop_reason = data.delta.stop_reason
  }

  if (data.usage) {
    metricsData.input_tokens += data.usage.input_tokens || 0
    metricsData.output_tokens += data.usage.output_tokens || 0
    metricsData.cache_creation_input_tokens +=
      data.usage.cache_creation_input_tokens || 0
    metricsData.cache_read_input_tokens +=
      data.usage.cache_read_input_tokens || 0

  }

  if (data?.message?.usage) {
    if (data?.message?.model) {
      metricsData.model = data.message.model
    }
    metricsData.input_tokens += data.message.usage.input_tokens || 0
    metricsData.output_tokens += data.message.usage.output_tokens || 0
    metricsData.cache_creation_input_tokens +=
      data.message.usage.cache_creation_input_tokens || 0
    metricsData.cache_read_input_tokens +=
      data.message.usage.cache_read_input_tokens || 0

  }

  if (data?.message?.stop_reason) {
    metricsData.stop_reason = data.message.stop_reason
  }
}

// Create usage chunk for OpenAI format
function createUsageChunk(state: ConverterState): OpenAIStreamChunk | null {
  // Only send usage if we have token data
  if (
    state.metricsData.input_tokens === 0 &&
    state.metricsData.output_tokens === 0
  ) {
    return null
  }

  return {
    id: state.metricsData.openAIId || 'chatcmpl-' + Date.now(),
    object: 'chat.completion.chunk' as const,
    created: Math.floor(Date.now() / 1000),
    model: state.metricsData.model || 'claude-unknown',
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: null,
      },
    ],
    usage: {
      prompt_tokens: state.metricsData.input_tokens,
      completion_tokens: state.metricsData.output_tokens,
      total_tokens:
        state.metricsData.input_tokens + state.metricsData.output_tokens,
    },
  }
}

// Transform Anthropic event to OpenAI format
function transformToOpenAI(
  state: ConverterState,
  data: AnthropicStreamEvent,
  enableLogging: boolean = false,
): OpenAIStreamChunk | null {
  let openAIChunk = null

  if (data.type === 'message_start' && data.message) {
    // Generate OpenAI-style ID
    const openAIId = 'chatcmpl-' + data.message.id.replace('msg_', '')
    state.metricsData.openAIId = openAIId

    openAIChunk = {
      id: openAIId,
      object: 'chat.completion.chunk' as const,
      created: Math.floor(Date.now() / 1000),
      model: data.message.model,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null,
        },
      ],
    }
  } else if (
    data.type === 'content_block_start' &&
    data.content_block?.type === 'tool_use'
  ) {
    // Start of tool call - store the tool info for tracking
    if (enableLogging) {
      console.log('🔧 [ANTHROPIC] Tool Start:', {
        type: data.type,
        index: data.index,
        id: data.content_block.id,
        name: data.content_block.name,
      })
    }

    state.toolCallsTracker.set(data.index ?? 0, {
      id: data.content_block.id ?? '',
      name: data.content_block.name ?? '',
      arguments: '',
    })

    openAIChunk = {
      id: state.metricsData.openAIId || 'chatcmpl-' + Date.now(),
      object: 'chat.completion.chunk' as const,
      created: Math.floor(Date.now() / 1000),
      model: state.metricsData.model || 'claude-unknown',
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: data.index ?? 0,
                id: data.content_block.id,
                type: 'function' as const,
                function: {
                  name: data.content_block.name,
                  arguments: '',
                },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }

    if (enableLogging) {
      console.log(
        '📤 [OPENAI] Tool Start Chunk:',
        JSON.stringify(openAIChunk, null, 2),
      )
    }
  } else if (data.type === 'content_block_delta' && data.delta?.partial_json) {
    // Tool call arguments - OpenAI expects incremental string chunks
    if (enableLogging) {
      console.log('🔨 [ANTHROPIC] Tool Arguments Delta:', {
        index: data.index,
        partial_json: data.delta.partial_json,
      })
    }

    const toolCall = state.toolCallsTracker.get(data.index ?? 0)
    if (toolCall) {
      // Anthropic sends partial_json which might be a fragment or accumulated
      let newPart = ''

      // Check if this is a continuation of previous arguments
      if (
        toolCall.arguments &&
        data.delta.partial_json.startsWith(toolCall.arguments)
      ) {
        // It's accumulated - calculate the delta
        newPart = data.delta.partial_json.substring(toolCall.arguments.length)
        toolCall.arguments = data.delta.partial_json
      } else {
        // It's a fragment - append it
        newPart = data.delta.partial_json
        toolCall.arguments += data.delta.partial_json
      }

      if (enableLogging) {
        console.log('📊 [DELTA] Calculation:', {
          index: data.index,
          partial_json: data.delta.partial_json,
          accumulated: toolCall.arguments,
          newPart: newPart,
        })
      }

      openAIChunk = {
        id: state.metricsData.openAIId || 'chatcmpl-' + Date.now(),
        object: 'chat.completion.chunk' as const,
        created: Math.floor(Date.now() / 1000),
        model: state.metricsData.model || 'claude-unknown',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: data.index ?? 0,
                  function: {
                    arguments: newPart,
                  },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }

      if (enableLogging) {
        console.log(
          '📤 [OPENAI] Tool Arguments Chunk:',
          JSON.stringify(openAIChunk, null, 2),
        )
      }
    }
  } else if (data.type === 'content_block_delta' && data.delta?.text) {
    openAIChunk = {
      id: state.metricsData.openAIId || 'chatcmpl-' + Date.now(),
      object: 'chat.completion.chunk' as const,
      created: Math.floor(Date.now() / 1000),
      model: state.metricsData.model || 'claude-unknown',
      choices: [
        {
          index: 0,
          delta: { content: data.delta.text },
          finish_reason: null,
        },
      ],
    }
  } else if (data.type === 'message_delta' && data.delta?.stop_reason) {
    openAIChunk = {
      id: state.metricsData.openAIId || 'chatcmpl-' + Date.now(),
      object: 'chat.completion.chunk' as const,
      created: Math.floor(Date.now() / 1000),
      model: state.metricsData.model || 'claude-unknown',
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason:
            data.delta.stop_reason === 'end_turn'
              ? 'stop'
              : data.delta.stop_reason === 'tool_use'
              ? 'tool_calls'
              : data.delta.stop_reason,
        },
      ],
    }
  }

  return openAIChunk as OpenAIStreamChunk | null
}
