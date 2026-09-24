const assert = require('node:assert/strict');
const fs = require('node:fs');

const popup = fs.readFileSync('popup.js', 'utf8');
const content = fs.readFileSync('content.js', 'utf8');

assert.match(popup, /savedPrompt\.length>0/);
assert.doesNotMatch(popup, /prompt[^\n]{0,120}length>=220/);
assert.match(content, /prompt\.length === 0/);
assert.doesNotMatch(content, /prompt\.length < 220/);

console.log('Mensaje personalizado: cualquier texto no vacío se conserva y se envía');
