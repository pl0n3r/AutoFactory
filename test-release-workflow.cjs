'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateReleaseMetadata, verifyCheckout } =
  require('./scripts/verify-release-metadata.cjs');

const root = __dirname;
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const chrome = read('manifest.json');
const safari = read('safari/ChatGPT Autopilot Local Extension/Resources/manifest.json');
const pkg = read('package.json');
const lock = read('package-lock.json');
const tag = 'v' + chrome.version;
const malformedVersion = '1.2.3-extra';
const malformedLock = {
  ...lock,
  version: malformedVersion,
  packages: {
    ...lock.packages,
    '': { ...lock.packages[''], version: malformedVersion }
  }
};

assert.equal(verifyCheckout(root, tag), chrome.version);
assert.equal(validateReleaseMetadata(tag, chrome, safari, pkg, lock), chrome.version);
const invalidCases = [
  ['invalid tag', 'v1.2.3-extra', chrome, safari, pkg, lock],
  ['matching malformed version', 'v' + malformedVersion,
    { ...chrome, version: malformedVersion },
    { ...safari, version: malformedVersion },
    { ...pkg, version: malformedVersion }, malformedLock],
  ['wrong tag', 'v9.9.9', chrome, safari, pkg, lock],
  ['safari mismatch', tag, chrome, { ...safari, version: '9.9.9' }, pkg, lock],
  ['package mismatch', tag, chrome, safari, { ...pkg, version: '9.9.9' }, lock],
  ['lock mismatch', tag, chrome, safari, pkg, { ...lock, version: '9.9.9' }],
  ['lock root mismatch', tag, chrome, safari, pkg, {
    ...lock, packages: { ...lock.packages, '': { version: '9.9.9' } }
  }],
  ['null manifest', tag, null, safari, pkg, lock],
  ['null lock', tag, chrome, safari, pkg, null],
  ['missing lock root', tag, chrome, safari, pkg, { version: chrome.version }]
];
for (const [caseName, ...args] of invalidCases) {
  assert.throws(() => validateReleaseMetadata(...args),
    { name: 'TypeError' }, caseName);
}
const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8');
function verifyWorkflow(source) {
  assert.match(source, /^permissions:\n  contents: read$/m);
  assert.match(source, /^concurrency:\n  group: release-/m);
  assert.match(source, /^  cancel-in-progress: false$/m);
  assert.equal(source.match(/^    needs: preflight$/gm)?.length, 2);
  assert.match(source, /^    needs: \[preflight, chrome_smoke, safari_smoke\]$/m);
  assert.match(source, /^    timeout-minutes: 20$/m);
  assert.match(source, /^    timeout-minutes: 10$/m);
  assert.equal(source.match(/persist-credentials: false/g)?.length, 4);
  assert.equal(source.match(/contents: write/g)?.length, 1);
  assert.equal(source.match(/actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/g)?.length, 4);
  assert.match(source, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
  const verifyAt = source.indexOf('node scripts/verify-release-metadata.cjs');
  const ancestryAt = source.indexOf('git rev-parse refs/remotes/origin/main');
  const preflightGuard =
    'test "$(git rev-parse HEAD)" = "$(git rev-parse refs/remotes/origin/main)"';
  const liveMainGuard =
    `test "$(git rev-parse HEAD)" = "$(gh api "repos/$GITHUB_REPOSITORY/branches/main" --jq '.commit.sha')"`;
  const preflightJobAt = source.indexOf('\n  preflight:\n');
  const chromeJobAt = source.indexOf('\n  chrome_smoke:\n');
  const safariJobAt = source.indexOf('\n  safari_smoke:\n');
  const publishJobAt = source.indexOf('\n  publish:\n');
  assert.ok(chromeJobAt > preflightJobAt && safariJobAt > chromeJobAt && publishJobAt > safariJobAt);
  assert.match(source, /node scripts\/chrome-ephemeral-smoke\.cjs "\$GITHUB_REF_NAME" "\$GITHUB_SHA"/);
  assert.match(source, /bash scripts\/safari-unsigned-build-smoke\.sh "\$GITHUB_REF_NAME" "\$GITHUB_SHA"/);
  const preflightAt = source.indexOf(preflightGuard);
  const liveMainAt = source.indexOf(liveMainGuard);
  const packageAt = source.indexOf('python3 scripts/package-release.py');
  assert.ok(preflightJobAt >= 0 && publishJobAt > preflightJobAt &&
    verifyAt > preflightJobAt && verifyAt < publishJobAt &&
    preflightAt > verifyAt && preflightAt < publishJobAt &&
    ancestryAt > preflightAt && ancestryAt < publishJobAt &&
    liveMainAt > publishJobAt && packageAt > liveMainAt,
    'preflight checks belong to preflight; current-main check belongs to publish');
  assert.equal(source.split('GH_TOKEN: ${{ github.token }}').length - 1, 2,
    'both GitHub API checks must receive a scoped token');
}
verifyWorkflow(workflow);
assert.throws(() => verifyWorkflow(workflow.replace('persist-credentials: false',
  'persist-credentials: true')));
assert.throws(() => verifyWorkflow(workflow.replace(
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
  'actions/checkout@v4')));
assert.throws(() => verifyWorkflow(workflow.replace('needs: preflight',
  'needs: publish')));
assert.throws(() => verifyWorkflow(workflow.replace('contents: read',
  'contents: write')));
assert.throws(() => verifyWorkflow(workflow.replace(
  'node scripts/verify-release-metadata.cjs "$GITHUB_REF_NAME"',
  'echo skipped')));
assert.throws(() => verifyWorkflow(workflow.replace(
  'git rev-parse refs/remotes/origin/main', 'echo main')));
assert.throws(() => verifyWorkflow(workflow.replace(
  'test "$(git rev-parse HEAD)" = "$(git rev-parse refs/remotes/origin/main)"',
  'echo unchecked')));
assert.throws(() => verifyWorkflow(workflow.replace(
  `test "$(git rev-parse HEAD)" = "$(gh api "repos/$GITHUB_REPOSITORY/branches/main" --jq '.commit.sha')"`,
  'echo stale')));
assert.throws(() => verifyWorkflow(workflow.replace(
  "GH_TOKEN: ${{ github.token }}", 'GH_TOKEN: omitted')));
const liveMainComparison =
  `test "$(git rev-parse HEAD)" = "$(gh api "repos/$GITHUB_REPOSITORY/branches/main" --jq '.commit.sha')"`;
assert.throws(() => verifyWorkflow(
  workflow.replace(liveMainComparison, 'echo live-check-moved').replace(
    '\n  publish:\n',
    '\n          ' + liveMainComparison + '\n  publish:\n'
  )
), /current-main check belongs to publish/);


console.log('Release metadata and workflow: tag, versions and publication gates verified');
