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
assert.match(content, /button = core\.sendButton\(document\);[\s\S]*button\?\.isConnected[\s\S]*button\.click\(\)/,
  'debe recuperar y pulsar el botón vivo después del último render de React');
assert.match(content, /ambiguousSendFailure[\s\S]*circuitOpenUntil = Date\.now\(\) \+ 300000/,
  'un envío no confirmado debe abrir la protección sin reintentos ambiguos');
assert.match(content, /function promptMatches\(value, prompt\)[\s\S]*reliability\.signature\(value\) === reliability\.signature\(prompt\)/,
  'debe reconocer su borrador aunque el editor normalice espacios o saltos');
assert.match(content, /const resumableDraft = promptMatches\(core\.composerText\(field\), prompt\)/,
  'el ciclo debe retomar un borrador propio normalizado');
assert.match(content, /signal\.code === 'conversation-limit'[\s\S]*location\.pathname === '\/'[\s\S]*signal = \{ code: 'ready', action: 'none' \}/,
  'una pestaña que ya está en chat nuevo no debe abrir otro chat');
assert.match(content, /if \(periodicReloadDue\) \{[\s\S]{0,500}location\.reload\(\)/,
  'el refresh periódico vencido debe recargar incluso mientras espera una respuesta');

console.log('Mensaje personalizado: cualquier texto no vacío se conserva y se envía');

assert.match(content, /function reasoningSelectorButton\(\)/);
assert.match(content, /selected-after-thinking/);
assert.match(content, /reasoningSelectorButton\(\) \|\| modelSelectorButton\(\)/);
console.log('Razonamiento: Alto se busca antes del selector general y admite Thinking como paso intermedio');
