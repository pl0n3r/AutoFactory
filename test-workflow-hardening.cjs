'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_NODE = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020';
const CHROME_SMOKE_STEP = `        run: node scripts/chrome-ephemeral-smoke.cjs "v$(node -p 'require("./manifest.json").version')" "$(git rev-parse HEAD)"`;

function verify(source) {
  assert.match(source, /^permissions:\n  contents: read$/m);
  assert.match(source, /^concurrency:\n  group: validate-\$\{\{ github.workflow \}\}-\$\{\{ github.ref \}\}/m);
  assert.match(source, /^  cancel-in-progress: \$\{\{ github.ref != 'refs\/heads\/main' \}\}$/m);
  assert.match(source, /^    timeout-minutes: 20$/m);
  // Inspect every action step, rather than trusting a matching line elsewhere.
  const actionSteps = [...source.matchAll(/^      - uses: ([^\n]+)$/gm)];
  assert.deepEqual(actionSteps.map(match => match[1]), [CHECKOUT, SETUP_NODE],
    'all action references must be approved immutable SHAs');
  const steps = source.split(/(?=^      - (?:uses|run|name):)/m);
  const checkoutSteps = steps.filter(step =>
    step.startsWith('      - uses: actions/checkout@'));
  assert.equal(checkoutSteps.length, 1);
  for (const step of checkoutSteps) {
    assert.match(step,
      /^      - uses: actions\/checkout@[0-9a-f]{40}\n        with:\n          persist-credentials: false$/m);
    assert.equal((step.match(/persist-credentials:/g) || []).length, 1,
      'checkout must explicitly disable credential persistence');
  }
  // A job-level override changes the effective GITHUB_TOKEN permissions.
  assert.doesNotMatch(source, /^    permissions:/m,
    'jobs.test must inherit the read-only workflow permissions');
  assert.equal((source.match(/^permissions:/gm) || []).length, 1);
  assert.equal((source.match(/^  contents:/gm) || []).length, 1);
  assert.match(source, /^          node-version: 20$/m);
  assert.match(source, /^          cache: npm$/m);
  const install = source.indexOf('      - run: npm ci --ignore-scripts\n');
  const test = source.indexOf('      - run: npm test\n');
  const chromeSmoke = source.indexOf(CHROME_SMOKE_STEP + '\n');
  assert.match(source, /^      - name: Real Chrome MV3 extension-load smoke \(non-release checkout\)$/m);
  assert.ok(chromeSmoke !== -1, 'CI must execute real Chrome worker smoke on the checked-out SHA');
  const contract = source.indexOf('      - run: node test-workflow-hardening.cjs\n');
  assert.ok(install !== -1 && install < test && test < chromeSmoke && chromeSmoke < contract,
    'npm dependencies, tests and workflow contract must run in order');
}

const workflow = fs.readFileSync('.github/workflows/validate.yml', 'utf8');
verify(workflow);
assert.throws(() => verify(workflow.replace('npm ci --ignore-scripts', 'npm ci')));
assert.throws(() => verify(workflow.replace(
  CHROME_SMOKE_STEP, '        run: echo skip-chrome-worker-smoke'
)));
assert.throws(() => verify(workflow.replace(CHECKOUT, 'actions/checkout@v4')));
assert.throws(() => verify(workflow.replace(SETUP_NODE, 'actions/setup-node@v4')));
assert.throws(() => verify(workflow.replace('persist-credentials: false',
  'persist-credentials: true')));
assert.throws(() => verify(workflow.replace('contents: read', 'contents: write')));
assert.throws(() => verify(workflow.replace(
  '      - run: npm ci --ignore-scripts',
  '      - uses: actions/checkout@v4\n      - run: npm ci'
)));
assert.throws(() => verify(workflow.replace(
  '      - run: npm ci --ignore-scripts',
  '      - uses: ' + CHECKOUT + '\n      - run: npm ci'
)));
assert.throws(() => verify(workflow.replace(
  '    steps:',
  '    permissions:\n      contents: write\n    steps:'
)));
assert.throws(() => verify(workflow.replace(
  'persist-credentials: false',
  'persist-credentials: false\n          persist-credentials: true'
)));
assert.throws(() => verify(workflow.replace('timeout-minutes: 20', 'timeout-minutes: 0')));
assert.throws(() => verify(workflow.replace("github.ref != 'refs/heads/main'",
  'false')));
console.log('CI workflow security: SHA pins, token scope and cancellation policy verified');
