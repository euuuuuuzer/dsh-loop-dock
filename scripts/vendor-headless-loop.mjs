#!/usr/bin/env node
/**
 * Vendor the headless official agent loop.
 *
 * This script reads the COMPILED lib/index.js of an installed
 * `@deepseek-ai/dsh-agent-loop` package and writes a dock-safe derivative to
 * `vendor/dsh-agent-loop-headless/index.js`.
 *
 * The derivative removes only self-registration and host ownership:
 *   - no Cordis Service registration (`agentLoop`);
 *   - no `ctx.agents.setFactory(this)`;
 *   - no duplicate settings section;
 *   - no duplicate provider/model/cwd prompt variables;
 *   - no declarative-agent auto-start (the dock owns that).
 *
 * The turn/step driver is intentionally untouched.
 *
 * Usage:
 *   node scripts/vendor-headless-loop.mjs <path-to-installed-lib-index.js>
 *
 * Example:
 *   node scripts/vendor-headless-loop.mjs \
 *     "$HOME/.dsh/profiles/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js"
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = resolve(process.argv[2] ?? '')
if (!sourcePath) {
  console.error('usage: node scripts/vendor-headless-loop.mjs <path-to-dsh-agent-loop/lib/index.js>')
  process.exit(1)
}

const source = await readFile(sourcePath, 'utf8')

function requireMarker(marker) {
  if (!source.includes(marker)) {
    throw new Error(`source does not contain expected marker: ${JSON.stringify(marker)}`)
  }
}

for (const marker of [
  'import { Service } from "@deepseek-ai/cordis";',
  'var AgentLoop = class extends Service {',
  'super(ctx, "agentLoop");',
  'ctx.effect(() => ctx.agents.setFactory(this), "agentLoop.setFactory()");',
  'ctx.systemPrompt.variable("provider", (context) => context.agent?.options.provider);',
  'ctx.systemPrompt.variable("model", (context) => context.agent?.options.model);',
  'ctx.systemPrompt.variable("cwd", (context) => context.agent?.session.header.cwd);',
  'for (const { id, sessionId, cwd, resumeSessionId, ...options } of this.config.agents) {',
]) {
  requireMarker(marker)
}

let text = source

// 1. No Cordis service class and no now-unused identity imports.
text = text.replace('import { Service } from "@deepseek-ai/cordis";\n', '')
text = text.replace('import { randomUUID } from "node:crypto";\n', '')
text = text.replace('import { SessionId, SessionPreparation, canonicalHeader, headerEquals, isReplacementSurfaceEvent } from "@deepseek-ai/dsh-session";', 'import { SessionPreparation, canonicalHeader, headerEquals, isReplacementSurfaceEvent } from "@deepseek-ai/dsh-session";')
text = text.replace('var AgentLoop = class extends Service {', 'var AgentLoop = class {')
text = text.replace(/^\s*super\(ctx, "agentLoop"\);\n/m, '')

// 2. Keep the plain context handle Service used to provide.
text = text.replace(
  '\t\tthis.ownership = new FactoryOwnership(ctx.fiber);\n\t\tthis.runtime = { ctx };\n',
  '\t\tthis.ownership = new FactoryOwnership(ctx.fiber);\n\t\tthis.runtime = { ctx };\n\t\tthis.ctx = ctx;\n',
)

// 3. Remove duplicate settings registration and host-plane self-registration.
const settingsStart = text.indexOf('\t\tinstallSettingsSection(ctx, AGENT_LOOP_SETTINGS_NAMESPACE,')
const validateMarker = '\t\tvalidateConfiguredAgents(this.config.agents);'
const validateAt = text.indexOf(validateMarker, settingsStart)
if (settingsStart < 0 || validateAt < 0) throw new Error('could not locate installSettingsSection block')
text = `${text.slice(0, settingsStart)}${text.slice(validateAt)}`
text = text.replace('import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";', 'import { settingsNamespace } from "@deepseek-ai/dsh-settings";')

text = text.replace(
  '\t\tctx.effect(() => () => this.ownership.dispose(), "agentLoop.transactions()");\n',
  '\t\tctx.effect(() => () => this.ownership.dispose(), "dsh-loop-dock.headless-driver()");\n',
)
text = text.replace('\t\tctx.effect(() => ctx.agents.setFactory(this), "agentLoop.setFactory()");\n', '')
text = text.replace('\t\tctx.systemPrompt.variable("provider", (context) => context.agent?.options.provider);\n', '')
text = text.replace('\t\tctx.systemPrompt.variable("model", (context) => context.agent?.options.model);\n', '')
text = text.replace('\t\tctx.systemPrompt.variable("cwd", (context) => context.agent?.session.header.cwd);\n', '')

// 4. The dock owns declarative agents.
const start = text.indexOf('\t\tfor (const { id, sessionId, cwd, resumeSessionId, ...options } of this.config.agents) {')
const reportMarker = '\t/** Report a contained declarative-start failure to identity-bound consumers. */'
const report = text.indexOf(reportMarker, start)
if (start < 0 || report < 0) throw new Error('could not locate declarative-agent startup block')
text = `${text.slice(0, start)}// Headless mode: declarative agents are owned by dsh-loop-dock, not this driver.\n\t}\n${text.slice(report)}`

