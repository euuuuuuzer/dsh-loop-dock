/**
 * Dock configuration normalization.
 *
 * Kept dependency-free so configuration errors are precise and testable
 * without booting a DSH context.
 */

import { InvalidConfigError } from './errors.mjs'
import { normalizeDriverName, normalizeLoopId } from './registry.mjs'

export const DEFAULT_LOOP = 'standard'
export const DEFAULT_DRIVER = 'default'

function toRecord(value, field) {
  if (value === undefined) return {}
  if (value instanceof Map) return Object.fromEntries(value)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidConfigError(`${field} must be an object or Map`)
  }
  return { ...value }
}

function stringField(value, field, { allowEmpty = false } = {}) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new InvalidConfigError(`${field} must be a ${allowEmpty ? 'string' : 'non-empty string'}`)
  }
  return value
}

function positiveInteger(value, field) {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidConfigError(`${field} must be a positive safe integer`)
  }
  return value
}

function normalizeLoopIdField(value, field) {
  if (value === undefined) return undefined
  try {
    return normalizeLoopId(value)
  } catch {
    throw new InvalidConfigError(`${field} must be a valid loop id`)
  }
}

function normalizeDriverField(value, field) {
  if (value === undefined) return undefined
  try {
    return normalizeDriverName(value)
  } catch {
    throw new InvalidConfigError(`${field} must be a valid driver name`)
  }
}

/**
 * Normalize a route value, which may be a plain loop id string or an object:
 * `{ loop: 'strategy1', driver: 'loop2' }`.
 */
function normalizeLoopBinding(value, field) {
  if (value === undefined) return undefined
  if (typeof value === 'string') return { loop: normalizeLoopIdField(value, field) }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidConfigError(`${field} must be a loop id or { loop, driver }`)
  }
  const loop = normalizeLoopIdField(value.loop, `${field}.loop`)
  if (loop === undefined) throw new InvalidConfigError(`${field}.loop must be a valid loop id`)
  const driver = normalizeDriverField(value.driver, `${field}.driver`)
  return { loop, ...(driver === undefined ? {} : { driver }) }
}

function normalizeRouteMap(value, field) {
  const record = toRecord(value, field)
  const normalized = {}
  for (const [key, entry] of Object.entries(record)) {
    normalized[key] = normalizeLoopBinding(entry, `${field}.${key}`)
  }
  return normalized
}

function normalizeAgentEntry(entry, index) {
  const label = `agents[${index}]`
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new InvalidConfigError(`${label} must be an object`)
  }

  const id = stringField(entry.id, `${label}.id`)
  if (id === undefined) throw new InvalidConfigError(`${label}.id must be a non-empty string`)
  const sessionId = stringField(entry.sessionId, `${label}.sessionId`)
  const resumeSessionId = stringField(entry.resumeSessionId, `${label}.resumeSessionId`)
  if (sessionId !== undefined && resumeSessionId !== undefined) {
    throw new InvalidConfigError(`${label}: sessionId and resumeSessionId are mutually exclusive`)
  }

  return {
    id,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
    ...(entry.loop === undefined ? {} : { loop: normalizeLoopIdField(entry.loop, `${label}.loop`) }),
    ...(entry.driver === undefined ? {} : { driver: normalizeDriverField(entry.driver, `${label}.driver`) }),
    ...(entry.provider === undefined ? {} : { provider: stringField(entry.provider, `${label}.provider`) }),
    ...(entry.model === undefined ? {} : { model: stringField(entry.model, `${label}.model`) }),
    ...(entry.maxTokens === undefined ? {} : { maxTokens: positiveInteger(entry.maxTokens, `${label}.maxTokens`) }),
    ...(entry.reasoningEffort === undefined ? {} : { reasoningEffort: stringField(entry.reasoningEffort, `${label}.reasoningEffort`) }),
    ...(entry.cwd === undefined ? {} : { cwd: stringField(entry.cwd, `${label}.cwd`) }),
  }
}

export function normalizeDockConfig(config) {
  if (config === undefined) config = {}
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new InvalidConfigError('dsh-loop-dock config must be an object')
  }

  const defaultLoop = normalizeLoopIdField(config.defaultLoop ?? DEFAULT_LOOP, 'defaultLoop')
  const defaultDriver = normalizeDriverField(config.defaultDriver ?? DEFAULT_DRIVER, 'defaultDriver')
  const presetLoops = normalizeRouteMap(config.presetLoops, 'presetLoops')
  const sessionLoops = normalizeRouteMap(config.sessionLoops, 'sessionLoops')
  const pingReply = stringField(config.pingReply, 'pingReply', { allowEmpty: false })

  const agents = []
  if (config.agents !== undefined) {
    if (!Array.isArray(config.agents)) throw new InvalidConfigError('agents must be an array')
    agents.push(...config.agents.map(normalizeAgentEntry))
  }

  const exactIdentities = new Map()
  for (const agent of agents) {
    const identity = agent.resumeSessionId ?? agent.sessionId
    if (identity === undefined) continue
    const firstId = exactIdentities.get(identity)
    if (firstId !== undefined) {
      throw new InvalidConfigError(
        `agents "${firstId}" and "${agent.id}" use duplicate exact session identity "${identity}"`,
      )
    }
    exactIdentities.set(identity, agent.id)
  }

  return { defaultLoop, defaultDriver, presetLoops, sessionLoops, pingReply, agents }
}
