'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_NODE = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020';

function verify(source) {
  assert.match(source, /^permissions:\n  contents: read$/m);
  assert.match(source, /^concurrency:\n  group: validate-\$\{\{ github.workflow \}\}-\$\{\{ github.ref \}\}/m);
  assert.match(source, /^  cancel-in-progress: \$\{\{ github.ref != 'refs\/heads\/main' \}\}$/m);
  assert.match(source, /^    timeout-minutes: 20$/m);
  assert.match(source, new RegExp('^      - uses: ' + CHECKOUT + '$', 'm'));
  assert.match(source, new RegExp('^      - uses: ' + SETUP_NODE + '$', 'm'));
  assert.match(source, /^          persist-credentials: false$/m);
  assert.match(source, /^          node-version: 20$/m);
  assert.match(source, /^          cache: npm$/m);
  const install = source.indexOf('      - run: npm ci\n');
  const test = source.indexOf('      - run: npm test\n');
  const contract = source.indexOf('      - run: node test-workflow-hardening.cjs\n');
  assert.ok(install !== -1 && install < test && test < contract,
    'npm dependencies, tests and workflow contract must run in order');
}

const workflow = fs.readFileSync('.github/workflows/validate.yml', 'utf8');
verify(workflow);
assert.throws(() => verify(workflow.replace(CHECKOUT, 'actions/checkout@v4')));
assert.throws(() => verify(workflow.replace(SETUP_NODE, 'actions/setup-node@v4')));
assert.throws(() => verify(workflow.replace('persist-credentials: false',
  'persist-credentials: true')));
assert.throws(() => verify(workflow.replace('contents: read', 'contents: write')));
assert.throws(() => verify(workflow.replace('timeout-minutes: 20', 'timeout-minutes: 0')));
assert.throws(() => verify(workflow.replace("github.ref != 'refs/heads/main'",
  'false')));
console.log('CI workflow security: SHA pins, token scope and cancellation policy verified');
