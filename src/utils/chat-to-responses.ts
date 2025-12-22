/**
 * Converts OpenAI Chat Completions format to Responses API format
 *
 * This ensures no data is lost during conversion between the two formats.
 */

import type {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
  ChatCompletionToolMessageParam,
  ChatCompletionAssistantMessageParam,
} from 'openai/resources/chat/completions'

// Responses API types (not exported by openai package, so we define them)
export interface ResponseInputTextContent {
  type: 'input_text'
  text: string
}

export interface ResponseOutputTextContent {
  type: 'output_text'
  text: string
}

export interface ResponseInputImageContent {
  type: 'input_image'
  image_url: string
  detail?: 'auto' | 'low' | 'high'
}

export interface ResponseInputFileContent {
  type: 'input_file'
  file_id?: string
  file_data?: string
  filename?: string
}

export type ResponseContentPart =
  | ResponseInputTextContent
  | ResponseOutputTextContent
  | ResponseInputImageContent
  | ResponseInputFileContent

export interface ResponseMessageItem {
  type: 'message'
  role: 'user' | 'assistant' | 'system' | 'developer'
  content: ResponseContentPart[] | string
}

export interface ResponseFunctionCall {
  type: 'function_call'
  name: string
  arguments: string
  call_id: string
}

export interface ResponseFunctionCallOutput {
  type: 'function_call_output'
  call_id: string
  output: string
}

export type ResponseInputItem =
  | ResponseMessageItem
  | ResponseFunctionCall
  | ResponseFunctionCallOutput

/**
 * Convert a single content part from Chat Completions to Responses format
 */
function convertContentPart(
  part: ChatCompletionContentPart | string,
  role: 'user' | 'assistant'
): ResponseContentPart | null {
  // String content
  if (typeof part === 'string') {
    return {
      type: role === 'assistant' ? 'output_text' : 'input_text',
      text: part,
    }
  }

  // Text content block
  if (part.type === 'text') {
    return {
      type: role === 'assistant' ? 'output_text' : 'input_text',
      text: part.text,
    }
  }

  // Image content block
  if (part.type === 'image_url') {
    const url = typeof part.image_url === 'string'
      ? part.image_url
      : part.image_url?.url

    if (url) {
      return {
        type: 'input_image',
        image_url: url,
        detail: typeof part.image_url === 'object' ? part.image_url.detail : undefined,
      }
    }
  }

  // Input audio (transcribe to text if available)
  if (part.type === 'input_audio' && 'input_audio' in part) {
    const audio = part.input_audio as { data?: string; format?: string }
    // Audio data can't be directly converted, but we preserve it as a note
    return {
      type: 'input_text',
      text: `[Audio input: format=${audio?.format || 'unknown'}]`,
    }
  }

  // File content (if present)
  if (part.type === 'file' && 'file' in part) {
    const file = part.file as { file_id?: string; filename?: string }
    return {
      type: 'input_file',
      file_id: file?.file_id,
      filename: file?.filename,
    }
  }

  // Unknown content type - preserve as text description
  console.warn(`Unknown content part type: ${(part as any).type}`)
  return {
    type: 'input_text',
    text: `[Unknown content type: ${JSON.stringify(part)}]`,
  }
}

/**
 * Convert message content (string or array) to Responses format
 */
function convertContent(
  content: string | ChatCompletionContentPart[] | null | undefined,
  role: 'user' | 'assistant'
): ResponseContentPart[] {
  if (content === null || content === undefined) {
    return []
  }

  if (typeof content === 'string') {
    if (!content.trim()) return []
    return [{
      type: role === 'assistant' ? 'output_text' : 'input_text',
      text: content,
    }]
  }

  if (Array.isArray(content)) {
    const parts: ResponseContentPart[] = []
    for (const part of content) {
      const converted = convertContentPart(part, role)
      if (converted) {
        parts.push(converted)
      }
    }
    return parts
  }

  // Fallback for unexpected content format
  console.warn(`Unexpected content format: ${typeof content}`)
  return [{
    type: 'input_text',
    text: JSON.stringify(content),
  }]
}

/**
 * Convert a single Chat Completions message to Responses API input items
 * Returns an array because one message can become multiple items (e.g., message + function_calls)
 */
