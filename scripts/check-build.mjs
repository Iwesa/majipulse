#!/usr/bin/env node
// Fails if the production build contains App Check debug-token material.
// Checks for the debug-token global name and for the actual token value, if one
// is defined in a local env file. Never prints the token value.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FORBIDDEN_MARKERS = ['FIREBASE_APPCHECK_DEBUG_TOKEN']
const TOKEN_ENV_KEY = 'VITE_APPCHECK_DEBUG_TOKEN'
const LOCAL_ENV_FILES = ['.env.development.local', '.env.local', '.env']

/** Recursively list files under dir. */
export function listFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...listFiles(path))
    else out.push(path)
  }
  return out
}

/** Read the debug token value from local env files without a dotenv dependency. */
export function readLocalTokenValues(rootDir) {
  const values = []
  for (const file of LOCAL_ENV_FILES) {
    const path = join(rootDir, file)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*VITE_APPCHECK_DEBUG_TOKEN\s*=\s*(.*)\s*$/)
      if (!match) continue
      const value = match[1].replace(/^['"]|['"]$/g, '').trim()
      if (value.length >= 8) values.push(value)
    }
  }
  return values
}

/**
 * Returns findings as { file, kind } where kind is 'marker' or 'token-value'.
 * Token values are never included in findings.
 */
export function findForbidden(distDir, { markers = FORBIDDEN_MARKERS, tokenValues = [] } = {}) {
  const findings = []
  for (const file of listFiles(distDir)) {
    const content = readFileSync(file, 'utf8')
    for (const marker of markers) {
      if (content.includes(marker)) findings.push({ file, kind: `marker ${marker}` })
    }
    for (const value of tokenValues) {
      if (content.includes(value)) findings.push({ file, kind: `${TOKEN_ENV_KEY} value` })
    }
  }
  return findings
}

function main() {
  const rootDir = process.cwd()
  const distDir = resolve(rootDir, process.argv[2] ?? 'dist')
  if (!existsSync(distDir)) {
    console.error(`check:build: ${relative(rootDir, distDir) || distDir} not found. Run "npm run build" first.`)
    process.exit(2)
  }
  const findings = findForbidden(distDir, { tokenValues: readLocalTokenValues(rootDir) })
  if (findings.length > 0) {
    console.error('check:build FAILED. App Check debug-token material found in the build:')
    for (const f of findings) console.error(`  ${relative(rootDir, f.file)}: ${f.kind}`)
    process.exit(1)
  }
  console.log('check:build passed: no App Check debug-token material in the build.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
