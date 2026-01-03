import { AnthropicRequestBody } from "../types";
import { isVerbose, log } from "./logger";
import chalk from "chalk";

// Bypass cursor enable openai key check
export function createCursorBypassResponse(model?: string) {
  const responseModel = model || 'gpt-4o-2024-08-06'
  return {
    choices: [
      {
        finish_reason: 'length',
        index: 0,
        logprobs: null,
        message: {
          annotations: [],
          content: 'Of course! Please provide me with the text or',
          refusal: null,
          role: 'assistant',
        },
      },
    ],
    created: Math.floor(Date.now() / 1000),
    id: `chatcmpl-${Date.now().toString(36)}`,
    model: responseModel,
    object: 'chat.completion',
    service_tier: 'default',
    system_fingerprint: 'fp_a288987b44',
    usage: {
      completion_tokens: 10,
      completion_tokens_details: {
        accepted_prediction_tokens: 0,
        audio_tokens: 0,
        reasoning_tokens: 0,
        rejected_prediction_tokens: 0,
      },
      prompt_tokens: 28,
      prompt_tokens_details: {
        audio_tokens: 0,
        cached_tokens: 0,
      },
      total_tokens: 38,
    },
  }
}

/**
 * Check if the request is from Cursor trying to validate OpenAI key.
 * This catches various validation patterns Cursor uses.
 *
 * Known patterns:
 * - "Test prompt using gpt-4o" / "Test prompt using gpt-3.5-turbo"
 * - Simple "hi" or "hello" with max_tokens=10 (quick validation)
 * - Single short message with very low max_tokens
 */
export function isCursorKeyCheck(body: AnthropicRequestBody): boolean {
  if (!body.messages || body.messages.length === 0) return false

  const messages = body.messages
  const firstMessage = messages[0]
  const content = typeof firstMessage?.content === 'string'
    ? firstMessage.content
    : Array.isArray(firstMessage?.content)
      ? firstMessage.content.find((b: any) => b.type === 'text')?.text || ''
      : ''

  // Pattern 1: Explicit test prompts
  const isTestPrompt = messages.some(
    (m: any) => {
      const msgContent = typeof m.content === 'string' ? m.content : ''
      return (
        msgContent === 'Test prompt using gpt-3.5-turbo' ||
        msgContent === 'Test prompt using gpt-4o' ||
        msgContent.startsWith('Test prompt using ')
      )
    }
  )
  if (isTestPrompt) return true

  // Pattern 2: Very short validation request (single message, low max_tokens)
  // Cursor sometimes sends "hi" or similar with max_tokens=10 to validate
  const maxTokens = (body as any).max_tokens
  if (
    messages.length === 1 &&
    maxTokens && maxTokens <= 10 &&
    content.length <= 20 &&
    /^(hi|hello|test|ping)$/i.test(content.trim())
  ) {
    return true
  }

  return false
}

/**
 * Log a potential Cursor validation request for debugging.
 * Call this when verbose mode is on to help identify new patterns.
 */
export function logPotentialValidation(body: AnthropicRequestBody, reason: string) {
  if (!isVerbose()) return

  log()
  log(`  ${chalk.yellow('⚠')} ${chalk.yellow('Potential validation request')} ${chalk.dim(`(${reason})`)}`)

  const messages = body.messages || []
  const maxTokens = (body as any).max_tokens
  const model = (body as any).model

  log(`    ${chalk.dim('model:')} ${model || 'none'}`)
  log(`    ${chalk.dim('max_tokens:')} ${maxTokens || 'none'}`)
  log(`    ${chalk.dim('messages:')} ${messages.length}`)

  for (const msg of messages.slice(0, 3)) {
    const content = typeof msg.content === 'string'
      ? msg.content.slice(0, 100)
      : JSON.stringify(msg.content).slice(0, 100)
    log(`    ${chalk.dim(`[${msg.role}]:`)} ${content}`)
  }
  log()
}

/**
 * Detect if a request looks like it might be a validation request.
 * Returns a reason string if suspicious, null otherwise.
 * Use this for logging/debugging to identify new patterns.
 */
export function detectPotentialValidation(body: AnthropicRequestBody): string | null {
  if (!body.messages || body.messages.length === 0) return null

  const messages = body.messages
  const maxTokens = (body as any).max_tokens
  const model = (body as any).model || ''

  // Single very short message with low token limit
  if (messages.length === 1 && maxTokens && maxTokens <= 20) {
    const content = typeof messages[0].content === 'string' ? messages[0].content : ''
    if (content.length <= 50) {
      return `short message (${content.length} chars) with low max_tokens (${maxTokens})`
    }
  }

  // Request for a GPT model that looks like a ping/test
  if (model.includes('gpt') && messages.length === 1) {
    const content = typeof messages[0].content === 'string' ? messages[0].content : ''
    if (/^(test|ping|hi|hello|say|repeat)/i.test(content.trim())) {
      return `gpt model with test-like content: "${content.slice(0, 30)}"`
    }
  }

  return null
}
