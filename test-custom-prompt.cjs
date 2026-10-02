const assert = require('node:assert/strict');
const fs = require('node:fs');

const popup = fs.readFileSync('popup.js', 'utf8');
const content = fs.readFileSync('content.js', 'utf8');

assert.match(popup, /savedPrompt\.length>0/);
assert.doesNotMatch(popup, /prompt[^\n]{0,120}length>=220/);
assert.match(content, /prompt\.length === 0/);
assert.doesNotMatch(content, /prompt\.length < 220/);
assert.doesNotMatch(content, /composerRemainsExact/, 'no debe validar durante la reconstrucción transitoria de React');
assert.match(content, /if \(!currentText\) \{[\s\S]*core\.replaceComposerText\(currentField, prompt, document\)/,
  'si React remonta el compositor vacío, debe restaurar el mensaje una sola vez');
assert.match(content, /throw new Error\('El contenido cambió antes del envío'\)/,
  'si aparece texto distinto, debe conservarlo y cancelar el envío');

console.log('Mensaje personalizado: cualquier texto no vacío se conserva y se envía');

assert.match(content, /function reasoningSelectorButton\(\)/);
assert.match(content, /selected-after-thinking/);
assert.match(content, /reasoningSelectorButton\(\) \|\| modelSelectorButton\(\)/);
console.log('Razonamiento: Alto se busca antes del selector general y admite Thinking como paso intermedio');
