#!/usr/bin/env node
/**
 * Syntax-check every first-party JavaScript file before running tests.
 */

import { readdir, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const directories = [
  'src',
  'scripts',
  'examples',
  'test',
  'vendor/dsh-agent-loop-headless',
]

const rootFiles = ['client.js']

async function collect(dir) {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await collect(path))
    else if (entry.name.endsWith('.mjs') || entry.name.endsWith('.js')) files.push(path)
  }
  return files
}

async function collectAll(directories) {
  const files = []
  for (const directory of directories) files.push(...await collect(join(root, directory)))
  return files
}

let failed = false
const files = [
  ...rootFiles.map((file) => join(root, file)),
  ...await collectAll(directories),
]
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
  if (result.status !== 0) failed = true
}

if (failed) process.exit(1)
console.log('syntax ok')