// 6. Thread `maxParallelToolCalls` from the instance config through
//    `prepare` -> `ReactLoopAgent` -> `executeToolCalls` -> `runGroup`,
//    replacing the removed `ctx.agentLoop.config` service read.
const maxParallelMarkers = [
  'async function executeToolCalls(ctx, turn, step, toolCalls, signal, acceptContext) {',
  'const outcome = await runGroup(ctx, turn, step, mode === "parallel" ? planned.slice(next) : [first], mode, signal, acceptContext);',
  'async function runGroup(ctx, turn, step, group, mode, signal, acceptContext) {',
  '\tconst { session } = ctx.agents.requireInitiator();\n\tconst { maxParallelToolCalls } = ctx.agentLoop.config;',
  '\tconstructor(loopCtx, id, options, session) {\n\t\tthis.loopCtx = loopCtx;',
  'const { concluded } = await executeToolCalls(this.loopCtx, turn, step, toolCalls, signal, (context) => this.inbox.splice("next-step", this.inbox.nextStep.length, 0, [context]));',
  'const agent = machine = new ReactLoopAgent(loopCtx, id, options, session);',
]
for (const marker of maxParallelMarkers) {
  if (!text.includes(marker)) throw new Error(`source does not contain maxParallelToolCalls marker: ${JSON.stringify(marker)}`)
}

text = text.replace(
  'async function executeToolCalls(ctx, turn, step, toolCalls, signal, acceptContext) {',
  'async function executeToolCalls(ctx, turn, step, toolCalls, maxParallelToolCalls, signal, acceptContext) {',
)
text = text.replace(
  'const outcome = await runGroup(ctx, turn, step, mode === "parallel" ? planned.slice(next) : [first], mode, signal, acceptContext);',
  'const outcome = await runGroup(ctx, turn, step, mode === "parallel" ? planned.slice(next) : [first], mode, maxParallelToolCalls, signal, acceptContext);',
)
text = text.replace(
  'async function runGroup(ctx, turn, step, group, mode, signal, acceptContext) {',
  'async function runGroup(ctx, turn, step, group, mode, maxParallelToolCalls, signal, acceptContext) {',
)
text = text.replace(
  '\tconst { session } = ctx.agents.requireInitiator();\n\tconst { maxParallelToolCalls } = ctx.agentLoop.config;',
  '\tconst { session } = ctx.agents.requireInitiator();',
)
text = text.replace(
  '\tconstructor(loopCtx, id, options, session) {\n\t\tthis.loopCtx = loopCtx;',
  '\tconstructor(loopCtx, id, options, session, maxParallelToolCalls) {\n\t\tthis.loopCtx = loopCtx;\n\t\tthis.maxParallelToolCalls = maxParallelToolCalls;',
)
text = text.replace(
  'const { concluded } = await executeToolCalls(this.loopCtx, turn, step, toolCalls, signal, (context) => this.inbox.splice("next-step", this.inbox.nextStep.length, 0, [context]));',
  'const { concluded } = await executeToolCalls(this.loopCtx, turn, step, toolCalls, this.maxParallelToolCalls, signal, (context) => this.inbox.splice("next-step", this.inbox.nextStep.length, 0, [context]));',
)
text = text.replace(
  'const agent = machine = new ReactLoopAgent(loopCtx, id, options, session);',
  'const agent = machine = new ReactLoopAgent(loopCtx, id, options, session, this.config.maxParallelToolCalls);',
)
// 5. Named export for the adapter.
text = text.replace(
  'export { AGENT_LOOP_SETTINGS_NAMESPACE, AGENT_LOOP_SETTINGS_SCHEMA, AgentLoop, AgentLoop as default, CONFIGURED_AGENT_IDENTITIES_KEY, DEFAULT_MAX_PARALLEL_TOOL_CALLS };',
  'var HeadlessAgentLoop = AgentLoop;\n'
    + 'export { AGENT_LOOP_SETTINGS_NAMESPACE, AGENT_LOOP_SETTINGS_SCHEMA, AgentLoop, AgentLoop as default, HeadlessAgentLoop, CONFIGURED_AGENT_IDENTITIES_KEY, DEFAULT_MAX_PARALLEL_TOOL_CALLS };',
)

const header = `/**
 * DERIVATIVE WORK — see README.md in this directory and the repository NOTICE.
 *
 * Derived from @deepseek-ai/dsh-agent-loop 0.1.0-rc.6 (compiled lib/index.js).
 * Copyright (c) 2026 DeepSeek. Licensed under the MIT License.
 *
 * Modifications made for dsh-loop-dock:
 *   1. Removed Cordis Service registration (\`agentLoop\`).
 *   2. Removed the single-slot AgentFactory self-registration.
 *   3. Removed duplicate settings/prompt-variable registrations.
 *   4. Removed declarative-agent auto-start.
 *   5. Exported \`HeadlessAgentLoop\` and retained the original driver logic.
 *   6. Threaded \`maxParallelToolCalls\` from the instance config into the tool
 *      scheduler (\`runGroup\`) instead of reading the removed
 *      \`ctx.agentLoop.config\` service, which no longer exists.
 */
`

const output = `${header}${text}`

const outDir = resolve(root, 'vendor/dsh-agent-loop-headless')
await mkdir(outDir, { recursive: true })
const outPath = resolve(outDir, 'index.js')
await writeFile(outPath, output)

console.log(`wrote ${outPath} (${Buffer.byteLength(output)} bytes)`)
