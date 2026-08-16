/**
 * Loop-provider helpers.
 *
 * Strategy loops are the common case: they reuse one driver and only install
 * a per-agent setup. Driver loops are for authors who need a completely
 * completely different turn/step control flow.
 */

import { InvalidDriverError } from './errors.mjs'

export function defineStrategyLoop(definition) {
  return { kind: 'strategy', ...definition }
}

export function defineDriverLoop(definition) {
  return { kind: 'driver', ...definition }
}

function assertDriver(driver) {
  if (
    driver === null
    || typeof driver !== 'object'
    || typeof driver.createAgent !== 'function'
    || typeof driver.resume !== 'function'
  ) {
    throw new InvalidDriverError(
      'a driver must provide createAgent(ownerCtx, options) and resume(ownerCtx, options)',
    )
  }
}

/**
 * Compose DSH AgentSetup callbacks in order.
 *
 * Each setup may return the official `{ commit() {} }` publication hook
 * (or a plain function commit, accepted for easier third-party testing).
 * The composed setup returns an official-shaped commit that runs every
 * collected commit in setup order.
 */
export function composeSetups(setups) {
  const active = setups.filter((setup) => typeof setup === 'function')
  if (active.length === 0) return undefined
  return async function composedSetup(agentCtx) {
    const commits = []
    for (const setup of active) {
      const result = await setup(agentCtx)
      if (typeof result === 'function') commits.push(result)
      else if (result !== null && typeof result === 'object' && typeof result.commit === 'function') {
        commits.push(() => result.commit())
      }
    }
    if (commits.length === 0) return undefined
    return {
      commit() {
        for (const commit of commits) commit()
      },
    }
  }
}

/**
 * Wrap a strategy loop with a driver so it implements the driver contract.
 * The returned provider is cached by the dock and reused for every agent.
 */
export function wrapStrategyLoop(strategy, driver) {
  assertDriver(driver)
  return {
    ...strategy,
    kind: 'driver',
    sourceLoop: strategy.id,
    createAgent(ownerCtx, options) {
      return driver.createAgent(ownerCtx, {
        ...options,
        setup: composeSetups([options.setup, strategy.setup]),
      })
    },
    resume(ownerCtx, options) {
      return driver.resume(ownerCtx, {
        ...options,
        setup: composeSetups([options.setup, strategy.setup]),
      })
    },
  }
}
