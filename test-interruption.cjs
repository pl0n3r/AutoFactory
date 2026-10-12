const assert = require('node:assert/strict');
const core = require('./autopilot-core.js');
const { JSDOM } = require('jsdom');

function element(text, children = []) {
  return { innerText: text, textContent: text, children };
}

function documentFixture(texts) {
  const elements = texts.map(text => element(text));
  return {
    querySelector() { return { id: 'prompt-textarea' }; },
    querySelectorAll(selector) {
      if (selector === 'div, span, p') return elements;
      return [];
    }
  };
}

const interrupted = documentFixture([
  'Pensando',
  'Conexión interrumpida. Esperando la respuesta completa'
]);
assert.equal(core.interruptedConnection(interrupted), true);
assert.deepEqual(core.pageSignal(interrupted), { code: 'connection', action: 'reload' });

const healthy = documentFixture(['ChatGPT está respondiendo']);
assert.equal(core.interruptedConnection(healthy), false);
assert.deepEqual(core.pageSignal(healthy), { code: 'ready', action: 'continue' });

assert.equal(core.connectionRecoveryAction({ generating: true, cancelRequested: false }), 'cancel-generation');
assert.equal(core.connectionRecoveryAction({ generating: true, cancelRequested: true }), 'wait');
assert.equal(core.connectionRecoveryAction({ generating: false, cancelRequested: false }), 'wait');
console.log('Interrupción: mensaje visible detectado y cancelación inmediata clasificada');

assert.equal(core.isOwnedDraft({ value: ' Continuar proyecto ' }, 'Continuar proyecto'), true);
assert.equal(core.isOwnedDraft({ value: 'Texto escrito por la persona' }, 'Continuar proyecto'), false);
console.log('Borrador: solo el prompt exacto del piloto puede retomarse');

const safetyCheck = documentFixture([
  'Nuestros sistemas están haciendo comprobaciones adicionales antes de responder a esta solicitud.'
]);
assert.equal(core.platformReview(safetyCheck), true);
assert.equal(core.additionalSafetyCheck(safetyCheck), true);
assert.deepEqual(core.pageSignal(safetyCheck), { code: 'platform-review', action: 'wait' });
console.log('Plataforma: comprobación adicional detectada sin cancelar ni reenviar');

const processingReview = documentFixture([
  'Nuestros sistemas están procesando esta solicitud un poco más antes de responder.'
]);
assert.equal(core.platformReview(processingReview), true);
assert.deepEqual(core.pageSignal(processingReview), { code: 'platform-review', action: 'wait' });

const englishProcessingReview = documentFixture([
  'Our systems are processing this request a little longer before responding.'
]);
assert.equal(core.platformReview(englishProcessingReview), true);
assert.deepEqual(core.pageSignal(englishProcessingReview), { code: 'platform-review', action: 'wait' });
console.log('Plataforma: revisión moderna detectada en español e inglés');

const reviewBeforeRecovery = {
  querySelector(selector) {
    if (selector === '#prompt-textarea') return { id: 'prompt-textarea' };
    return null;
  },
  querySelectorAll(selector) {
    if (selector === '[data-message-author-role="assistant"]') {
      return [element('Nuestros sistemas están procesando esta solicitud un poco más antes de responder.')];
    }
    if (selector === 'button') {
      return [{
        disabled: false,
        innerText: 'Reintentar',
        textContent: 'Reintentar',
        getAttribute() { return null; }
      }];
    }
    if (selector === 'button, a') return [];
    return [];
  }
};
assert.deepEqual(core.pageSignal(reviewBeforeRecovery), { code: 'platform-review', action: 'wait' });
console.log('Plataforma: la revisión tiene prioridad sobre recuperación o reenvío');

const liveReviewStatus = element('Our systems are reviewing this request before responding.');
liveReviewStatus.closest = () => null;
const liveReviewDocument = {
  querySelector(selector) {
    return selector === '#prompt-textarea' ? { id: 'prompt-textarea' } : null;
  },
  querySelectorAll(selector) {
    if (selector === '[data-message-author-role="assistant"]') {
      return [element('La respuesta anterior ya terminó correctamente.')];
    }
    if (selector === '[role="status"], [role="alert"], [aria-live]') return [liveReviewStatus];
    if (selector === 'button' || selector === 'button, a') return [];
    return [];
  }
};
assert.equal(core.platformReview(liveReviewDocument), true);
assert.deepEqual(core.pageSignal(liveReviewDocument), { code: 'platform-review', action: 'wait' });
console.log('Plataforma: un estado vivo se detecta aunque el último assistant sea histórico');

const historicalSafetyCheck = {
  querySelectorAll(selector) {
    if (selector === '[data-message-author-role="assistant"]') return [
      element('Additional checks before responding to this request.'),
      element('La respuesta normal ya terminó correctamente.')
    ];
    return [];
  }
};
assert.equal(core.platformReview(historicalSafetyCheck), false);
assert.equal(core.additionalSafetyCheck(historicalSafetyCheck), false);
console.log('Plataforma: un aviso histórico no bloquea la respuesta más reciente');

const stopDocument = {
  querySelector(selector) {
    return selector === 'button[aria-label="Stop answering"]' ? { ariaLabel: 'Stop answering' } : null;
  }
};
assert.ok(core.stopButton(stopDocument));
console.log('Interrupción: botón Stop answering reconocido como generación activa');

