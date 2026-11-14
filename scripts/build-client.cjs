// Regenerate client/bundle.js from client/index.js.
// The upstream build (scripts/build-client.mjs) wraps the module in the
// client loader factory; the bundle is literally the source, indented, inside
// that wrapper. This script reproduces that byte-for-byte.
const fs = require('node:fs')
const path = require('node:path')

const dir = path.join(__dirname, '..', 'client')
const src = fs.readFileSync(path.join(dir, 'index.js'), 'utf8').replace(/\n$/, '')
const body = src.split('\n').map((line) => (line.trim() === '' ? '' : '    ' + line)).join('\n')

const out = `/* Generated from client/index.js by scripts/build-client.mjs — do not edit by hand.
 * Regenerate with: npm run build:client
 */
window.__ModuleLoader__.load({
  id: "@weibaohui/dsh-sync",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var React = require("react")
${body}

    return module.exports
  }
})
`
fs.writeFileSync(path.join(dir, 'bundle.js'), out)
console.log('wrote client/bundle.js (%d bytes)', out.length)
