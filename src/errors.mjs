/**
 * Shared error types for dsh-loop-dock.
 *
 * Every public failure gets a stable `code` so callers (and future UI
 * surfaces) can distinguish "this loop was never registered" from "this
 * strategy loop has no driver to run on".
 */

export class LoopDockError extends Error {
  constructor(message, code = 'LOOP_DOCK_ERROR', options) {
    super(message, options)
    this.name = 'LoopDockError'
    this.code = code
  }
}

export class InvalidConfigError extends LoopDockError {
  constructor(message, options) {
    super(message, 'INVALID_CONFIG', options)
    this.name = 'InvalidConfigError'
  }
}

export class InvalidLoopIdError extends LoopDockError {
  constructor(id, options) {
    super(
      `invalid loop id ${JSON.stringify(id)}: expected a non-empty string matching /^[a-z0-9][a-z0-9._-]*$/`,
      'INVALID_LOOP_ID',
      options,
    )
    this.name = 'InvalidLoopIdError'
  }
}

export class InvalidLoopDefinitionError extends LoopDockError {
  constructor(message, options) {
    super(message, 'INVALID_LOOP_DEFINITION', options)
    this.name = 'InvalidLoopDefinitionError'
  }
}

export class DuplicateLoopError extends LoopDockError {
  constructor(id, options) {
    super(`loop "${id}" is already registered`, 'DUPLICATE_LOOP', options)
    this.name = 'DuplicateLoopError'
  }
}

export class UnknownLoopError extends LoopDockError {
  constructor(id, available = [], options) {
    super(
      `loop "${id}" is not registered (available: ${available.join(', ') || 'none'})`,
      'UNKNOWN_LOOP',
      options,
    )
    this.name = 'UnknownLoopError'
  }
}

export class MissingDriverError extends LoopDockError {
  constructor(id, driver = 'default', options) {
    super(
      `strategy loop "${id}" requires driver "${driver}", which is not registered`,
      'MISSING_DRIVER',
      options,
    )
    this.name = 'MissingDriverError'
  }
}

export class UnknownDriverError extends LoopDockError {
  constructor(name, available = [], options) {
    super(
      `driver "${name}" is not registered (available: ${available.join(', ') || 'none'})`,
      'UNKNOWN_DRIVER',
      options,
    )
    this.name = 'UnknownDriverError'
  }
}

export class InvalidDriverError extends LoopDockError {
  constructor(message, options) {
    super(message, 'INVALID_DRIVER', options)
    this.name = 'InvalidDriverError'
  }
}

export class DuplicateDriverError extends LoopDockError {
  constructor(name = 'default', options) {
    super(
      `driver "${name}" is already registered`,
      'DUPLICATE_DRIVER',
      options,
    )
    this.name = 'DuplicateDriverError'
  }
}

export class LoopSwitchError extends LoopDockError {
  constructor(sessionId, requested, persisted, field = 'loop') {
    super(
      `session "${sessionId}" is bound to ${field} "${persisted}" and cannot be resumed with ${field} "${requested}"; loop switching follows the same blank-session-only rule as preset switching`,
      'LOOP_SWITCH',
    )
    this.name = 'LoopSwitchError'
  }
}
