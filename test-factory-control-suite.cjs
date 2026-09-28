'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('./package.json');

const root = __dirname;
const command = pkg.scripts?.test;
assert.equal(typeof command, 'string', 'package.json must define scripts.test');

const files = fs.readdirSync(root);
const modules = files
  .filter(name => /^factory-control-.*\.js$/.test(name))
  .sort();
const tests = files
  .filter(name => /^test-factory-control(?:-.*)?\.cjs$/.test(name))
  .sort();

for (const file of modules) {
  assert.ok(
    command.includes(`node --check ${file}`),
    `npm test must syntax-check ${file}`
  );
}

for (const file of tests) {
  assert.ok(
    command.includes(`node ${file}`),
    `npm test must execute ${file}`
  );
}

assert.equal(
  path.basename(__filename),
  'test-factory-control-suite.cjs',
  'suite inventory must keep its canonical filename'
);

console.log(
  `Factory Control suite inventory: ${modules.length} modules and ${tests.length} tests are gated`
);
