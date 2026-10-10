'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { buildReleaseAttestation } = require('./release-artifact-attestation.cjs');

const CHROME_BINARIES = Object.freeze({
  darwin: Object.freeze([
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]),
  // Branded Google Chrome >=137 ignores --load-extension; the runner image
  // supplies a Chromium snapshot that still supports unpacked MV3 tests.
  linux: Object.freeze([
    '/usr/local/share/chromium/chrome-linux/chrome',
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

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;

    let info;
    try {
      info = fs.lstatSync(candidate);
    } catch (_error) {
      fail('trusted Chrome binary is unreadable');
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      fail('trusted Chrome binary must be a regular file');
    }
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch (_error) {
      fail('trusted Chrome binary is not executable');
    }
    return candidate;
  }

  fail('trusted Chrome binary was not found');
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
    '--remote-debugging-port=0',
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

function fetchTargets(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({
      hostname: '127.0.0.1',
      port,
      path: '/json/list',
      timeout: 750,
    }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error('Chrome DevTools target listing failed'));
        return;
      }
      let body = '';
      response.on('data', data => {
        body += data.toString('utf8');
        if (body.length > 65536) response.destroy(new Error('Chrome DevTools response too large'));
      });
      response.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!Array.isArray(data)) throw new TypeError('invalid targets');
          resolve(data);
        } catch (error) {
          reject(error);
        }
      });
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('DevTools timeout')));
    request.on('error', reject);
  });
}

function readDevToolsPort(portFile) {
  const lines = fs.readFileSync(portFile, 'utf8').split(/\r?\n/);
  const port = Number(lines[0]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    fail('Chrome DevTools port is invalid');
  }
  return port;
}

async function inspectWorkerTargets(port) {
  try {
    const targets = await fetchTargets(port);
    const kinds = [...new Set(targets.map(target => String(target?.type || 'unknown')))]
      .sort().slice(0, 10);
    const worker = targets.find(target =>
      target?.type === 'service_worker' &&
      /^chrome-extension:\/\/[a-p]{32}\/background-entry\.js(?:[?#].*)?$/.test(target.url)
    );
    return { worker, kinds, error: 'none' };
  } catch (error) {
    // During browser startup, temporary DevTools failures are expected.
    // Never log target URLs or arbitrary response content.
    return { worker: null, kinds: [], error: error?.name === 'TypeError' ?
      'invalid-targets' : 'http-error' };
  }
}

async function probeChromeWorker(profileDir, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  let devtoolsPortSeen = false;
  let lastTargets = [];
  let lastProbeError = 'none';
  while (Date.now() < deadline) {
    if (child.exitCode !== null && child.exitCode !== undefined ||
      child.signalCode !== null && child.signalCode !== undefined) {
      fail('Chrome exited without extension worker evidence');
    }
    if (fs.existsSync(portFile)) {
      devtoolsPortSeen = true;
      const result = await inspectWorkerTargets(readDevToolsPort(portFile));
      lastTargets = result.kinds;
      lastProbeError = result.error;
      if (result.worker) return { type: result.worker.type, url: result.worker.url };
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  fail('positive Chrome extension service worker evidence missing' +
    ' (devtools=' + (devtoolsPortSeen ? 'yes' : 'no') +
    ', target-types=' + (lastTargets.join(',') || 'none') +
    ', probe=' + lastProbeError + ')');
}

async function launchChrome(chromeBinary, args, profileDir, timeoutMs, spawnProcess, probeWorker) {
  const child = spawnProcess(chromeBinary, args, {
    env: sanitizedEnvironment(profileDir),
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (!child || typeof child.kill !== 'function' || typeof child.on !== 'function') {
    fail('invalid Chrome process');
  }
  let processError = null;
  let stderr = '';
  child.on('error', error => { processError = error; });
  child.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-16384); });
  try {
    let proof;
    try {
      proof = await probeWorker(profileDir, timeoutMs, child);
    } catch (error) {
      const hints = [
        ['sandbox', /sandbox|zygote|namespace/i],
        ['devtools', /DevTools listening/i],
        ['crash', /crash|FATAL|SIGTRAP/i],
        ['permission', /permission denied/i],
        ['extension', /extension[^\n]*(?:error|failed)/i],
      ].filter(([,pattern]) => pattern.test(stderr)).map(([label]) => label);
      fail((error instanceof Error ? error.message : 'Chrome probe error') +
        ' (exit=' + String(child.exitCode ?? 'running') +
        ', signal=' + String(child.signalCode ?? 'none') +
        ', stderr-hints=' + (hints.join(',') || 'none') + ')');
    }
    if (processError) fail('chrome process error: ' + processError.message);
    if (/failed to load extension|extension[^\n]*(?:error|failed)|manifest[^\n]*(?:error|invalid)/i.test(stderr)) {
      fail('chrome reported an extension runtime/load error');
    }
    if (!proof || proof.type !== 'service_worker' ||
      !/^chrome-extension:\/\/[a-p]{32}\/background-entry\.js(?:[?#].*)?$/.test(proof.url)) {
      fail('positive Chrome extension service worker evidence missing');
    }
    return proof;
  } finally {
    child.kill();
    if (typeof child.once === 'function') {
      await new Promise(resolve => {
        if (child.exitCode !== null && child.exitCode !== undefined) {
          resolve();
          return;
        }
        const timer = setTimeout(resolve, 1200);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    }
  }
}

async function runChromeSmoke({
  root,
  tag,
  commitSha,
  tempRoot = os.tmpdir(),
  timeoutMs = 15000,
  spawnProcess = spawn,
  probeWorker = probeChromeWorker,
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
  let proof;
  try {
    copyAttestedAssets(root, extensionDir, attestation);
    proof = await launchChrome(
      chromeBinary,
      chromeArgs(profileDir, extensionDir),
      profileDir,
      timeoutMs,
      spawnProcess,
      probeWorker
    );
  } finally {
    // Chrome helpers may still flush files just after the parent exits.
    // Retry only documented transient filesystem races; never skip cleanup.
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
    fs.rmSync(extensionDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }

  return Object.freeze({
    verified: true,
    runtime: 'chrome',
    profile_mode: 'ephemeral',
    extension_mode: 'attested-copy',
    tag: attestation.tag,
    commit_sha: attestation.commit_sha,
    assets: attestation.assets.length,
    worker_url: proof.url,
    cleanup: true,
  });
}

if (require.main === module) {
  (async () => {
    if (process.argv.length !== 4) fail('expected <tag> <commit-sha>');
    const result = await runChromeSmoke({
      root: path.resolve(__dirname, '..'),
      tag: process.argv[2],
      commitSha: process.argv[3],
    });
    console.log(JSON.stringify(result));
  })().catch(error => {
    console.error(error instanceof Error ? error.message : 'Chrome ephemeral smoke failed');
    process.exitCode = 1;
  });
}

module.exports = {
  CHROME_BINARIES,
  chromeArgs,
  launchChrome,
  probeChromeWorker,
  resolveChromeBinary,
  runChromeSmoke,
  sanitizedEnvironment,
};
