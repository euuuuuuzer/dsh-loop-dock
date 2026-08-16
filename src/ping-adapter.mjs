/**
 * Local LLM adapter that answers every request with one fixed reply.
 *
 * Registered under the `loop-ping` provider by the plugin entry. Sessions
 * routed to a loop that pins `provider: loop-ping` never touch a real model
 * or network — the reply is generated locally, which makes loop routing
 * trivially verifiable (e.g. the fake debug loop).
 */

import { LlmAdapter } from '@deepseek-ai/dsh-llm'

/** Stream chunks (BlockAssembler protocol) for one plain-text reply. */
function pingChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char) => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 0, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

export class PingAdapter extends LlmAdapter {
  constructor(reply) {
    super()
    this.reply = reply
  }

  async resolveModel(provider, model) {
    return { provider, id: model, name: model }
  }

  async *stream(options) {
    for (const chunk of pingChunks(this.reply)) yield chunk
  }
}
