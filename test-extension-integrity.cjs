'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { declaredExtensionAssets, validateExtensionTree } = require('./scripts/verify-extension-assets.cjs');

const ROOT = __dirname;
const SAFARI = path.join('safari', 'ChatGPT Autopilot Local Extension', 'Resources');
const read = file => fs.readFileSync(path.join(ROOT, file));
function mutated(relative, contents, { missing = false, symlink = false } = {}) {
  const target = path.join(ROOT, relative);
  return {
    readFileSync(file) {
      return file === target ? Buffer.from(contents) : fs.readFileSync(file);
    },
    lstatSync(file) {
      if (file === target && missing) throw new Error('private location is missing');
      if (file === target && symlink) {
        return { isSymbolicLink: () => true, isFile: () => false,
          isDirectory: () => false };
      }
      return fs.lstatSync(file);
    }
  };
}
function withManifest(change, filename = 'manifest.json') {
  const value = JSON.parse(read(filename).toString('utf8'));
  change(value);
  return mutated(filename, JSON.stringify(value));
}
const actual = validateExtensionTree(ROOT);
const declaredAssets = declaredExtensionAssets(ROOT);
assert.match(actual.version, /^\d+\.\d+\.\d+$/);
assert.ok(actual.assets >= 9);
assert.equal(actual.assets, declaredAssets.length);
assert.deepEqual(validateExtensionTree(ROOT), actual);
for (const required of [
  'manifest.json',
  'popup.html',
  'popup.js',
  'background-entry.js',
  'content.js',
  'icons/icon-16.png',
  'factory-control-instance-transport.js'
]) {
  assert.ok(declaredAssets.includes(required), 'missing declared build asset: ' + required);
}
const safariBuildSource = read('build-safari.sh').toString('utf8');
assert.ok(safariBuildSource.includes('declaredExtensionAssets'));
assert.ok(safariBuildSource.includes('node "$ROOT/scripts/verify-extension-assets.cjs"'));
assert.equal(safariBuildSource.includes('for file in manifest.json'), false);

assert.throws(() => validateExtensionTree(ROOT, withManifest(m => {
  m.version = '9.9.9';
})), /version mismatch/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated('package.json', JSON.stringify({
    ...JSON.parse(read('package.json').toString('utf8')), version: '9.9.9'
  }))), /version mismatch/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated('package-lock.json', JSON.stringify({
    ...JSON.parse(read('package-lock.json').toString('utf8')),
    packages: { '': { version: '9.9.9' } }
  }))), /version mismatch/);
assert.throws(() => validateExtensionTree(ROOT, withManifest(m => {
  m.host_permissions.push('https://example.com/*');
})), /unexpected permission or host/);
assert.throws(() => validateExtensionTree(ROOT, withManifest(m => {
  m.permissions.push('webRequest');
})), /unexpected permission or host/);
assert.throws(() => validateExtensionTree(ROOT, withManifest(m => {
  m.optional_permissions = ['clipboardRead'];
})), /unexpected permission or host/);
assert.throws(() => validateExtensionTree(ROOT, withManifest(m => {
  m.optional_host_permissions = ['https://example.com/*'];
})), /unexpected permission or host/);
assert.throws(() => validateExtensionTree(ROOT, withManifest(m => {
  m.content_scripts[0].js[0] = '../private.js';
})), /invalid asset path/);
assert.throws(() => validateExtensionTree(ROOT, withManifest(m => {
  m.content_scripts[0].matches = ['https://example.com/*'];
})), /content script matches/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated('manifest.json', '{')), /invalid JSON/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated('package.json', 'null')), /invalid package or lock structure/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated('package-lock.json', 'null')), /invalid package or lock structure/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated('package-lock.json', '[]')), /invalid package or lock structure/);
// A broken storage adapter can throw something other than Error.
const invalidIo = {
  lstatSync: fs.lstatSync,
  readFileSync() { throw new Error('adapter read failure'); }
};
assert.throws(() => validateExtensionTree(ROOT, invalidIo),
  /Extension preflight: invalid JSON/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated('icons/icon-16.png', '', { missing: true })),
/missing declared asset/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated('background.js', '', { symlink: true })),
/regular file/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated(path.join(SAFARI, 'popup.js'),
    Buffer.concat([read('popup.js'), Buffer.from('\n// drift\n')]))),
/Chrome\/Safari asset mismatch/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated('popup.html', '<html><script src="../outside.js"></script></html>')),
/invalid asset path/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated('popup.html', '<html><script>alert(1)</script></html>')),
/popup script must declare local src/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated('popup.html',
    '<html><script data-src="popup.js" src="untracked.js"></script></html>')),
/missing declared asset/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated(SAFARI, '', { symlink: true })),
/resource directory must not be a symlink/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated(path.join(SAFARI, 'content.js'),
    Buffer.concat([read('content.js'), Buffer.from('\n// drift\n')]))),
/Chrome\/Safari asset mismatch/);
assert.throws(() => validateExtensionTree(ROOT,
  mutated(path.join(SAFARI, 'manifest.json'),
    Buffer.concat([read('manifest.json'), Buffer.from('\n')]))),
/Chrome\/Safari asset mismatch/);
const coreSource = read('autopilot-core.js').toString('utf8');
const contentSource = read('content.js').toString('utf8');
assert.ok(coreSource.includes(String.raw`.replaceAll('\u00a0', ' ').replaceAll('\r\n', '\n')`));
assert.equal(coreSource.includes(String.raw`.replace(/\u00a0/g`), false);
assert.equal(coreSource.includes(String.raw`.replace(/\r\n/g`), false);
assert.ok(contentSource.includes("if (message?.type === 'autopilot:heartbeat') void tick();"));
assert.ok(contentSource.includes(`mutationTimer = 0;
      void tick();`));
assert.equal((contentSource.match(/(?<!void )tick\(\);/g) || []).length, 0);
console.log('Extension preflight: versions, Chrome/Safari parity, declared assets and permissions pass');
