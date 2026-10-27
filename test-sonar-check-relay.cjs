'use strict';

const assert = require('node:assert/strict');
const { plain, code, isSonarCheck, choosePR, render, runRelay } =
  require('./scripts/sonar-check-relay.cjs');

// Regression #272: atomically escape untrusted Sonar annotations.
const adversarial = '<svg>@all**[profile]' + '\r\n\t' + '&' + String.fromCharCode(96);
const expected = '&lt;svg&gt;＠all\\*\\*\\[profile\\] &amp;' + String.fromCharCode(92, 96);
assert.equal(plain(adversarial), expected);
assert.equal(plain('\r\n\t'), ' ');
assert.equal(plain('<&>'), '&lt;&amp;&gt;');
assert.equal(plain('@everyone * _ [ ]'), '＠everyone \\* \\_ \\[ \\]');
assert.ok(!plain('<script>@all</script>').includes('<script>'));
assert.ok(!plain('[x](javascript:alert(1))').includes('[x]'));
assert.ok(!plain('@all').includes('@all'));
const sonarFixture = { id: 123, head_sha: 'a'.repeat(40),
  name: 'SonarCloud Code Analysis', app: { slug: 'sonarqubecloud' },
  status: 'completed', conclusion: 'failure' };
const sanitized = render(sonarFixture, [
  { path: '<svg>', start_line: 4, title: '@all <script>', message: '[X]*' }
], 1);
assert.ok(sanitized.includes('&lt;script&gt;'));
assert.ok(!sanitized.includes('<script>'));

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const REPO = 'pl0n3r/AutoFactory';
const check = {
  id: 123, head_sha: SHA, name: 'SonarCloud Code Analysis',
  app: { slug: 'sonarqubecloud' }, status: 'completed', conclusion: 'failure',
  pull_requests: [{ number: 23 }]
};
const pr = {
  number: 23, state: 'open', head: {
    sha: SHA, repo: { full_name: REPO }
  }
};
assert.ok(isSonarCheck(check));
assert.equal(isSonarCheck({ ...check, app: { slug: 'other' } }), false);
assert.equal(isSonarCheck({ ...check, status: 'in_progress' }), false);
assert.equal(choosePR([pr], SHA, REPO), pr);
assert.equal(choosePR([pr], OTHER_SHA, REPO), null);
assert.equal(choosePR([pr], SHA, 'somebody/other'), null);
assert.match(plain('a\nb<@someone'), /&lt;＠someone/);
assert.match(render(check, [], 0), /does \*\*not\*\* mean there are no Sonar findings/);
assert.ok(render(check, [{ path: 'a.js', start_line: 9,
  title: 'Rule S123', message: 'Avoid returning null' }], 1)
  .includes('a.js:9'));
assert.equal(code('snake_case`file.js\nnext', 200), 'snake_case file.js next');
const manyAnnotations = Array.from({ length: 45 }, (_, index) => ({
  path: 'src/snake_case_' + index + '.js',
  start_line: index + 1,
  title: 'Rule ' + index,
  message: 'Message ' + index
}));
const bounded = render(check, manyAnnotations, manyAnnotations.length);
assert.match(bounded, /Showing 30 of 45 retrieved annotations/);
assert.equal(bounded.split('\n').filter(line =>
  line.startsWith('- `src/snake_case_')).length, 30);
assert.ok(!bounded.includes('snake\\\\_case'),
  'code spans must not contain Markdown escapes');

const calls = [];
let lastComment;
async function api(route, method = 'GET', payload) {
  calls.push({ route, method });
  if (route.endsWith('/pulls/23')) return pr;
  if (route.includes('/annotations?')) return [{
    path: 'scripts/file.js', start_line: 15, title: 'Rule S999',
    message: 'Handle empty entries'
  }];
  if (route.includes('/issues/23/comments?')) {
    return lastComment ? [lastComment] : [];
  }
  if (method === 'POST' || method === 'PATCH') {
    lastComment = { id: 44, user: { login: 'github-actions[bot]' },
      body: payload.body };
    return lastComment;
  }
  throw new Error('Unexpected API route ' + route);
}
(async () => {
  const event = { repository: { full_name: REPO }, check_run: check };
  assert.equal(await runRelay({ event, repository: REPO, api }), 1);
  assert.ok(lastComment.body.includes('scripts/file.js:15'));
  assert.ok(lastComment.body.includes('Rule S999'));
  assert.ok(lastComment.body.includes(SHA));
  assert.equal(await runRelay({ event, repository: REPO, api }), 0,
    'replaying the check must not duplicate or edit an unchanged comment');
  assert.equal(calls.filter(x => x.method === 'POST').length, 1);
  assert.equal(await runRelay({ event, repository: 'other/repo', api }), 0);
  assert.equal(await runRelay({ event: { ...event,
    check_run: { ...check, head_sha: OTHER_SHA } }, repository: REPO, api }), 0);
  assert.equal(await runRelay({ event: { ...event,
    check_run: { ...check, name: 'test' } }, repository: REPO, api }), 0);

  const scan = [];
  const pushApi = async (route, method = 'GET', payload) => {
    if (route.includes('/pulls?state=open')) return [pr];
    if (route.includes('/commits/' + SHA + '/check-runs?')) {
      return { check_runs: [{ ...check, pull_requests: [] }] };
    }
    if (route.includes('/commits/' + SHA + '/pulls?')) return [pr];
    if (route.includes('/pulls/23')) return pr;
    if (route.includes('/annotations?')) return [];
    if (route.includes('/issues/23/comments?')) return [];
    if (method === 'POST') { scan.push(payload.body); return { id: 2 }; }
    throw new Error('Unexpected bootstrap route ' + route);
  };
  assert.equal(await runRelay({ event: {
    repository: { full_name: REPO }, ref: 'refs/heads/main'
  }, repository: REPO, api: pushApi }), 1);
  assert.match(scan[0], /No GitHub annotations were returned/);
  assert.equal(await runRelay({ event: {
    repository: { full_name: REPO }, ref: 'refs/heads/feature'
  }, repository: REPO, api: pushApi }), 0);
  console.log('Sonar relay: exact-head, bootstrap, idempotence and empty annotations verified');
})().catch(error => { console.error(error); process.exitCode = 1; });
