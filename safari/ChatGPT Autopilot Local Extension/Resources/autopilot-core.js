(function (root, factory) {
  function recoverableState(raw) {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      if (error instanceof SyntaxError) return {};
      throw error;
    }
  }

  const api = factory(recoverableState);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (recoverableState) {
  'use strict';

  const COMPOSER_SELECTORS = [
    '#prompt-textarea',
    '[data-testid="composer-text-input"]',
    'textarea[placeholder*="ChatGPT"]',
    'textarea[aria-label*="ChatGPT"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][data-placeholder*="ChatGPT"]',
    '[contenteditable="true"][aria-label*="ChatGPT"]',
    'form textarea',
    'form [contenteditable="true"]'
  ];
  const SEND_SELECTORS = [
    '#composer-submit-button',
    'button[data-testid="send-button"]',
    'button[data-testid*="send"]',
    'button[aria-label="Enviar mensaje"]',
    'button[aria-label="Send message"]',
    'button[aria-label="Send prompt"]',
    'button[aria-label="Enviar prompt"]',
    'button[aria-label="Enviar"]',
    'button[type="submit"]'
  ];
  const STOP_SELECTORS = [
    'button[data-testid="stop-button"]',
    'button[data-testid*="stop"]',
    'button[aria-label="Stop"]',
    'button[aria-label="Detener"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="Detener transmisión"]',
    'button[aria-label="Detener generación"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Detener respuesta"]',
    'button[aria-label="Stop answering"]'
  ];

  function first(doc, selectors) {
    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      if (element) return element;
    }
    return null;
  }

  function composer(doc = document) { return first(doc, COMPOSER_SELECTORS); }
  function interfaceSnapshot(doc = document) {
    return {
      path: doc.location?.pathname || '',
      textareas: doc.querySelectorAll('textarea').length,
      editable: doc.querySelectorAll('[contenteditable="true"]').length,
      textboxes: doc.querySelectorAll('[role="textbox"]').length,
      forms: doc.querySelectorAll('form').length
    };
  }
  function sendButton(doc = document) {
    const direct = first(doc, SEND_SELECTORS);
    if (direct) return direct;
    const field = composer(doc);
    const scope = field?.closest?.('form') || field?.parentElement?.parentElement;
    if (!scope?.querySelectorAll) return null;
    return [...scope.querySelectorAll('button')].find(button => {
      const label = normalize([
        button.getAttribute('aria-label'), button.getAttribute('data-testid'),
        button.getAttribute('title')
      ].filter(Boolean).join(' ')).toLowerCase();
      return /(^|\s)(send|enviar)(\s|$|-)/.test(label)
        && !/stop|detener|voice|voz|dictate|dictado/.test(label);
    }) || null;
  }
  function sendControlSnapshot(doc = document) {
    const field = composer(doc);
    const scope = field?.closest?.('form') || field?.parentElement?.parentElement || doc;
    return [...scope.querySelectorAll('button')].slice(-12).map(button => ({
      ariaLabel: normalize(button.getAttribute('aria-label')).slice(0, 80),
      testId: normalize(button.getAttribute('data-testid')).slice(0, 80),
      title: normalize(button.getAttribute('title')).slice(0, 80),
      type: normalize(button.getAttribute('type')).slice(0, 20),
      disabled: Boolean(button.disabled || button.getAttribute('aria-disabled') === 'true')
    }));
  }
  function stopButton(doc = document) {
    for (const selector of STOP_SELECTORS) {
      const candidates = doc.querySelectorAll
        ? [...doc.querySelectorAll(selector)]
        : [doc.querySelector?.(selector)].filter(Boolean);
      for (const element of candidates) {
        if (element.id === 'chatgpt-autopilot-stop'
            || element.closest?.('#chatgpt-autopilot-badge')) continue;
        if (element.hidden || element.disabled
            || element.getAttribute?.('aria-hidden') === 'true') continue;
        const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) continue;
        if (typeof element.checkVisibility === 'function'
            && !element.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) continue;
        return element;
      }
    }
    return null;
  }
  function isPageVisible(doc = document) { return doc.visibilityState === 'visible'; }
  function assistantMessageCount(doc = document) {
    return doc.querySelectorAll('[data-message-author-role="assistant"]').length;
  }
  function userMessageCount(doc = document) {
    return doc.querySelectorAll('[data-message-author-role="user"]').length;
  }
  function lastUserMessageText(doc = document) {
    const messages = doc.querySelectorAll('[data-message-author-role="user"]');
    const last = messages[messages.length - 1];
    return normalize(last?.innerText || last?.textContent);
  }
  function recoveryButton(doc = document) {
    const allowed = new Set([
      'reintentar', 'retry', 'regenerar', 'regenerate',
      'continuar generando', 'continue generating'
    ]);
    for (const button of doc.querySelectorAll('button')) {
      const label = normalize(button.innerText || button.textContent || button.getAttribute('aria-label'));
      if (!button.disabled && allowed.has(label.toLowerCase())) return button;
    }
    return null;
  }
  function buttonWithText(doc, labels) {
    const allowed = new Set(labels.map(value => value.toLowerCase()));
    for (const element of doc.querySelectorAll('button, a')) {
      const label = normalize(element.innerText || element.textContent || element.getAttribute('aria-label'));
      if (allowed.has(label.toLowerCase())) return element;
    }
    return null;
  }
  function conversationLimitButton(doc = document) {
    const allowed = new Set([
      'iniciar nuevo chat', 'start new chat',
      'comenzar un nuevo chat', 'start a new chat'
    ]);
    const limitPattern = /(?:duraci[oó]n m[aá]xima|m[aá]xima duraci[oó]n|maximum (?:length|duration)|conversation.{0,80}(?:reached|alcanz).{0,80}(?:limit|m[aá]xim)|l[ií]mite.{0,80}conversaci[oó]n)/i;
    for (const element of doc.querySelectorAll('button, a')) {
      const label = normalize(element.innerText || element.textContent || element.getAttribute('aria-label'));
      if (element.disabled || !allowed.has(label.toLowerCase())) continue;
      const region = element.closest?.('[role="alert"], [role="status"], [aria-live]');
      if (!region || !activeReviewRegion(region, doc)) continue;
      const regionText = normalize(region.innerText || region.textContent);
      if (regionText.length <= 700 && limitPattern.test(regionText)) return element;
    }
    return null;
  }
  function interruptedConnection(doc) {
    const pattern = /(?:conexi[oó]n interrumpida|connection interrupted|network interrupted)(?:\.|\s|$)/i;
    return documentTextMatches(doc, pattern, 180);
  }
  function connectionRecoveryAction({ generating = false, cancelRequested = false } = {}) {
    if (generating && !cancelRequested) return 'cancel-generation';
    return 'wait';
  }
  function documentTextMatches(doc, pattern, maximumLength = 300) {
    const root = doc.body || doc.documentElement;
    const showText = doc.defaultView?.NodeFilter?.SHOW_TEXT
      || globalThis.NodeFilter?.SHOW_TEXT || 4;
    if (!root || !doc.createTreeWalker) {
      for (const element of doc.querySelectorAll?.('div, span, p') || []) {
        const text = normalize(element.innerText || element.textContent);
        if (text && text.length <= maximumLength && pattern.test(text)) return true;
      }
      return false;
    }
    const walker = doc.createTreeWalker(root, showText);
    let node = walker.nextNode();
    while (node) {
      const text = normalize(node.nodeValue);
      if (text && text.length <= maximumLength && pattern.test(text)) return true;
      node = walker.nextNode();
    }
    return false;
  }
  const PLATFORM_REVIEW_PATTERN = /(?:comprobaciones adicionales antes de responder|additional checks before responding|additional safety check|(?:nuestros sistemas|our systems|systems?).{0,120}(?:procesando|processing|revisando|reviewing|comprobando|checking).{0,160}(?:esta\s+|this\s+)?(?:solicitud|request).{0,160}(?:antes de responder|before (?:responding|providing a response)))/i;
  function platformReviewText(value) {
    const text = normalize(value);
    return Boolean(text && text.length <= 520 && PLATFORM_REVIEW_PATTERN.test(text));
  }
  function activeReviewRegion(region, doc = document) {
    if (!region || region.hidden || region.getAttribute?.('aria-hidden') === 'true') return false;
    const style = doc.defaultView?.getComputedStyle?.(region);
    return !style || (style.display !== 'none' && style.visibility !== 'hidden');
  }
  function platformReview(doc = document) {
    const assistantMessages = doc.querySelectorAll?.('[data-message-author-role="assistant"]') || [];
    if (assistantMessages.length) {
      const latest = assistantMessages[assistantMessages.length - 1];
      if (platformReviewText(latest.innerText || latest.textContent)) return true;
    }
    const liveRegions = doc.querySelectorAll?.('[role="status"], [role="alert"], [aria-live]') || [];
    for (const region of liveRegions) {
      if (region.closest?.('[data-message-author-role="assistant"]')) continue;
      if (!activeReviewRegion(region, doc)) continue;
      if (platformReviewText(region.innerText || region.textContent)) return true;
    }
    if (assistantMessages.length || liveRegions.length) return false;
    return documentTextMatches(doc, PLATFORM_REVIEW_PATTERN, 520);
  }
  function additionalSafetyCheck(doc = document) {
    return platformReview(doc);
  }
  const RATE_LIMIT_PATTERN = /rate limit|too many requests|límite de (uso|mensajes)|try again later/i;

  function providerAlerts(doc = document) {
    return [...doc.querySelectorAll('[role="alert"], [data-testid*="error"]')]
      .map(element => normalize(element.innerText || element.textContent))
      .filter(Boolean);
  }

  function isSafeRecoverySignal(signal) {
    return Boolean(signal && signal.code === 'recoverable' && signal.action === 'click-recovery' && signal.element);
  }
  function recoverableEscalation(attempts) {
    const count = Math.max(0, Number(attempts) || 0);
    if (count <= 2) return 'retry';
    if (count === 3) return 'reload';
    return 'new-chat';
  }
  function pageSignal(doc = document) {
    if (platformReview(doc)) return { code: 'platform-review', action: 'wait' };
    const recovery = recoveryButton(doc);
    if (recovery) return { code: 'recoverable', action: 'click-recovery', element: recovery };
    const newChat = conversationLimitButton(doc);
    if (newChat) return { code: 'conversation-limit', action: 'new-chat', element: newChat };
    if (!composer(doc) && buttonWithText(doc, ['Iniciar sesión', 'Log in', 'Sign in'])) {
      return { code: 'authentication', action: 'human' };
    }
    const alerts = providerAlerts(doc).join(' ').toLowerCase();
    if (RATE_LIMIT_PATTERN.test(alerts)) {
      return { code: 'rate-limit', action: 'wait' };
    }
    if (interruptedConnection(doc)
        || /network|connection|conexión|offline|something went wrong|algo salió mal/.test(alerts)) {
      return { code: 'connection', action: 'reload' };
    }
    if (!composer(doc)) return { code: 'interface-missing', action: 'reload' };
    return { code: 'ready', action: 'continue' };
  }
  function providerAccountSignal(doc = document) {
    const signal = pageSignal(doc);
    let alertText = null;
    if (signal.code === 'rate-limit') {
      const matchingAlert = providerAlerts(doc).find(text => RATE_LIMIT_PATTERN.test(text));
      alertText = typeof matchingAlert === 'string' ? matchingAlert.slice(0, 500) : null;
    }
    return Object.freeze({ signalCode: signal.code, alertText });
  }
  function budgetWaitLabel(nextAllowedAt, now = Date.now()) {
    if (Number.isSafeInteger(nextAllowedAt) && nextAllowedAt > now) {
      return `Presupuesto compartido: esperando ${Math.max(1, Math.ceil((nextAllowedAt - now) / 1000))} s`;
    }
    return 'Verificando presupuesto compartido';
  }
  function normalize(value) {
    return String(value || '').replaceAll('\u00a0', ' ').replaceAll('\r\n', '\n').trim();
  }
  function reasoningLevelFromText(value) {
    const text = normalize(value).toLowerCase();
    if (/(^|\s)(alta|alto|high)(\s|$)/.test(text)) return 'high';
    if (/(^|\s)(media|medio|medium)(\s|$)/.test(text)) return 'medium';
    if (/(^|\s)(baja|bajo|low)(\s|$)/.test(text)) return 'low';
    return '';
  }
  function reasoningSliderTarget(level, minimum, maximum) {
    const min = Number(minimum);
    const max = Number(maximum);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null;
    if (level === 'high') return max;
    if (level === 'low') return min;
    if (level === 'medium') return Math.round((min + max) / 2);
    return null;
  }
  function reasoningSliderControl(slider) {
    return slider?.closest?.('[data-reasoning-slider="true"], [aria-keyshortcuts*="ArrowRight"]') || slider || null;
  }
  function composerText(element) {
    if (!element) return '';
    return normalize('value' in element ? element.value : element.innerText || element.textContent);
  }
  function isOwnedDraft(element, prompt) {
    const current = composerText(element);
    return Boolean(current && current === normalize(prompt));
  }

  function replaceComposerText(element, text, doc = document) {
    if (!element) return false;
    element.focus();
    if ('value' in element) {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(element), 'value'
      )?.set;
      if (setter) setter.call(element, text);
      else element.value = text;
    } else {
      const selection = doc.getSelection?.();
      if (selection && doc.createRange) {
        const range = doc.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      const inserted = typeof doc.execCommand === 'function'
        && doc.execCommand('insertText', false, text);
      if (!inserted) element.textContent = text;
    }
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text
    }));
    return composerText(element) === normalize(text);
  }

  function canSend(button) {
    return Boolean(button && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
  }

  return {
    COMPOSER_SELECTORS,
    SEND_SELECTORS,
    STOP_SELECTORS,
    composer,
    interfaceSnapshot,
    sendButton,
    sendControlSnapshot,
    stopButton,
    isPageVisible,
    assistantMessageCount,
    userMessageCount,
    lastUserMessageText,
    recoveryButton,
    conversationLimitButton,
    interruptedConnection,
    connectionRecoveryAction,
    platformReview,
    additionalSafetyCheck,
    isSafeRecoverySignal,
    recoverableEscalation,
    recoverableState,
    pageSignal,
    providerAccountSignal,
    normalize,
    reasoningLevelFromText,
    reasoningSliderTarget,
    reasoningSliderControl,
    composerText,
    isOwnedDraft,
    replaceComposerText,
    budgetWaitLabel,
    canSend
  };
});
