// End-to-end: real git push + real Gitea PR create/merge through runPush().
// Requires GITEA_REPO_URL (private, empty scratch repo) and GITEA_TOKEN.
// Throwaway test only — creates PRs/branches in the scratch repo.
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const work = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-e2e-'))
process.env.DSH_HOME = path.join(work, 'dshhome')

const require = createRequire(import.meta.url)
const entry = process.env.PLUGIN_ENTRY || '../src/index.js'
const { runPush, writeAskpass, DEFAULT_SYNC_SETTINGS } = require(entry).__internals

const token = process.env.GITEA_TOKEN
const repoUrl = process.env.GITEA_REPO_URL
if (!token || !repoUrl) throw new Error('GITEA_TOKEN / GITEA_REPO_URL required')

const roots = {
  dshSkills: path.join(work, 'live/skills'),
  agentsSkills: path.join(work, 'live/agentskills'),
  homeAgentsSkills: path.join(work, 'live/homeagentskills'),
  agentsLock: path.join(work, 'live/agents.lock.json'),
  sessions: path.join(work, 'live/sessions'),
  settingsFile: path.join(work, 'live/settings.yaml'),
  profiles: path.join(work, 'live/profiles'),
}
await fs.mkdir(path.join(roots.dshSkills, 'demo-skill'), { recursive: true })
await fs.writeFile(path.join(roots.dshSkills, 'demo-skill/SKILL.md'), '---\nname: demo-skill\n---\nversion 1\n')
await fs.mkdir(roots.agentsSkills, { recursive: true })
await fs.mkdir(roots.homeAgentsSkills, { recursive: true })
await fs.writeFile(roots.agentsLock, '{}\n')
await fs.mkdir(roots.sessions, { recursive: true })
await fs.writeFile(roots.settingsFile, 'theme: dark\n')
await fs.mkdir(roots.profiles, { recursive: true })

const eff = {
  ...DEFAULT_SYNC_SETTINGS,
  repoUrl,
  token,
  branch: 'main',
  syncSkills: true,
  syncSessions: false,
  syncSettings: true,
  syncPlugins: false,
  skillsStrategy: 'union',
  settingsStrategy: 'backup',
  pluginsStrategy: 'backup',
}
await writeAskpass()
const shadow = path.join(work, 'shadow')
const state = {}
const logger = { info() {}, warn() {}, error() {} }

const run1 = await runPush('git', eff, { repoDir: shadow, instanceId: 'e2e-a', state, logger, roots, preserve: [] })
console.log('RUN1 ' + JSON.stringify(run1))

await fs.writeFile(path.join(roots.dshSkills, 'demo-skill/SKILL.md'), '---\nname: demo-skill\n---\nversion 2\n')
const run2 = await runPush('git', eff, { repoDir: shadow, instanceId: 'e2e-a', state, logger, roots, preserve: [] })
console.log('RUN2 ' + JSON.stringify(run2))

const tree = execFileSync('git', ['-C', shadow, 'ls-tree', '-r', '--name-only', 'FETCH_HEAD'], { encoding: 'utf8' })
console.log('TREE\n' + tree.trim())
console.log('BASELINE ' + (state.lastSyncedCommit || ''))
console.log('WORKDIR ' + work)

const ok = run1.merged === true && run2.merged === true
  && tree.includes('settings/settings.yaml')
  && tree.includes('skills/dsh/demo-skill/SKILL.md')
  && /version 2/.test(execFileSync('git', ['-C', shadow, 'show', 'FETCH_HEAD:skills/dsh/demo-skill/SKILL.md'], { encoding: 'utf8' }))
console.log(ok ? 'E2E PASS' : 'E2E FAIL')
process.exit(ok ? 0 : 1)