const compactStopDocument = {
  querySelector(selector) {
    return selector === 'button[aria-label="Stop"]'
      ? { getAttribute() { return 'Stop'; } } : null;
  }
};
assert.ok(core.stopButton(compactStopDocument));
console.log('Interrupción: botón compacto Stop reconocido como generación activa');

const staleStop = {
  hidden: true,
  disabled: false,
  getAttribute() { return null; },
  closest() { return null; }
};
const autopilotStop = {
  id: 'chatgpt-autopilot-stop',
  hidden: false,
  disabled: false,
  getAttribute() { return null; },
  closest(selector) { return selector === '#chatgpt-autopilot-badge' ? {} : null; }
};
const falseStopDocument = {
  querySelectorAll(selector) {
    return selector === 'button[aria-label="Stop"]' ? [staleStop, autopilotStop] : [];
  }
};
assert.equal(core.stopButton(falseStopDocument), null);
console.log('Interrupción: controles Stop ocultos o propios no simulan una respuesta activa');

const newChatButton = {
  disabled: false,
  innerText: 'Iniciar nuevo chat',
  textContent: 'Iniciar nuevo chat',
  getAttribute() { return null; },
  closest() {
    return {
      hidden: false,
      innerText: 'Alcanzaste la duración máxima para esta conversación, pero puedes seguir hablando iniciando un nuevo chat. Iniciar nuevo chat',
      textContent: this.innerText,
      getAttribute() { return null; }
    };
  }
};
const limitedDocument = {
  querySelector() { return null; },
  querySelectorAll(selector) {
    if (selector === 'button, a') return [newChatButton];
    if (selector === 'button') return [];
    if (selector === 'div, span, p') return [];
    return [];
  }
};
assert.equal(core.conversationLimitButton(limitedDocument), newChatButton);
assert.deepEqual(core.pageSignal(limitedDocument), {
  code: 'conversation-limit', action: 'new-chat', element: newChatButton
});
console.log('Conversación: límite detectado y transición a chat nuevo clasificada');

const englishNewChatButton = {
  disabled: false,
  innerText: 'Start new chat',
  textContent: 'Start new chat',
  getAttribute() { return null; },
  closest() {
    return {
      hidden: false,
      innerText: 'You reached the maximum length for this conversation. Start a new chat to continue. Start new chat',
      textContent: this.innerText,
      getAttribute() { return null; }
    };
  }
};
const englishLimitedDocument = {
  querySelector() { return null; },
  querySelectorAll(selector) {
    if (selector === 'button, a') return [englishNewChatButton];
    if (selector === 'button' || selector === 'div, span, p') return [];
    return [];
  }
};
assert.deepEqual(core.pageSignal(englishLimitedDocument), {
  code: 'conversation-limit', action: 'new-chat', element: englishNewChatButton
});
console.log('Conversación: alerta en inglés también abre un chat nuevo');

const ordinaryNewChatButton = {
  disabled: false,
  innerText: 'Start new chat',
  textContent: 'Start new chat',
  getAttribute() { return null; },
  closest() { return null; }
};
const ordinaryChatDocument = {
  querySelector() { return null; },
  querySelectorAll(selector) {
    if (selector === 'button, a') return [ordinaryNewChatButton];
    if (selector === 'button' || selector === 'div, span, p') return [];
    return [];
  }
};
assert.equal(core.conversationLimitButton(ordinaryChatDocument), null);
assert.notEqual(core.pageSignal(ordinaryChatDocument).code, 'conversation-limit');
console.log('Conversación: el botón global New chat no dispara una transferencia');

const modernComposer = { id: 'modern-composer' };
const modernDocument = {
  location: { pathname: '/' },
  querySelector(selector) {
    return selector === '[contenteditable="true"][role="textbox"]' ? modernComposer : null;
  },
  querySelectorAll(selector) {
    if (selector === '[contenteditable="true"]' || selector === '[role="textbox"]') return [modernComposer];
    return [];
  }
};
assert.equal(core.composer(modernDocument), modernComposer);
assert.deepEqual(core.pageSignal(modernDocument), { code: 'ready', action: 'continue' });
assert.deepEqual(core.interfaceSnapshot(modernDocument), {
  path: '/', textareas: 0, editable: 1, textboxes: 1, forms: 0
});
console.log('Interfaz: compositor contenteditable moderno reconocido en chat nuevo');

const modernSendDocument = new JSDOM(
  '<form><textarea placeholder="ChatGPT"></textarea>' +
  '<button type="submit" aria-label="Send prompt">Send</button></form>'
).window.document;
const modernSendButton = modernSendDocument.querySelector('button');
assert.equal(core.sendButton(modernSendDocument), modernSendButton);
assert.equal(core.canSend(modernSendButton), true);
const missingComposerDoc = new JSDOM(
  '<button aria-label="Send prompt">Send</button>'
).window.document;
assert.equal(core.sendButton(missingComposerDoc), null);
const incompleteAdapter = {
  querySelector(selector) {
    return selector === 'button[aria-label="Send prompt"]'
      ? modernSendButton : null;
  }
};
assert.equal(core.sendButton(incompleteAdapter), null);
console.log('Envío: control Send prompt con compositor real; sin compositor falla cerrado');
