'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SAFARI_RESOURCES = [
  'safari', 'ChatGPT Autopilot Local Extension', 'Resources'
];
const EXPECTED_PERMISSIONS = ['activeTab', 'alarms', 'storage', 'tabs'];
const EXPECTED_HOSTS = ['https://chatgpt.com/*'];

function fail(reason) {
  throw new TypeError('Extension preflight: ' + reason);
}
function assetName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(name) ||
      name.split('/').some(part => part === '.' || part === '..')) {
    fail('invalid asset path');
  }
  return name;
}
function regularFile(root, relative, io) {
  const safe = assetName(relative);
  const parts = safe.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    let info;
    try {
      info = io.lstatSync(current);
    } catch (_error) {
      fail('missing declared asset: ' + safe);
    }
    if (info.isSymbolicLink() ||
        (index < parts.length - 1 && !info.isDirectory()) ||
        (index === parts.length - 1 && !info.isFile())) {
      fail('asset must be a regular file: ' + safe);
    }
  }
  return io.readFileSync(current);
}
function regularDirectory(root, segments, io) {
  const safe = segments.join('/');
  let current = root;
  for (const part of segments) {
    current = path.join(current, part);
    let info;
    try {
      info = io.lstatSync(current);
    } catch (_error) {
      fail('missing resource directory: ' + safe);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      fail('resource directory must not be a symlink: ' + safe);
    }
  }
  return current;
}
function readJson(root, name, io) {
  try {
    return JSON.parse(regularFile(root, name, io).toString('utf8'));
  } catch (error) {
    if (error instanceof TypeError &&
        error.message.startsWith('Extension preflight:')) throw error;
    fail('invalid JSON: ' + name);
  }
}
function validStringList(value, expected) {
  return Array.isArray(value) && value.length === expected.length &&
    value.every(x => typeof x === 'string') &&
    JSON.stringify([...value].sort((a, b) => a.localeCompare(b))) ===
    JSON.stringify([...expected].sort((a, b) => a.localeCompare(b)));
}
function assetRefs(manifest) {
  const refs = ['manifest.json'];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      manifest.manifest_version !== 3 || !manifest.background ||
      !manifest.action || !Array.isArray(manifest.content_scripts) ||
      manifest.content_scripts.length < 1 ||
      manifest.content_scripts.length > 20) {
    fail('invalid manifest structure');
  }
  const declared = [
    assetName(manifest.background.service_worker),
    assetName(manifest.action.default_popup)
  ];
  const contentScripts = [];
  for (const content of manifest.content_scripts) {
    if (!content || !Array.isArray(content.js) || !content.js.length ||
        !validStringList(content.matches, EXPECTED_HOSTS)) {
      fail('invalid content script matches or JavaScript');
    }
    contentScripts.push(...content.js.map(assetName));
  }
  refs.push(...declared, ...contentScripts);
  for (const icons of [manifest.icons, manifest.action.default_icon]) {
    if (!icons || typeof icons !== 'object' || Array.isArray(icons)) {
      fail('missing extension icons');
    }
    for (const file of Object.values(icons)) refs.push(assetName(file));
  }
  // This is a source parity check, not an assertion of browser installation.
  return [...new Set(refs)];
}
function popupScriptRefs(html) {
  const scripts = [];
  const tags = html.match(/<script\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const source = /\s+src\s*=\s*(["'])([^"']+)\1/i.exec(tag);
    if (!source) fail('popup script must declare local src');
    scripts.push(assetName(source[2]));
  }
  if (scripts.length === 0) fail('popup script missing');
  return scripts;
}
function validateExtensionTree(root, io = fs) {
  const manifest = readJson(root, 'manifest.json', io);
  const pkg = readJson(root, 'package.json', io);
  const lock = readJson(root, 'package-lock.json', io);
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg) ||
      !lock || typeof lock !== 'object' || Array.isArray(lock)) {
    fail('invalid package or lock structure');
  }
  const versions = [
    manifest.version, pkg.version, lock.version, lock.packages?.['']?.version
  ];
  if (!versions.every(v => typeof v === 'string' &&
      /^\d+\.\d+\.\d+$/.test(v) && v === versions[0])) {
    fail('Chrome/package/lock version mismatch');
  }
  if (manifest.optional_permissions !== undefined ||
      manifest.optional_host_permissions !== undefined ||
      !validStringList(manifest.permissions, EXPECTED_PERMISSIONS) ||
      !validStringList(manifest.host_permissions, EXPECTED_HOSTS)) {
    fail('unexpected permission or host before legal go-live');
  }
  const popupScripts = popupScriptRefs(
    regularFile(root, manifest.action.default_popup, io).toString('utf8')
  );
  const files = [...new Set([
    ...popupScripts,
    ...assetRefs(manifest)
  ])];
  const safariRoot = regularDirectory(root, SAFARI_RESOURCES, io);
  for (const file of files) {
    const chrome = regularFile(root, file, io);
    const safari = regularFile(safariRoot, file, io);
    if (!Buffer.isBuffer(chrome) || !Buffer.isBuffer(safari) ||
        !chrome.equals(safari)) {
      fail('Chrome/Safari asset mismatch: ' + file);
    }
  }
  return Object.freeze({ version: versions[0], assets: files.length });
}

if (require.main === module) {
  try {
    const result = validateExtensionTree(path.resolve(__dirname, '..'));
    console.log('Extension source preflight: v' + result.version +
      ', ' + result.assets + ' mirrored assets');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { validateExtensionTree };
