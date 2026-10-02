'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  buildReleaseAttestation,
} = require('./release-artifact-attestation.cjs');

function fail(reason) {
  throw new TypeError('Chrome ephemeral smoke: ' + reason);
}

function regularExecutable(chromeBinary) {
  if (typeof chromeBinary !== 'string' || !path.isAbsolute(chromeBinary)) {
    fail('chrome binary must be an absolute path');
  }
  let info;
  try {
    info = fs.lstatSync(chromeBinary);
  } catch (_error) {
    fail('chrome binary is missing');
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    fail('chrome binary must be a regular file');
  }
  try {
    fs.accessSync(chromeBinary, fs.constants.X_OK);
  } catch (_error) {
    fail('chrome binary is not executable');
  }
  return chromeBinary;
}

function copyAttestedAssets(root, extensionDir, attestation) {
  for (const asset of attestation.assets) {
    const source = path.join(root, ...asset.path.split('/'));
    const target = path.join(extensionDir, ...asset.path.split('/'));
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

function runtimeFailure(output) {
  const patterns = [
    /failed to load extension/i,
    /extension[^\n]*(?:error|failed)/i,
    /manifest[^\n]*(?:error|invalid)/i,
  ];
  return patterns.some(pattern => pattern.test(output));
}

function launchChrome(chromeBinary, args, profileDir, timeoutMs, spawn = spawnSync) {
  const result = spawn(chromeBinary, args, {
    encoding: 'utf8',
    env: sanitizedEnvironment(profileDir),
    timeout: timeoutMs,
    windowsHide: true,
  });
  if (result.error) {
    fail('chrome process error: ' + result.error.message);
  }
  if (result.status !== 0) {
    fail('chrome process failed with exit code ' + String(result.status));
  }
  const output = String(result.stderr || '') + '\n' + String(result.stdout || '');
  if (runtimeFailure(output)) {
    fail('chrome reported an extension runtime/load error');
  }
  return output;
}

function runChromeSmoke({
  root,
  tag,
  commitSha,
  chromeBinary,
  tempRoot = os.tmpdir(),
  timeoutMs = 15000,
  spawn = spawnSync,
}) {
  regularExecutable(chromeBinary);
  if (typeof tempRoot !== 'string' || !path.isAbsolute(tempRoot)) {
    fail('temp root must be an absolute path');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    fail('timeout must be between 1000 and 60000 ms');
  }

  const attestation = buildReleaseAttestation(root, tag, commitSha);
  const profileDir = fs.mkdtempSync(path.join(tempRoot, 'autofactory-chrome-profile-'));
  const extensionDir = fs.mkdtempSync(path.join(tempRoot, 'autofactory-chrome-extension-'));
  let verified = false;
  try {
    copyAttestedAssets(root, extensionDir, attestation);
    launchChrome(
      chromeBinary,
      chromeArgs(profileDir, extensionDir),
      profileDir,
      timeoutMs,
      spawn
    );
    verified = true;
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
    fs.rmSync(extensionDir, { recursive: true, force: true });
  }

  return Object.freeze({
    verified,
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
    if (process.argv.length !== 5) {
      fail('expected <chrome-binary> <tag> <commit-sha>');
    }
    const result = runChromeSmoke({
      root: path.resolve(__dirname, '..'),
      chromeBinary: path.resolve(process.argv[2]),
      tag: process.argv[3],
      commitSha: process.argv[4],
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Chrome ephemeral smoke failed';
    console.error(message);
    process.exitCode = 1;
  }
}

module.exports = {
  chromeArgs,
  launchChrome,
  runChromeSmoke,
  runtimeFailure,
  sanitizedEnvironment,
};
