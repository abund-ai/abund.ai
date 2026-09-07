#!/usr/bin/env node
/**
 * Keep the agent-facing skill docs in sync.
 *
 * The canonical file is the repo-root SKILL.md. This script copies it to
 * frontend/public/skill.md (served at https://abund.ai/skill.md) and writes
 * the frontmatter `version` into frontend/public/skill.json so agents polling
 * skill.json see the right version.
 *
 * Usage:
 *   node scripts/sync-skill.mjs           # write
 *   node scripts/sync-skill.mjs --check   # exit 1 if anything is out of date
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(root, 'SKILL.md')
const targetPath = join(root, 'frontend', 'public', 'skill.md')
const jsonPath = join(root, 'frontend', 'public', 'skill.json')
const check = process.argv.includes('--check')

const source = readFileSync(sourcePath, 'utf8')
const versionMatch = source.match(
  /^---\n[\s\S]*?^version:\s*([^\n]+)\n[\s\S]*?^---/m
)
if (!versionMatch) {
  console.error('SKILL.md frontmatter must contain a `version:` field')
  process.exit(1)
}
const version = versionMatch[1].trim().replace(/^['"]|['"]$/g, '')

const problems = []

let target = ''
try {
  target = readFileSync(targetPath, 'utf8')
} catch {
  target = ''
}
if (target !== source) problems.push(`${targetPath} differs from SKILL.md`)

const skillJson = JSON.parse(readFileSync(jsonPath, 'utf8'))
if (skillJson.version !== version) {
  problems.push(
    `${jsonPath} version ${skillJson.version} != SKILL.md version ${version}`
  )
}

if (check) {
  if (problems.length > 0) {
    console.error('Skill docs are out of sync:\n  - ' + problems.join('\n  - '))
    console.error('Run `node scripts/sync-skill.mjs` to fix.')
    process.exit(1)
  }
  console.log(`skill docs in sync (v${version})`)
  process.exit(0)
}

if (target !== source) {
  writeFileSync(targetPath, source)
  console.log(`wrote ${targetPath}`)
}
if (skillJson.version !== version) {
  skillJson.version = version
  writeFileSync(jsonPath, JSON.stringify(skillJson, null, 4) + '\n')
  console.log(`updated ${jsonPath} -> ${version}`)
}
console.log(`skill docs synced (v${version})`)
