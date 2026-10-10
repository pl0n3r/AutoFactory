const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const core = require('./autopilot-core.js');
const learning = require('./learning.js');
const { classifyProviderPageSignal } = require('./factory-control-account-state.js');

assert.equal(core.enabledStateChanged(true, true), false);
assert.equal(core.enabledStateChanged(false, true), true);
console.log('Activación: órdenes repetidas no reinician temporizadores');

function page(html) {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  global.InputEvent = dom.window.InputEvent;
  return dom.window.document;
}


const sendButtonScopeCases = {
  prefers_visible_enabled_composer_button() {
    const doc = page(
      '<button id="composer-submit-button" disabled>Enviar</button>' +
      '<form id="other"><button type="submit" aria-label="Send message">Send</button></form>' +
      '<form id="chat"><textarea placeholder="ChatGPT"></textarea>' +
      '<button id="actual" data-testid="send-button" aria-label="Send message">Send</button></form>'
    );
    assert.equal(core.sendButton(doc)?.id, 'actual');
    const hidden = page(
      '<form><textarea placeholder="ChatGPT"></textarea>' +
      '<div hidden><button id="hidden" aria-label="Send message">Send</button></div>' +
      '<button id="visible" aria-label="Enviar mensaje">Enviar</button></form>'
    );
    assert.equal(core.sendButton(hidden)?.id, 'visible');
    const transparent = page(
      '<form><textarea placeholder="ChatGPT"></textarea>' +
      '<button id="transparent" aria-label="Send message" style="opacity:0">Send</button>' +
      '<button id="solid" aria-label="Enviar mensaje">Enviar</button></form>'
    );
    assert.equal(core.sendButton(transparent)?.id, 'solid');
    const inheritedOpacity = page(
      '<form><textarea placeholder="ChatGPT"></textarea>' +
      '<div style="opacity:0"><button id="invisible" aria-label="Send message">Send</button></div>' +
      '<button id="visible" aria-label="Enviar mensaje">Enviar</button></form>'
    );
    assert.equal(core.sendButton(inheritedOpacity)?.id, 'visible');
  },
  unrelated_or_unsafe_controls_fail_closed() {
    const withoutComposer = page('<button aria-label="Send message">Send</button>');
    assert.equal(core.sendButton(withoutComposer), null);
    const unrelated = page(
      '<form><textarea placeholder="ChatGPT"></textarea></form>' +
      '<form><button type="submit" aria-label="Send message">Enviar</button></form>'
    );
    assert.equal(core.sendButton(unrelated), null);
    const unsafe = page(
      '<form><textarea placeholder="ChatGPT"></textarea>' +
      '<button data-testid="send-voice" aria-label="Voice">Voice</button>' +
      '<button data-testid="send-payment" aria-label="Confirmar compra">Comprar</button>' +
      '<button aria-label="Enviar mensaje" disabled>Enviar</button>' +
      '<button style="display:none" aria-label="Send message">Send</button>' +
      '<button aria-label="Autorizar envío">Autorizar</button>' +
      '<button aria-label="Stop generating">Stop</button></form>'
    );
    assert.equal(core.sendButton(unsafe), null);
    const transparentOnly = page(
      '<form><textarea placeholder="ChatGPT"></textarea>' +
      '<button aria-label="Send message" style="opacity:0">Send</button></form>'
    );
    assert.equal(core.sendButton(transparentOnly), null);
    const parentInvisibleOnly = page(
      '<form><textarea placeholder="ChatGPT"></textarea>' +
      '<div style="opacity:0"><button aria-label="Send message">Send</button></div></form>'
    );
    assert.equal(core.sendButton(parentInvisibleOnly), null);
    const genericAction = page(
      '<form><textarea placeholder="ChatGPT"></textarea>' +
      '<button type="button">Send feedback</button></form>'
    );
    assert.equal(core.sendButton(genericAction), null);
    const report = page(
      '<form><textarea placeholder="ChatGPT"></textarea>' +
      '<button type="submit" aria-label="Send report">Send report</button></form>'
    );
    assert.equal(core.sendButton(report), null);
    const semanticDisabled = page(
      '<form><textarea placeholder="ChatGPT"></textarea>' +
      '<div aria-disabled="true"><button aria-label="Send message">Send</button></div>' +
      '<button id="enabled" aria-label="Enviar mensaje">Enviar</button></form>'
    );
    assert.equal(core.sendButton(semanticDisabled)?.id, 'enabled');
    assert.equal(core.canSend(semanticDisabled.querySelector('[aria-disabled] button')), false);
    semanticDisabled.querySelector('#enabled').remove();
    assert.equal(core.sendButton(semanticDisabled), null);
    const reset = page(
      '<form><textarea placeholder="ChatGPT"></textarea>' +
      '<button type="reset" aria-label="Send message">Send</button></form>'
    );
    assert.equal(core.sendButton(reset), null);
    const ambiguous = page(
      '<form><textarea placeholder="ChatGPT"></textarea>' +
      '<button aria-label="Send message">Send</button>' +
      '<button aria-label="Enviar mensaje">Enviar</button></form>'
    );
    assert.equal(core.sendButton(ambiguous), null);
  },
  normal_composer_backward_compatibility() {
    const legacy = page(
      '<div id="prompt-textarea" contenteditable="true"></div>' +
      '<button id="composer-submit-button">Enviar</button>'
    );
    assert.equal(core.sendButton(legacy)?.id, 'composer-submit-button');
    const form = page(
      '<form id="chat"><textarea placeholder="ChatGPT"></textarea>' +
      '<button type="submit" aria-label="Send message">Send</button></form>'
    );
    assert.equal(core.sendButton(form)?.getAttribute('aria-label'), 'Send message');
    form.querySelector('button').remove();
    assert.equal(core.sendButton(form), null);
    const replacement = form.createElement('button');
    replacement.setAttribute('aria-label', 'Enviar mensaje');
    form.querySelector('form').appendChild(replacement);
    assert.equal(core.sendButton(form), replacement);
  }
};
const requestedSendCase = process.argv.find(arg => arg.startsWith('--send-button-case='));
if (requestedSendCase) {
  const name = requestedSendCase.slice('--send-button-case='.length);
  assert.equal(typeof sendButtonScopeCases[name], 'function', 'Unknown send-button case');
  sendButtonScopeCases[name]();
  console.log('Send-button case passed: ' + name);
  process.exit(0);
}
for (const run of Object.values(sendButtonScopeCases)) run();

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
  assert.equal(core.isSafeRecoverySignal(core.pageSignal(doc)), true);
  assert.equal(core.isSafeRecoverySignal({ code: 'connection', action: 'reload' }), false);
  assert.equal(core.recoverableEscalation(1), 'retry');
  assert.equal(core.recoverableEscalation(2), 'reload');
  assert.equal(core.recoverableEscalation(3), 'new-chat');
  assert.equal(core.recoverableEscalation(4), 'wait');
  assert.deepEqual(core.recoverablePlan({}, '/c/1'), {
    path: '/c/1', attempts: 1, action: 'retry', retryAt: 0
  });
  assert.deepEqual(core.recoverablePlan({ path: '/c/1', attempts: 1 }, '/c/1'), {
    path: '/c/1', attempts: 2, action: 'reload', retryAt: 0
  });
  assert.deepEqual(core.recoverablePlan({ path: '/c/1', attempts: 2 }, '/c/1'), {
    path: '/c/1', attempts: 3, action: 'new-chat', retryAt: 0
  });
  assert.deepEqual(core.recoverablePlan({ path: '/c/1', attempts: 3 }, '/c/1'), {
    path: '/c/1', attempts: 4, action: 'wait', retryAt: 0
  });
  assert.deepEqual(core.recoverablePlan({ path: '/c/1', attempts: 8 }, '/c/1'), {
    path: '/c/1', attempts: 4, action: 'wait', retryAt: 0
  });
  assert.deepEqual(core.recoverableState(null), {});
  assert.deepEqual(core.recoverableState('{"path":"/c/1","attempts":2}'), {
    path: '/c/1', attempts: 2
  });
  assert.deepEqual(core.recoverableState('{broken'), {});
  assert.deepEqual(core.recoverableState('[]'), {});
  assert.equal(core.normalize('  A\u00a0B\r\nC  '), 'A B\nC');
  assert.equal(core.normalize('A\u00a0\u00a0B\r\nC\r\nD'), 'A  B\nC\nD');
}
{
  const doc = page('<button>Confirmar compra</button><button>Permitir acceso</button>');
  assert.equal(core.recoveryButton(doc), null);
  assert.deepEqual(core.pageSignal(doc), { code: 'interface-missing', action: 'reload' });
}
{
  const doc = page(
    '<div id="prompt-textarea" contenteditable="true"></div>' +
    '<div role="alert">Has alcanzado el límite de uso. Inténtalo de nuevo a las 16:45. private@example.test token=never-log</div>'
  );
  assert.deepEqual(core.pageSignal(doc), { code: 'rate-limit', action: 'wait' });
  const providerSignal = core.providerAccountSignal(doc);
  assert.equal(providerSignal.signalCode, 'rate-limit');
  assert.equal(providerSignal.alertText.length <= 500, true);
  assert.equal(providerSignal.alertText.includes('16:45'), true);
  assert.deepEqual(
    classifyProviderPageSignal(
      providerSignal,
      () => new Date(2030, 0, 1, 15, 0, 0, 0).getTime()
    ),
    {
      state: 'limit',
      resetAt: new Date(2030, 0, 1, 16, 45, 0, 0).getTime()
    }
  );
  const classified = JSON.stringify(classifyProviderPageSignal(
    providerSignal,
    () => new Date(2030, 0, 1, 15, 0, 0, 0).getTime()
  ));
  for (const forbidden of ['private@example.test', 'token', 'never-log']) {
    assert.equal(classified.includes(forbidden), false);
  }
}
{
  const doc = page(
    '<div id="prompt-textarea" contenteditable="true"></div>' +
    '<div role="alert">Maintenance window at 4:30 PM.</div>' +
    '<div role="alert">Has alcanzado el límite de uso. Inténtalo de nuevo a las 16:45.</div>'
  );
  const signal = core.providerAccountSignal(doc);
  assert.equal(signal.signalCode, 'rate-limit');
  assert.equal(signal.alertText.includes('16:45'), true);
  assert.equal(signal.alertText.includes('4:30 PM'), false);
  assert.deepEqual(
    classifyProviderPageSignal(
      signal,
      () => new Date(2030, 0, 1, 15, 0, 0, 0).getTime()
    ),
    {
      state: 'limit',
      resetAt: new Date(2030, 0, 1, 16, 45, 0, 0).getTime()
    }
  );
}
{
  const doc = page('<div role="alert">Network error secret@example.test</div>');
  assert.deepEqual(
    core.providerAccountSignal(doc),
    { signalCode: 'connection', alertText: null }
  );
}
{
  const doc = page(
    '<div id="prompt-textarea" contenteditable="true"></div>' +
    '<div role="alert">Límite de uso ' + 'x'.repeat(900) + '</div>'
  );
  const signal = core.providerAccountSignal(doc);
  assert.equal(signal.signalCode, 'rate-limit');
  assert.equal(signal.alertText.length, 500);
}
{
  const visible = page('<main></main>');
  assert.equal(core.isPageVisible(visible), true);
  Object.defineProperty(visible, 'visibilityState', { value: 'hidden' });
  assert.equal(core.isPageVisible(visible), false);
}
console.log('DOM core: señales de página y estado de cuenta efímero correctos');

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
assert.equal(core.reasoningLevelFromText('Esfuerzo de razonamiento Media'), 'medium');
assert.equal(core.reasoningSliderTarget('high', 0, 2), 2);
console.log('Razonamiento: detecta el selector compuesto y calcula el máximo del slider');
{
  const doc = page('<div data-reasoning-slider="true" role="menuitem"><span role="slider" aria-valuenow="1" aria-valuemin="0" aria-valuemax="2"></span></div>');
  const slider = doc.querySelector('[role="slider"]');
  assert.equal(core.reasoningSliderControl(slider).getAttribute('role'), 'menuitem');
}
console.log('Razonamiento: dirige las teclas al control interactivo del slider');

assert.equal(core.modelIdFromText('GPT-6'), 'gpt-6');
assert.equal(core.modelIdFromText('GPT-5.6 Sol'), 'gpt-5.6-sol');
assert.equal(core.modelIdFromText('High'), null);
console.log('Modelo: reconoce GPT-6 sin confundirlo con el nivel de razonamiento');