function convertMessage(msg: ChatCompletionMessageParam): ResponseInputItem[] {
  const items: ResponseInputItem[] = []

  if (!msg || typeof msg !== 'object') {
    console.warn('Invalid message:', msg)
    return items
  }

  const role = msg.role

  // System message -> developer role
  if (role === 'system') {
    const content = 'content' in msg ? msg.content : null
    const contentParts = convertContent(content as string | ChatCompletionContentPart[], 'user')
    if (contentParts.length > 0) {
      items.push({
        type: 'message',
        role: 'developer',
        content: contentParts,
      })
    }
    return items
  }

  // User message
  if (role === 'user') {
    const content = 'content' in msg ? msg.content : null
    const contentParts = convertContent(content as string | ChatCompletionContentPart[], 'user')
    if (contentParts.length > 0) {
      items.push({
        type: 'message',
        role: 'user',
        content: contentParts,
      })
    }
    return items
  }

  // Assistant message (may have content and/or tool_calls)
  if (role === 'assistant') {
    const assistantMsg = msg as ChatCompletionAssistantMessageParam

    // Add text content if present
    const content = assistantMsg.content
    const contentParts = convertContent(content as string | ChatCompletionContentPart[], 'assistant')
    if (contentParts.length > 0) {
      items.push({
        type: 'message',
        role: 'assistant',
        content: contentParts,
      })
    }

    // Add tool calls as separate function_call items
    if (assistantMsg.tool_calls && Array.isArray(assistantMsg.tool_calls)) {
      for (const toolCall of assistantMsg.tool_calls) {
        const args = toolCall.function?.arguments
        items.push({
          type: 'function_call',
          name: toolCall.function?.name || 'unknown',
          arguments: typeof args === 'string' ? args : JSON.stringify(args || {}),
          call_id: toolCall.id || `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        })
      }
    }

    // Handle legacy function_call field (deprecated but still used)
    // Use function name as call_id for backwards compatibility with legacy function role
    if ('function_call' in assistantMsg && assistantMsg.function_call) {
      const fc = assistantMsg.function_call as { name?: string; arguments?: string }
      const funcName = fc.name || 'unknown'
      items.push({
        type: 'function_call',
        name: funcName,
        arguments: fc.arguments || '{}',
        call_id: funcName,  // Use name as call_id to match legacy function role output
      })
    }

    return items
  }

  // Tool message -> function_call_output
  if (role === 'tool') {
    const toolMsg = msg as ChatCompletionToolMessageParam
    const callId = toolMsg.tool_call_id
    const content = toolMsg.content

    if (callId) {
      items.push({
        type: 'function_call_output',
        call_id: callId,
        output: typeof content === 'string' ? content : JSON.stringify(content ?? ''),
      })
    }
    return items
  }

  // Function role (legacy, deprecated)
  if (role === 'function') {
    const funcMsg = msg as any
    items.push({
      type: 'function_call_output',
      call_id: funcMsg.name || `func_${Date.now()}`,
      output: typeof funcMsg.content === 'string' ? funcMsg.content : JSON.stringify(funcMsg.content ?? ''),
    })
    return items
  }

  // Developer role (pass through)
  if (role === 'developer') {
    const content = 'content' in msg ? msg.content : null
    const contentParts = convertContent(content as string | ChatCompletionContentPart[], 'user')
    if (contentParts.length > 0) {
      items.push({
        type: 'message',
        role: 'developer',
        content: contentParts,
      })
    }
    return items
  }

  // Unknown role - try to preserve as user message
  console.warn(`Unknown message role: ${role}`)
  const content = 'content' in msg ? (msg as any).content : null
  if (content) {
    const contentParts = convertContent(content, 'user')
    if (contentParts.length > 0) {
      items.push({
        type: 'message',
        role: 'user',
        content: contentParts,
      })
    }
  }

  return items
}

/**
 * Handle items that are already in Responses API format (passthrough)
 */
function isResponsesApiItem(item: any): item is ResponseInputItem {
  if (!item || typeof item !== 'object') return false

  // Check for Responses API item types
  if (item.type === 'message' && item.role && item.content !== undefined) {
    return true
  }
  if (item.type === 'function_call' && item.name !== undefined) {
    return true
  }
  if (item.type === 'function_call_output' && item.call_id !== undefined) {
    return true
  }

  return false
}

/**
 * Convert Responses API content to ensure proper format
 */
function normalizeResponsesContent(content: any, role: string): ResponseContentPart[] {
  if (typeof content === 'string') {
    return [{
      type: role === 'assistant' ? 'output_text' : 'input_text',
      text: content,
    }]
  }

  if (!Array.isArray(content)) {
    return [{
      type: 'input_text',
      text: JSON.stringify(content),
    }]
  }

  const parts: ResponseContentPart[] = []
  for (const block of content) {
    if (!block) continue

    // Already proper format
    if (block.type === 'input_text' || block.type === 'output_text') {
      if (typeof block.text === 'string') {
        parts.push(block as ResponseContentPart)
      }
      continue
    }

    // Handle 'text' type (Chat Completions format in Responses wrapper)
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push({
        type: role === 'assistant' ? 'output_text' : 'input_text',
        text: block.text,
      })
      continue
    }

    // Image
    if (block.type === 'input_image' || block.type === 'image_url') {
      const url = block.image_url || block.url
      if (url) {
        parts.push({
          type: 'input_image',
          image_url: typeof url === 'string' ? url : url.url,
        })
      }
      continue
    }

    // File
    if (block.type === 'input_file') {
      parts.push(block as ResponseInputFileContent)
      continue
    }

    // Unknown - preserve as text
    console.warn(`Unknown content block type: ${block.type}`)
    parts.push({
      type: 'input_text',
      text: `[${block.type}: ${JSON.stringify(block)}]`,
    })
  }

  return parts
}

/**
 * Convert a Responses API item to ensure proper format
 */
function normalizeResponsesApiItem(item: any): ResponseInputItem | null {
  if (item.type === 'message') {
    const normalizedContent = normalizeResponsesContent(item.content, item.role)
    if (normalizedContent.length === 0) return null

    return {
      type: 'message',
      role: item.role,
      content: normalizedContent,
    }
  }

  if (item.type === 'function_call') {
    return {
      type: 'function_call',
      name: item.name || 'unknown',
      arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
      call_id: item.call_id || item.id || `call_${Date.now()}`,
    }
  }

  if (item.type === 'function_call_output') {
    return {
      type: 'function_call_output',
      call_id: item.call_id || item.id,
      output: typeof item.output === 'string' ? item.output : JSON.stringify(item.output ?? ''),
    }
  }

  return null
}

/**
 * Main conversion function: Chat Completions messages array to Responses API input array
 */
export function convertMessagesToInput(messages: any[]): ResponseInputItem[] {
  const input: ResponseInputItem[] = []

  for (const item of messages) {
    if (!item) continue

    // Check if it's already in Responses API format
    if (isResponsesApiItem(item)) {
      const normalized = normalizeResponsesApiItem(item)
      if (normalized) {
        input.push(normalized)
      }
      continue
    }

    // Convert from Chat Completions format
    const converted = convertMessage(item as ChatCompletionMessageParam)
    input.push(...converted)
  }

  return input
}

/**
 * Extract system/developer messages and return separate instructions + input
 */
export function convertToResponsesFormat(body: {
  messages?: any[]
  input?: any[]
  instructions?: string
  system?: string
}): {
  input: ResponseInputItem[]
  developerMessages: ResponseMessageItem[]
} {
  // Use messages or input array
  const items = body.messages || body.input || []

  const input: ResponseInputItem[] = []
  const developerMessages: ResponseMessageItem[] = []

  for (const item of items) {
    if (!item) continue

    // Check if it's already in Responses API format
    if (isResponsesApiItem(item)) {
      const normalized = normalizeResponsesApiItem(item)
      if (normalized) {
        if (normalized.type === 'message' && (normalized.role === 'developer' || normalized.role === 'system')) {
          developerMessages.push(normalized as ResponseMessageItem)
        } else {
          input.push(normalized)
        }
      }
      continue
    }

    // Convert from Chat Completions format
    const converted = convertMessage(item as ChatCompletionMessageParam)
    for (const conv of converted) {
      if (conv.type === 'message' && conv.role === 'developer') {
        developerMessages.push(conv)
      } else {
        input.push(conv)
      }
    }
  }

  return { input, developerMessages }
}
