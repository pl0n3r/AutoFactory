'use strict';

const fs = require('node:fs');
const path = require('node:path');

function validateReleaseMetadata(tag, chrome, safari, pkg, lock) {
  const documents = [chrome, safari, pkg, lock, lock?.packages?.['']];
  if (documents.some(value => !value || typeof value !== 'object' ||
      Array.isArray(value))) {
    throw new TypeError('Invalid release metadata structure');
  }
  const version = chrome.version;
  if (typeof version !== 'string' ||
      !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version) ||
      typeof tag !== 'string' || tag !== 'v' + version) {
    throw new TypeError('Release tag and manifest version mismatch');
  }
  if (documents.some(value => value.version !== version)) {
    throw new TypeError('Release versions do not match');
  }
  return version;
}

function loadJson(root, name) {
  return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
}

function verifyCheckout(root, tag) {
  const chrome = loadJson(root, 'manifest.json');
  const safari = loadJson(root,
    'safari/ChatGPT Autopilot Local Extension/Resources/manifest.json');
  const pkg = loadJson(root, 'package.json');
  const lock = loadJson(root, 'package-lock.json');
  return validateReleaseMetadata(tag, chrome, safari, pkg, lock);
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new TypeError('Missing release tag');
    const version = verifyCheckout(path.resolve(__dirname, '..'), process.argv[2]);
    console.log('Release metadata verified: v' + version);
  } catch (_error) {
    console.error('Release metadata verification failed');
    process.exitCode = 1;
  }
}
module.exports = { validateReleaseMetadata, verifyCheckout };
