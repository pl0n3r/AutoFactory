'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildReleaseAttestation } = require('./release-artifact-attestation.cjs');

const CHROME_BINARIES = Object.freeze({
  darwin: Object.freeze([
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]),
  linux: Object.freeze([
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
  ]),
  win32: Object.freeze([
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]),
});

function fail(reason) {
  throw new TypeError('Chrome ephemeral smoke: ' + reason);
}

function resolveChromeBinary(platform = process.platform) {
  const candidates = CHROME_BINARIES[platform];
  if (!Array.isArray(candidates)) fail('unsupported platform');
  const binary = candidates.find(candidate => fs.existsSync(candidate));
  if (!binary) fail('trusted Chrome binary was not found');
  return binary;
}

function copyAttestedAssets(root, extensionDir, attestation) {
  for (const asset of attestation.assets) {
    const segments = asset.path.split('/');
    const source = path.join(root, ...segments);
    const target = path.join(extensionDir, ...segments);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  }
}

function chromeArgs(profileDir, extensionDir) {
  return [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--metrics-recording-only',
    '--password-store=basic',
    '--use-mock-keychain',
    '--user-data-dir=' + profileDir,
    '--disable-extensions-except=' + extensionDir,
    '--load-extension=' + extensionDir,
    '--dump-dom',
    'about:blank',
  ];
}

function sanitizedEnvironment(profileDir) {
  const env = {
    HOME: profileDir,
    XDG_CONFIG_HOME: path.join(profileDir, 'config'),
    XDG_CACHE_HOME: path.join(profileDir, 'cache'),
  };
  for (const name of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) {
    if (typeof process.env[name] === 'string') env[name] = process.env[name];
  }
  return env;
}

function launchChrome(chromeBinary, args, profileDir, timeoutMs, spawn) {
  const result = spawn(chromeBinary, args, {
    encoding: 'utf8',
    env: sanitizedEnvironment(profileDir),
    timeout: timeoutMs,
    windowsHide: true,
  });
  if (result.error) fail('chrome process error: ' + result.error.message);
  if (result.status !== 0) {
    fail('chrome process failed with exit code ' + String(result.status));
  }
  const output = String(result.stderr || '') + '\n' + String(result.stdout || '');
  if (/failed to load extension|extension[^\n]*(?:error|failed)|manifest[^\n]*(?:error|invalid)/i.test(output)) {
    fail('chrome reported an extension runtime/load error');
  }
}

function runChromeSmoke({
  root,
  tag,
  commitSha,
  tempRoot = os.tmpdir(),
  timeoutMs = 15000,
  spawn = spawnSync,
  binaryResolver = resolveChromeBinary,
}) {
  if (typeof tempRoot !== 'string' || !path.isAbsolute(tempRoot)) {
    fail('temp root must be an absolute path');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    fail('timeout must be between 1000 and 60000 ms');
  }

  const chromeBinary = binaryResolver();
  const attestation = buildReleaseAttestation(root, tag, commitSha);
  const profileDir = fs.mkdtempSync(path.join(tempRoot, 'autofactory-chrome-profile-'));
  const extensionDir = fs.mkdtempSync(path.join(tempRoot, 'autofactory-chrome-extension-'));
  try {
    copyAttestedAssets(root, extensionDir, attestation);
    launchChrome(
      chromeBinary,
      chromeArgs(profileDir, extensionDir),
      profileDir,
      timeoutMs,
      spawn
    );
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.rmSync(extensionDir, { recursive: true, force: true });
  }

  return Object.freeze({
    verified: true,
    runtime: 'chrome',
    profile_mode: 'ephemeral',
    extension_mode: 'attested-copy',
    tag: attestation.tag,
    commit_sha: attestation.commit_sha,
    assets: attestation.assets.length,
    cleanup: true,
  });
}

if (require.main === module) {
  try {
    if (process.argv.length !== 4) fail('expected <tag> <commit-sha>');
    const result = runChromeSmoke({
      root: path.resolve(__dirname, '..'),
      tag: process.argv[2],
      commitSha: process.argv[3],
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Chrome ephemeral smoke failed');
    process.exitCode = 1;
  }
}

module.exports = {
  CHROME_BINARIES,
  chromeArgs,
  launchChrome,
  resolveChromeBinary,
  runChromeSmoke,
  sanitizedEnvironment,
};
