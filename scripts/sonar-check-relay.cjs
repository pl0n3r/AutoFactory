'use strict';

const fs = require('node:fs');

const MARKER = '<!-- autofactory-sonar-check-details -->';
const CHECK_NAME = 'SonarCloud Code Analysis';
const SONAR_APP = 'sonarqubecloud';
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const MAX_PR_SCAN = 30;
const MAX_ANNOTATIONS = 30;

function plain(value, limit = 260) {
  return String(value ?? '').slice(0, limit)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[<>&`*_[\]@]/g, character => ({
      '<': '&lt;', '>': '&gt;', '&': '&amp;', '`': '\\`',
      '*': '\\*', '_': '\\_', '[': '\\[', ']': '\\]', '@': '＠'
    })[character] || character);
}
function code(value, limit = 260) {
  return String(value ?? '').slice(0, limit)
    .replace(/[\r\n\t`]+/g, ' ');
}

function isSonarCheck(check) {
  return Boolean(check && check.name === CHECK_NAME &&
    check.app?.slug === SONAR_APP && check.status === 'completed' &&
    ['success', 'failure', 'neutral', 'cancelled', 'timed_out'].includes(check.conclusion) &&
    SHA_PATTERN.test(check.head_sha || '') &&
    Number.isSafeInteger(check.id) && check.id > 0);
}
function choosePR(pulls, sha, repo) {
  if (!SHA_PATTERN.test(sha || '')) return null;
  return (pulls || []).find(pr =>
    pr && Number.isSafeInteger(pr.number) && pr.number > 0 &&
    pr.state === 'open' && pr.head?.sha === sha &&
    pr.head?.repo?.full_name === repo) || null;
}
function render(check, annotations, count) {
  const lines = [
    MARKER,
    '## SonarCloud · GitHub check annotations',
    '',
    '**Check SHA:** `' + check.head_sha + '`',
    '**Conclusion:** `' + code(check.conclusion, 30) + '`',
    '**Check ID:** `' + check.id + '`',
    ''
  ];
  if (!annotations.length) {
    lines.push('No GitHub annotations were returned for this check. This does **not** mean there are no Sonar findings. The Sonar dashboard or an authenticated diagnostic is still needed.');
  } else {
    const shown = Math.min(annotations.length, MAX_ANNOTATIONS);
    lines.push('Showing ' + shown + ' of ' + count +
      ' retrieved annotations (up to ' + MAX_ANNOTATIONS + '):', '');
    for (const annotation of annotations.slice(0, MAX_ANNOTATIONS)) {
      const file = code(annotation.path || 'unknown', 200);
      const line = Number.isSafeInteger(annotation.start_line) &&
        annotation.start_line > 0 ? ':' + annotation.start_line : '';
      lines.push('- `' + file + line + '` · **' +
        plain(annotation.annotation_level || 'notice', 20) +
        '** · ' + plain(annotation.title || annotation.message || '', 200));
      if (annotation.title && annotation.message) {
        lines.push('  - ' + plain(annotation.message, 300));
      }
    }
  }
  lines.push('', '_This comment reflects the exact GitHub check, not an independent Sonar Quality Gate. Never infer GREEN from an empty annotation list._');
  return lines.join('\n').slice(0, 25000);
}
async function runRelay({ event, repository, api }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') ||
      event?.repository?.full_name !== repository) return 0;
  let checks = [];
  if (event.check_run) {
    if (isSonarCheck(event.check_run)) checks = [event.check_run];
  } else if (event.ref === 'refs/heads/main' && event.deleted !== true) {
    const pulls = await api('/repos/' + repository + '/pulls?state=open&per_page=100');
    for (const pr of pulls.slice(0, MAX_PR_SCAN)) {
      if (!choosePR([pr], pr.head?.sha, repository)) continue;
      const response = await api('/repos/' + repository + '/commits/' +
        pr.head.sha + '/check-runs?check_name=' + encodeURIComponent(CHECK_NAME) + '&per_page=100');
      const valid = (response.check_runs || []).filter(check =>
        isSonarCheck(check) && check.head_sha === pr.head.sha);
      valid.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
      if (valid.length) checks.push(valid[0]);
    }
  }
  let updated = 0;
  for (const check of checks) {
    let pulls = check.pull_requests || [];
    if (!pulls.length) {
      pulls = await api('/repos/' + repository + '/commits/' +
        check.head_sha + '/pulls?per_page=100');
    }
    const candidates = [];
    for (const item of pulls.slice(0, MAX_PR_SCAN)) {
      if (!Number.isSafeInteger(item.number) || item.number <= 0) continue;
      const pr = await api('/repos/' + repository + '/pulls/' + item.number);
      if (choosePR([pr], check.head_sha, repository)) candidates.push(pr);
    }
    for (const pr of candidates) {
      let annotations = [];
      for (let page = 1; page <= 2; page++) {
        const part = await api('/repos/' + repository + '/check-runs/' + check.id +
          '/annotations?per_page=100&page=' + page);
        if (!Array.isArray(part)) throw new TypeError('Malformed check annotations');
        annotations.push(...part);
        if (part.length < 100) break;
      }
      const body = render(check, annotations, annotations.length);
      let previous = null;
      for (let page = 1; page <= 5 && previous === null; page++) {
        const comments = await api('/repos/' + repository + '/issues/' +
          pr.number + '/comments?per_page=100&page=' + page);
        if (!Array.isArray(comments)) throw new TypeError('Malformed issue comments');
        previous = comments.find(comment =>
          comment?.user?.login === 'github-actions[bot]' &&
          comment.body?.includes(MARKER)) || null;
        if (comments.length < 100) break;
      }
      if (previous && previous.body === body) continue;
      const url = previous
        ? '/repos/' + repository + '/issues/comments/' + previous.id
        : '/repos/' + repository + '/issues/' + pr.number + '/comments';
      await api(url, previous ? 'PATCH' : 'POST', { body });
      updated++;
    }
  }
  return updated;
}
async function githubApi(route, method = 'GET', payload) {
  if (!process.env.GH_TOKEN) throw new Error('GitHub token unavailable');
  const response = await fetch('https://api.github.com' + route, {
    method, headers: {
      Authorization: 'Bearer ' + process.env.GH_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'AutoFactory-Sonar-Relay'
    },
    ...(payload ? { body: JSON.stringify(payload) } : {})
  });
  if (!response.ok) throw new Error('GitHub API HTTP ' + response.status);
  return response.json();
}
if (require.main === module) {
  (async () => {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const count = await runRelay({
      event, repository: process.env.GITHUB_REPOSITORY, api: githubApi
    });
    console.log('Sonar check reports updated: ' + count);
  })().catch(error => {
    console.error('Sonar check relay failed: ' + error.message);
    process.exitCode = 1;
  });
}
module.exports = { plain, code, isSonarCheck, choosePR, render, runRelay };
