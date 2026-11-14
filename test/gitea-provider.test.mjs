// Offline tests for the Gitea/Forgejo PR provider added on top of 0.4.11.
// A tiny fake Gitea serves just the endpoints the plugin drives, so the wire
// shape (paths, auth header, bodies) is asserted without network access.
import { test, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { __internals } = require('../src/index.js')
const { probeGiteaApi, repoApiTarget, createPullRequest, getPullRequest, mergePullRequest, checkRepoAccess, giteaApiCache, detectRepoProvider } = __internals

let server, origin, hits, lastBody, lastAuth, publicRepo

beforeEach(async () => {
  hits = []
  lastBody = null
  lastAuth = null
  publicRepo = false
  if (server) await new Promise((r) => server.close(r))
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      hits.push(req.method + ' ' + req.url)
      lastAuth = req.headers.authorization || null
      try { lastBody = raw ? JSON.parse(raw) : null } catch { lastBody = raw }
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(obj))
      }
      if (req.url === '/api/v1/version') return send(200, { version: '1.27.3' })
      if (req.url === '/api/v1/repos/xophiix/demo' && req.method === 'GET') {
        return send(200, { private: !publicRepo, default_branch: 'main' })
      }
      if (req.url === '/api/v1/repos/xophiix/demo/pulls' && req.method === 'POST') {
        return send(201, { number: 7, mergeable: true })
      }
      if (req.url === '/api/v1/repos/xophiix/demo/pulls/7' && req.method === 'GET') {
        return send(200, { number: 7, mergeable: true })
      }
      if (req.url === '/api/v1/repos/xophiix/demo/pulls/7/merge' && req.method === 'POST') {
        return send(200, { merged: true })
      }
      send(404, { message: 'not found' })
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  origin = 'http://127.0.0.1:' + server.address().port
  giteaApiCache.clear()
})

after(() => { if (server) server.close() })

test('probe detects Gitea and caches per origin', async () => {
  const api = await probeGiteaApi(origin + '/xophiix/demo.git')
  assert.equal(api, origin + '/api/v1')
  await probeGiteaApi(origin + '/xophiix/demo.git')
  assert.deepEqual(hits, ['GET /api/v1/version'], 'probe must be cached')
})

test('unknown host (no /api/v1/version) has no PR target', async () => {
  server.removeAllListeners('request')
  server.on('request', (req, res) => { res.writeHead(404); res.end('') })
  giteaApiCache.clear()
  assert.equal(await repoApiTarget({ repoUrl: origin + '/xophiix/demo.git', token: 't' }), null)
})

test('privacy check is real for Gitea (private ok, public refused)', async () => {
  const url = origin + '/xophiix/demo.git'
  const priv = await checkRepoAccess('tok', url)
  assert.equal(priv.ok, true)
  assert.equal(priv.verified, true)
  assert.equal(priv.unverified, false)
  publicRepo = true
  const pub = await checkRepoAccess('tok', url)
  assert.equal(pub.ok, false)
  assert.equal(pub.isPublic, true)
  assert.equal(pub.needConfirm, undefined, 'must not fall back to the blind-confirm dialog')
})

test('create / get / merge use the Gitea REST shape', async () => {
  const target = await repoApiTarget({ repoUrl: origin + '/xophiix/demo.git', token: 'tok-123' })
  assert.equal(target.kind, 'gitea')
  assert.equal(target.owner, 'xophiix')
  assert.equal(target.repo, 'demo')

  const created = await createPullRequest(target, { head: 'sync/host/1', base: 'main', title: 'dsh-sync host', body: 'auto' })
  assert.equal(created.ok, true)
  assert.equal(created.json.number, 7)
  assert.equal(lastAuth, 'token tok-123')
  assert.deepEqual(lastBody, { head: 'sync/host/1', base: 'main', title: 'dsh-sync host', body: 'auto' })

  const det = await getPullRequest(target, 7)
  assert.equal(det.json.mergeable, true)

  const merged = await mergePullRequest(target, 7, 'squash')
  assert.equal(merged.ok, true)
  assert.deepEqual(lastBody, { Do: 'squash', delete_branch_after_merge: false })
  assert.deepEqual(hits.slice(1), [
    'POST /api/v1/repos/xophiix/demo/pulls',
    'GET /api/v1/repos/xophiix/demo/pulls/7',
    'POST /api/v1/repos/xophiix/demo/pulls/7/merge',
  ])
})

test('gitcode keeps its own transport and merge verb', async () => {
  const p = detectRepoProvider('https://gitcode.com/o/r.git')
  assert.equal(p.kind, 'gitcode')
  // no network: repoApiTarget for gitcode must not hit fetch during resolution
  const target = await repoApiTarget({ repoUrl: 'https://gitcode.com/o/r.git', token: 'x' })
  assert.equal(target.kind, 'gitcode')
})

test('SSH-only remotes stay push-only', async () => {
  assert.equal(await repoApiTarget({ repoUrl: 'git@example.com:o/r.git', token: 'x' }), null)
})
