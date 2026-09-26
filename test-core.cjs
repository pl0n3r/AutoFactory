const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const core = require('./autopilot-core.js');
const learning = require('./learning.js');

function page(html) {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  global.InputEvent = dom.window.InputEvent;
  return dom.window.document;
}

{
  const doc = page('<div id="prompt-textarea" contenteditable="true"></div><button id="composer-submit-button">Enviar</button>');
  const field = core.composer(doc);
  assert.ok(field);
  assert.equal(core.replaceComposerText(field, 'Mensaje exacto', doc), true);
  assert.equal(core.composerText(field), 'Mensaje exacto');
  assert.equal(core.sendButton(doc).id, 'composer-submit-button');
  assert.equal(core.canSend(core.sendButton(doc)), true);
}
{
  const doc = page('<button aria-label="Selector de modelo"></button><textarea placeholder="Chatear con ChatGPT"></textarea><button data-testid="send-button" disabled></button>');
  const field = core.composer(doc);
  assert.equal(field.tagName, 'TEXTAREA');
  assert.equal(core.replaceComposerText(field, 'Derecha', doc), true);
  assert.equal(core.composerText(field), 'Derecha');
  assert.equal(core.canSend(core.sendButton(doc)), false);
}
{
  const doc = page('<button data-testid="stop-button">Detener</button>');
  assert.ok(core.stopButton(doc));
  assert.equal(core.composer(doc), null);
}
{
  const doc = page('<article data-message-author-role="assistant"></article><article data-message-author-role="assistant"></article><button aria-label="Reintentar">Reintentar</button><button>Eliminar</button>');
  assert.equal(core.assistantMessageCount(doc), 2);
  assert.equal(core.recoveryButton(doc).getAttribute('aria-label'), 'Reintentar');
}
{
  const doc = page('<button>Confirmar compra</button><button>Permitir acceso</button>');
  assert.equal(core.recoveryButton(doc), null);
  assert.deepEqual(core.pageSignal(doc), { code: 'interface-missing', action: 'reload' });
}
{
  const visible = page('<main></main>');
  assert.equal(core.isPageVisible(visible), true);
  Object.defineProperty(visible, 'visibilityState', { value: 'hidden' });
  assert.equal(core.isPageVisible(visible), false);
}
console.log('DOM core: 6 escenarios correctos');

let memory = learning.normalize();
memory = learning.update(memory, 'startup', 2000);
memory = learning.update(memory, 'startup', 4000);
memory = learning.update(memory, 'startup', 3000);
memory = learning.update(memory, 'cycle', 60000);
memory = learning.update(memory, 'recovery');
assert.equal(memory.cycles, 1);
assert.equal(memory.recoveries, 1);
assert.equal(learning.startupTimeoutMs(memory), 16000);
memory = learning.update(memory, 'error', 0, { code: 'connection' });
memory = learning.update(memory, 'action-success', 0, { code: 'connection', action: 'reload' });
assert.equal(memory.errorsByCode.connection, 1);
assert.equal(memory.actionSuccess['connection:reload'], 1);
assert.equal(learning.errorBackoffMs(memory, 'connection'), 30000);
for (let i = 0; i < 80; i += 1) memory = learning.update(memory, 'startup', 1000 + i);
assert.equal(memory.startupSamplesMs.length, 50);
console.log('Memoria adaptativa: métricas, percentil y límite de 50 muestras correctos');

assert.equal(core.reasoningLevelFromText('Medium'), 'medium');
assert.equal(core.reasoningLevelFromText('Media'), 'medium');
assert.equal(core.reasoningLevelFromText('High'), 'high');
console.log('Razonamiento: reconoce el nivel actual Medium/Media/High');
