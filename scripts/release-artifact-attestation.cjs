'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { validateExtensionTree, workerImportRefs } = require('./verify-extension-assets.cjs');
const { verifyCheckout } = require('./verify-release-metadata.cjs');

const SAFARI_RESOURCES = path.join(
  'safari',
  'ChatGPT Autopilot Local Extension',
  'Resources'
);

const EXPECTED_RUNTIME_ASSETS = Object.freeze([
  'account-budget-background.js',
  'account-budget-guard.js',
  'account-budget.js',
  'adaptive-recovery.js',
  'autopilot-core.js',
  'background-entry.js',
  'background.js',
  'content.js',
  'factory-control-authorization.js',
  'factory-control-instance-transport.js',
  'factory-control-instance.js',
  'factory-control-ledger.js',
  'factory-control-protocol.js',
  'factory-control-runtime.js',
  'icons/icon-128.png',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'learning.js',
  'manifest.json',
  'popup-budget.js',
  'popup.html',
  'popup.js',
  'recovery-incident.js',
  'reliability.js',
  'shared-learning-protocol.js',
  'shared-learning-sync.js',
].sort((left, right) => left.localeCompare(right)));

function fail(reason) {
  throw new TypeError('Release artifact attestation: ' + reason);
}

function assetName(value) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(value) ||
    value.split('/').some(part => part === '.' || part === '..')
  ) {
    fail('invalid asset path');
  }
  return value;
}

function readJson(root, relative) {
  try {
    return JSON.parse(readRegular(root, relative).toString('utf8'));
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message.startsWith('Release artifact attestation:')
    ) {
      throw error;
    }
    fail('invalid JSON');
  }
}

function readRegular(root, relative) {
  const safe = assetName(relative);
  let current = path.resolve(root);
  for (const part of safe.split('/')) {
    current = path.join(current, part);
    let info;
    try {
      info = fs.lstatSync(current);
    } catch (_error) {
      fail('missing asset: ' + safe);
    }
    if (info.isSymbolicLink()) {
      fail('symlink asset: ' + safe);
    }
  }
  let finalInfo;
  try {
    finalInfo = fs.lstatSync(current);
  } catch (_error) {
    fail('missing asset: ' + safe);
  }
  if (!finalInfo.isFile()) {
    fail('asset is not a regular file: ' + safe);
  }
  try {
    return fs.readFileSync(current);
  } catch (_error) {
    fail('unreadable asset: ' + safe);
  }
}

function popupScriptRefs(html) {
  const refs = [];
  const tags = html.match(/<script\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const doubleQuoted = /(?:^|\s)src\s*=\s*"([^"]+)"/i.exec(tag);
    const singleQuoted = /(?:^|\s)src\s*=\s*'([^']+)'/i.exec(tag);
    const source = doubleQuoted?.[1] ?? singleQuoted?.[1];
    if (!source) fail('popup script must declare local src');
    refs.push(assetName(source));
  }
  if (refs.length === 0) fail('popup script missing');
  return refs;
}

function addContentScriptRefs(manifest, refs) {
  for (const content of manifest.content_scripts) {
    if (!content || !Array.isArray(content.js)) fail('invalid content scripts');
    for (const file of content.js) refs.add(assetName(file));
  }
}

function addIconRefs(manifest, refs) {
  for (const icons of [manifest.icons, manifest.action.default_icon]) {
    if (!icons || typeof icons !== 'object' || Array.isArray(icons)) {
      fail('missing extension icons');
    }
    for (const file of Object.values(icons)) refs.add(assetName(file));
  }
}

function addPopupRefs(root, popup, refs) {
  const html = readRegular(root, popup).toString('utf8');
  for (const file of popupScriptRefs(html)) refs.add(file);
}

function addWorkerImportRefs(root, background, refs) {
  const queue = [background];
  const visited = new Set();
  while (queue.length > 0) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const imports = workerImportRefs(readRegular(root, file).toString('utf8'));
    for (const imported of imports) {
      const safe = assetName(imported);
      refs.add(safe);
      if (safe.endsWith('.js') && !visited.has(safe)) queue.push(safe);
    }
  }
}

function manifestRuntimeAssets(root) {
  const manifest = readJson(root, 'manifest.json');
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    !manifest.background ||
    !manifest.action ||
    !Array.isArray(manifest.content_scripts)
  ) {
    fail('invalid manifest structure');
  }

  const refs = new Set(['manifest.json']);
  const background = assetName(manifest.background.service_worker);
  const popup = assetName(manifest.action.default_popup);
  refs.add(background);
  refs.add(popup);
  addContentScriptRefs(manifest, refs);
  addIconRefs(manifest, refs);
  addPopupRefs(root, popup, refs);
  addWorkerImportRefs(root, background, refs);
  return [...refs].sort((left, right) => left.localeCompare(right));
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function assertExpectedRuntimeSurface(actual) {
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_RUNTIME_ASSETS)) {
    fail('undeclared runtime asset or declared asset drift');
  }
}

function assetDigest(root, relative) {
  const chrome = readRegular(root, relative);
  const safari = readRegular(path.join(root, SAFARI_RESOURCES), relative);
  if (!chrome.equals(safari)) {
    fail('Chrome/Safari asset mismatch: ' + relative);
  }
  return Object.freeze({
    path: relative,
    size: chrome.length,
    chrome_sha256: sha256(chrome),
    safari_sha256: sha256(safari),
  });
}

function buildReleaseAttestation(root, tag, commitSha) {
  if (typeof root !== 'string' || root.length === 0) fail('invalid root');
  if (typeof commitSha !== 'string' || !/^[0-9a-f]{40}$/.test(commitSha)) {
    fail('invalid commit SHA');
  }

  const version = verifyCheckout(root, tag);
  const extension = validateExtensionTree(root);
  if (extension.version !== version) fail('version evidence mismatch');

  const runtimeAssets = manifestRuntimeAssets(root);
  assertExpectedRuntimeSurface(runtimeAssets);

  const assets = runtimeAssets.map(relative => assetDigest(root, relative));
  if (extension.assets !== assets.length) {
    fail('validated asset count mismatch');
  }

  const evidence = {
    schema_version: 1,
    tag,
    commit_sha: commitSha,
    release_version: version,
    digest_algorithm: 'sha256',
    assets,
  };
  return Object.freeze({
    ...evidence,
    attestation_sha256: sha256(Buffer.from(JSON.stringify(evidence), 'utf8')),
  });
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4) fail('expected <tag> <commit-sha>');
    const root = path.resolve(__dirname, '..');
    const result = buildReleaseAttestation(root, process.argv[2], process.argv[3]);
    console.log(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Release artifact attestation failed';
    console.error(message);
    process.exitCode = 1;
  }
}

module.exports = {
  EXPECTED_RUNTIME_ASSETS,
  buildReleaseAttestation,
  manifestRuntimeAssets,
};
