'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = __dirname;
const safari = path.join(root, 'safari', 'ChatGPT Autopilot Local Extension', 'Resources');
const { present, mountPreview } = require('./factory-control-pairing-preview.js');
const labels = {
  desconectado: 'SIN CONEXIÓN · estado ficticio',
  pendiente: 'PENDIENTE · estado ficticio',
  denegado: 'DENEGADO · estado ficticio',
  vencido: 'VENCIDO · estado ficticio',
  revocado: 'REVOCADO · estado ficticio'
};
for (const [state, label] of Object.entries(labels)) {
  assert.deepEqual(present(state), { state, label });
  assert.equal(Object.isFrozen(present(state)), true);
}
let accessed = false;
const hostile = Object.defineProperty({}, 'state', { get() { accessed = true; throw Error('getter must not run'); } });
for (const value of [null, undefined, '', 'paired', '123456', hostile, ['pendiente'], 0]) {
  assert.deepEqual(present(value), { state: 'unknown', label: 'UNKNOWN · simulación apagada' });
}
assert.equal(accessed, false);
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'factory-control-pairing-preview.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const dom = new JSDOM(html, { url: 'https://extension.test/', runScripts: 'outside-only' });
const { document, Event } = dom.window;
assert.match(html, /SIMULACIÓN · OFF/);
assert.match(html, /<script src="factory-control-pairing-preview\.js"><\/script><script src="popup\.js"><\/script>/);
assert.match(popup, /ChatGPTAutopilotFactoryPairingPreview\.mountPreview\(document\)/);
assert.doesNotMatch(source, /\bfetch\s*\(|\bXMLHttpRequest\b|\bchrome\.runtime\b|\bstorage\b/);
const select = document.getElementById('factory-control-preview-state');
const status = document.getElementById('factory-control-preview-status');
assert.ok(select && status);
assert.equal(status.getAttribute('role'), 'status');
assert.equal(status.getAttribute('aria-live'), 'polite');
assert.equal(document.querySelector('label[for="factory-control-preview-state"]') !== null, true);
for (const name of ['factory-control-preview-pair', 'factory-control-preview-revoke',
  'factory-control-pair', 'factory-control-revoke']) {
  assert.equal(document.getElementById(name).disabled, true, name);
}
assert.equal(mountPreview(document), true);
for (const [state, label] of Object.entries(labels)) {
  select.value = state;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(status.textContent, label);
}
select.value = 'invalid';
select.dispatchEvent(new Event('change', { bubbles: true }));
assert.equal(status.textContent, 'UNKNOWN · simulación apagada');
assert.equal(mountPreview(null), false);
for (const file of ['popup.js', 'popup.html', 'factory-control-pairing-preview.js']) {
  assert.equal(fs.readFileSync(path.join(root, file), 'utf8'),
    fs.readFileSync(path.join(safari, file), 'utf8'), file + ' Chrome/Safari byte mismatch');
}
console.log('Pairing preview: 5 offline states, hostile inputs, accessible sample UI, disabled real controls and Safari parity');
