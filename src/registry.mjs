/**
 * Named loop registry: the docking slots themselves.
 *
 * A loop provider is either:
 *
 *   { kind: 'strategy', id, setup(agentCtx) }   -- reuses the dock's default driver
 *   { kind: 'driver', id, createAgent, resume } -- owns the full AgentFactory contract
 *
 * This module is intentionally free of DeepSeek Harness imports so it can be
 * tested and reused outside a live Cordis runtime.
 */

import {
  DuplicateLoopError,
  InvalidDriverError,
  InvalidLoopDefinitionError,
  InvalidLoopIdError,
  UnknownLoopError,
} from './errors.mjs'

const LOOP_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

/** Validate and normalize a loop id. */
export function normalizeLoopId(id) {
  if (typeof id !== 'string' || id.length === 0 || !LOOP_ID_PATTERN.test(id)) {
    throw new InvalidLoopIdError(id)
  }
  return id
}

/** Validate and normalize a driver name (same identifier grammar as loop ids). */
export function normalizeDriverName(name) {
  if (typeof name !== 'string' || name.length === 0 || !LOOP_ID_PATTERN.test(name)) {
    throw new InvalidDriverError(
      `invalid driver name ${JSON.stringify(name)}: expected a non-empty string matching /^[a-z0-9][a-z0-9._-]*$/`,
    )
  }
  return name
}

/** Validate one provider descriptor and return a defensive copy. */
export function validateLoopDefinition(loop) {
  if (loop === null || typeof loop !== 'object' || Array.isArray(loop)) {
    throw new InvalidLoopDefinitionError('a loop provider must be an object with an id')
  }
  const id = normalizeLoopId(loop.id)
  for (const field of ['provider', 'model']) {
    const value = loop[field]
    if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      throw new InvalidLoopDefinitionError(`loop "${id}" ${field} must be a non-empty string`)
    }
  }
  if (loop.kind === 'strategy') {
    if (typeof loop.setup !== 'function') {
      throw new InvalidLoopDefinitionError(`strategy loop "${id}" must provide an async setup(agentCtx) function`)
    }
    if (loop.driver !== undefined) {
      try {
        normalizeDriverName(loop.driver)
      } catch {
        throw new InvalidLoopDefinitionError(`strategy loop "${id}" driver must be a valid driver name`)
      }
    }
  } else if (loop.kind === 'driver') {
    if (typeof loop.createAgent !== 'function' || typeof loop.resume !== 'function') {
      throw new InvalidLoopDefinitionError(
        `driver loop "${id}" must provide createAgent(ownerCtx, options) and resume(ownerCtx, options)`,
      )
    }
  } else {
    throw new InvalidLoopDefinitionError(`loop "${id}" must declare kind: "strategy" or "driver"`)
  }
  return {
    ...loop,
    id,
    kind: loop.kind,
    ...(loop.label === undefined ? {} : { label: String(loop.label) }),
    ...(loop.description === undefined ? {} : { description: String(loop.description) }),
  }
}

export class LoopRegistry {
  #loops = new Map()

  /**
   * Register one loop provider.
   * @returns an idempotent disposer that removes exactly this registration.
   */
  register(loop) {
    const definition = validateLoopDefinition(loop)
    if (this.#loops.has(definition.id)) throw new DuplicateLoopError(definition.id)
    this.#loops.set(definition.id, definition)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.#loops.get(definition.id) === definition) this.#loops.delete(definition.id)
    }
  }

  /** Remove one registered loop. Returns whether a loop was removed. */
  unregister(id) {
    const normalized = normalizeLoopId(id)
    return this.#loops.delete(normalized)
  }

  has(id) {
    return this.#loops.has(normalizeLoopId(id))
  }

  get(id) {
    return this.#loops.get(normalizeLoopId(id))
  }

  require(id) {
    const loop = this.get(id)
    if (loop === undefined) throw new UnknownLoopError(id, [...this.#loops.keys()])
    return loop
  }

  /** Public metadata for every registered loop, sorted by id. */
  list() {
    return [...this.#loops.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, kind, label, description }) => ({
        id,
        kind,
        ...(label === undefined ? {} : { label }),
        ...(description === undefined ? {} : { description }),
      }))
  }

  get size() {
    return this.#loops.size
  }
}
