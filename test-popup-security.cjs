const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');

const root = __dirname, safari = path.join(root, 'safari', 'ChatGPT Autopilot Local Extension', 'Resources');
assert.equal(fs.readFileSync(path.join(safari, 'popup.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'popup.js'), 'utf8'),
  'Safari must use the identical secure popup renderer');

const dom = new JSDOM(fs.readFileSync(path.join(root, 'popup.html'), 'utf8'), {
  url: 'https://extension.test/', runScripts: 'outside-only'
});
const { window } = dom;
let executed = false, legacyCopyCalls = 0;
window.__unsafeExecution = () => { executed = true; };
window.setInterval = () => 0;
window.document.execCommand = command => {
  if (command === 'copy') legacyCopyCalls += 1;
  return command === 'copy';
};
window.chrome = {
  runtime: { getManifest: () => ({ version: '1.6.7' }), lastError: null },
  storage: {
    local: {
      get(defaults, reply) { reply({ ...defaults, learning: {} }); },
      set(_values, reply) { reply?.(); }
    },
    onChanged: { addListener() {} }
  },
  tabs: { query(_query, reply) { reply([]); } }
};

window.eval(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'));

(async () => {
const injection = '<img src=x onerror="window.__unsafeExecution()">';
window.renderLearning({
  cycles: 4, recoveries: 2, failures: 1,
  responseSamplesMs: [1000, 2000], startupSamplesMs: [3000, 4000],
  errorsByCode: { [injection]: 3 }, actionSuccess: { [injection + ':reload']: 1 }
});
const result = window.document.getElementById('learning-details');
for (const [actual, expected] of [
  [executed, false],
  [result.querySelector('img'), null],
  [result.querySelectorAll('b').length, 4],
  [result.textContent.includes(injection + ' (3)'), true],
  [result.textContent.includes(injection + ':reload (1)'), true],
  [result.textContent.includes('Inicio medio: 3.5 s · p90: 4.0 s'), true],
  [result.textContent.includes('Respuesta media: 1.5 s · p90: 2.0 s'), true],
  [window.document.getElementById('cycles').textContent, '4'],
  [window.document.getElementById('recoveries').textContent, '2'],
  [window.document.getElementById('failures').textContent, '1']
]) assert.equal(actual, expected);
window.renderSharedLearning({enabled:true,mode:'observe',policyVersion:7,localSamples:12,sharedSamples:45,confidence:.91,successRate:.88,lastSyncAt:1800000000000,source:'shared-observe',lastError:injection});
const shared = window.document.getElementById('shared-learning-details');
assert.equal(shared.querySelector('img'), null);
assert.equal(shared.textContent.includes('Política 7'), true);
assert.equal(shared.textContent.includes('45 compartidas'), true);
assert.equal(shared.textContent.includes(injection), true);
const textareaCount = window.document.querySelectorAll('textarea').length;
window.navigator.clipboard = { writeText: async () => { throw new Error('denied'); } };
await window.copyText('diagnostic fallback');
assert.equal(legacyCopyCalls, 1);
assert.equal(window.document.querySelectorAll('textarea').length, textareaCount);

window.navigator.clipboard = {
  writeText: async text => { assert.equal(text, 'diagnostic modern'); }
};
await window.copyText('diagnostic modern');
assert.equal(legacyCopyCalls, 1);
for (const value of [
  { errorsByCode: {}, actionSuccess: {} },
  null,
  { errorsByCode: 'untrusted', actionSuccess: [] }
]) window.renderLearning(value);
assert.equal(result.textContent.includes('ninguno'), true);
assert.equal(result.textContent.includes('aún sin datos'), true);
assert.equal(result.querySelector('img'), null);

console.log('Popup metrics: safe rendering, exact stats, clipboard fallback and empty states');
})().catch(error => { console.error(error); process.exitCode = 1; });
