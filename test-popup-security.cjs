const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = __dirname;
const safari = path.join(root, 'safari', 'ChatGPT Autopilot Local Extension', 'Resources');
assert.equal(
  fs.readFileSync(path.join(safari, 'popup.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'popup.js'), 'utf8'),
  'Safari must use the identical secure popup renderer'
);

const dom = new JSDOM(fs.readFileSync(path.join(root, 'popup.html'), 'utf8'), {
  url: 'https://extension.test/',
  runScripts: 'outside-only'
});
const { window } = dom;
let executed = false;
window.__unsafeExecution = () => { executed = true; };
window.setInterval = () => 0;
let legacyCopyCalls = 0;
window.document.execCommand = command => {
  if (command === 'copy') legacyCopyCalls += 1;
  return command === 'copy';
};
window.chrome = {
  runtime: {
    getManifest: () => ({ version: '1.6.7' }),
    lastError: null
  },
  storage: {
    local: {
      get(defaults, reply) { reply({ ...defaults, learning: {} }); },
      set(_values, reply) { reply?.(); }
    },
    onChanged: { addListener() {} }
  },
  tabs: {
    query(_query, reply) { reply([]); }
  }
};

window.eval(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'));

const injection = '<img src=x onerror="window.__unsafeExecution()">';
window.renderLearning({
  cycles: 4,
  recoveries: 2,
  failures: 1,
  responseSamplesMs: [1000, 2000],
  startupSamplesMs: [3000, 4000],
  errorsByCode: { [injection]: 3 },
  actionSuccess: { [injection + ':reload']: 1 }
});

const result = window.document.getElementById('learning-details');
assert.equal(executed, false);
assert.equal(result.querySelector('img'), null);
assert.equal(result.querySelectorAll('b').length, 4);
assert.equal(result.textContent.includes(injection + ' (3)'), true);
assert.equal(result.textContent.includes(injection + ':reload (1)'), true);
assert.equal(result.textContent.includes('Inicio medio: 3.5 s · p90: 4.0 s'), true);
assert.equal(result.textContent.includes('Respuesta media: 1.5 s · p90: 2.0 s'), true);
assert.equal(window.document.getElementById('cycles').textContent, '4');
assert.equal(window.document.getElementById('recoveries').textContent, '2');
assert.equal(window.document.getElementById('failures').textContent, '1');

window.navigator.clipboard = {
  writeText: async () => { throw new Error('denied'); }
};
await window.copyText('diagnostic fallback');
assert.equal(legacyCopyCalls, 1);
assert.equal(window.document.querySelector('textarea'), null);

window.navigator.clipboard = {
  writeText: async text => { assert.equal(text, 'diagnostic modern'); }
};
await window.copyText('diagnostic modern');
assert.equal(legacyCopyCalls, 1);

window.renderLearning({ errorsByCode: {}, actionSuccess: {} });
window.renderLearning(null);
window.renderLearning({ errorsByCode: 'untrusted', actionSuccess: [] });
assert.equal(result.textContent.includes('ninguno'), true);
assert.equal(result.textContent.includes('aún sin datos'), true);
assert.equal(result.querySelector('img'), null);

console.log('Popup metrics: safe text rendering, exact counts, percentiles and empty states');
