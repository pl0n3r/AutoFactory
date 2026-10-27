'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = __dirname;
const safari = path.join(root, 'safari', 'ChatGPT Autopilot Local Extension', 'Resources');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const dom = new JSDOM(html, { url: 'https://extension.test/', runScripts: 'outside-only' });
const { window } = dom;
window.setInterval = () => 0;
window.document.execCommand = () => true;
window.chrome = {
  runtime: { getManifest: () => ({ version: '1.7.38' }), lastError: null },
  storage: {
    local: { get(defaults, reply) { reply({ ...defaults, learning: {} }); }, set(_values, reply) { reply?.(); } },
    onChanged: { addListener() {} }
  },
  tabs: { query(_query, reply) { reply([]); } }
};
assert.match(html, /SIMULACIÓN · OFF/);
assert.doesNotMatch(html, /<script src="factory-control-pairing-preview\.js"/);
assert.match(html, /<script src="factory-control-local-commands\.js"><\/script><script src="popup\.js"><\/script>/);
assert.match(popup, /function renderPairingPreview\(\)/);
window.eval(popup);
const select = window.document.getElementById('factory-control-preview-state');
const status = window.document.getElementById('factory-control-preview-status');
assert.ok(select && status);
assert.equal(status.getAttribute('role'), 'status');
assert.equal(status.getAttribute('aria-live'), 'polite');
assert.ok(window.document.querySelector('label[for="factory-control-preview-state"]'));
for (const name of ['factory-control-preview-pair', 'factory-control-preview-revoke',
  'factory-control-pair', 'factory-control-revoke']) {
  assert.equal(window.document.getElementById(name).disabled, true, name);
}
const expected = {
  desconectado: 'SIN CONEXIÓN · estado ficticio',
  pendiente: 'PENDIENTE · estado ficticio',
  denegado: 'DENEGADO · estado ficticio',
  vencido: 'VENCIDO · estado ficticio',
  revocado: 'REVOCADO · estado ficticio'
};
for (const [state, text] of Object.entries(expected)) {
  select.value = state;
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(status.textContent, text);
}
select.value = 'invalid';
select.dispatchEvent(new window.Event('change', { bubbles: true }));
assert.equal(status.textContent, 'UNKNOWN · simulación apagada');
const start = popup.indexOf('// Demo local: only hard-coded presentation');
const stop = popup.indexOf("const factoryControlBridgeStatus=$('factory-control-bridge-status');");
assert.ok(start > 0 && stop > start);
const demo = popup.slice(start, stop);
assert.doesNotMatch(demo, /\bfetch\s*\(|\bXMLHttpRequest\b|\bruntime\b|\bstorage\b|\bcredential\s*[:=]/);
for (const file of ['popup.js', 'popup.html']) {
  assert.equal(fs.readFileSync(path.join(root, file), 'utf8'),
    fs.readFileSync(path.join(safari, file), 'utf8'), file + ' Chrome/Safari source drift');
}
console.log('Pairing preview: 5 demo states, keyboard-accessible selector, locked real buttons and Safari parity');
