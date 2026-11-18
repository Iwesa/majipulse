#!/usr/bin/env node
// Runs the local Firebase CLI with emulator defaults, on Windows and Unix alike.
// Usage: node scripts/firebase-emulators.mjs <firebase args...>
//
// FUNCTIONS_DISCOVERY_TIMEOUT: loading firebase-admin can take over the CLI's
// default 10 seconds on a cold start, which makes the Functions emulator skip
// all functions. An existing value in the environment wins.
//
// The CLI entry script runs directly with Node (no shell), so arguments such
// as "vitest run ..." reach it intact on every platform.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const cliPackage = require.resolve('firebase-tools/package.json')
const cli = join(dirname(cliPackage), require('firebase-tools/package.json').bin.firebase)

const env = { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT ?? '60' }
const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { env, stdio: 'inherit' })
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1)
})
