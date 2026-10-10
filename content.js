(function () {
  'use strict';
  const core = globalThis.ChatGPTAutopilotCore;
  const learning = globalThis.ChatGPTAutopilotLearning;
  const reliability = globalThis.ChatGPTAutopilotReliability;
  const adaptiveRecovery = globalThis.ChatGPTAutopilotAdaptiveRecovery;
  const extensionApi = globalThis.chrome || globalThis.browser;
  const budgetGuard = globalThis.ChatGPTAutopilotBudgetGuard;
  const DEFAULT_PROMPT = 'Continúa autónomamente el desarrollo del proyecto desde el estado real más reciente. Antes de modificar nada: inspecciona el estado actual del repo, rama, issues, PRs, CI y revisiones. No te detengas después de cada paso; avanza mientras sea seguro, sin duplicar trabajo, y reporta solo hitos grandes.';
  const PROMPT_SCHEMA_VERSION = 2;
  const SCROLL_DEFAULTS = Object.freeze({
    followScroll: true,
    scrollStepMin: 90,
    scrollStepMax: 320,
    scrollPollMs: 220,
    scrollStableChecks: 8,
    scrollMaxSeconds: 45,
    manualScrollPauseSeconds: 20,
    platformReviewMaxSeconds: 180,
    autoReload: true,
    reloadCooldownMinutes: 1,
    periodicReload: true,
    periodicReloadMinutes: 15,
    modelTarget: 'gpt-6',
    reasoningLevel: 'high',
    conversationMode: 'chat'
  });
  const restored = reliability.load(sessionStorage);
  const RECOVERABLE_STATE_KEY = 'chatgpt-autopilot-recoverable-state';
  const CONVERSATION_TRANSFER_KEY = 'chatgpt-autopilot-conversation-transfer-at';
  const CONVERSATION_TRANSFER_COOLDOWN_MS = 10 * 60 * 1000;
  const runtimeSchemaVersion = 4;
  const runtimeWasUpgraded = sessionStorage.getItem('chatgpt-autopilot-runtime-schema') !== String(runtimeSchemaVersion);
  if (runtimeWasUpgraded) {
    restored.consecutiveFailures = 0;
    restored.circuitOpenUntil = 0;
    restored.reloadAttempts = 0;
    restored.reloadWindowStartedAt = 0;
    reliability.save(sessionStorage, restored);
    sessionStorage.setItem('chatgpt-autopilot-runtime-schema', String(runtimeSchemaVersion));
    sessionStorage.removeItem('chatgpt-autopilot-last-reload');
    sessionStorage.removeItem(RECOVERABLE_STATE_KEY);
  }
  const state = {
    enabled: false,
    waiting: false,
    sawGeneration: false,
    lastSentAt: restored.lastSentAt,
    assistantCountBeforeSend: restored.assistantCountBeforeSend,
    lastRecoveryAt: 0,
    generationStartedAt: 0,
    lastRecovery: null,
    lastErrorCode: '',
    lastErrorAt: 0,
    lastReloadAt: runtimeWasUpgraded ? 0 : Number(sessionStorage.getItem('chatgpt-autopilot-last-reload')) || 0,
    lastPeriodicReloadAt: Number(sessionStorage.getItem('chatgpt-autopilot-last-periodic-reload')) || Date.now(),
    contentLoadedAt: Date.now(),
    connectionFirstSeenAt: 0,
    connectionCancelAt: 0,
    conversationTransferAt: Number(sessionStorage.getItem(CONVERSATION_TRANSFER_KEY)) || 0,
    platformReviewStartedAt: 0,
    platformReviewEscalated: false,
    platformReviewPlaceholderSeen: false,
    learned: learning.normalize(),
    nextSendAt: 0,
    busy: false,
    status: 'Pausado',
    manualScrollUntil: 0,
    lastAutoScrollAt: 0,
    autoScrolling: false,
    autoScrollRun: 0,
    lastReasoningCheckAt: 0,
    lastReasoningUnavailableLogAt: 0,
    lastModelCheckAt: 0,
    lastModelUnavailableLogAt: 0,
    lastConversationModeKey: '',
    settings: { ...SCROLL_DEFAULTS },
    pendingSignature: restored.pendingSignature,
    consecutiveFailures: restored.consecutiveFailures,
    circuitOpenUntil: restored.circuitOpenUntil,
    reloadAttempts: restored.reloadAttempts,
    reloadWindowStartedAt: restored.reloadWindowStartedAt
  };
  let cachedConfigPromise = null;

  function log(event, details = {}) {
    try {
      const result = extensionApi.runtime.sendMessage({
        type: 'autopilot:log', event, details
      });
      if (result?.catch) result.catch(() => {});
    } catch (_error) {}
  }

  function noteManualScroll(event) {
    if (event && event.isTrusted === false) return;
    if (!state.enabled) return;
    state.manualScrollUntil = Date.now()
      + state.settings.manualScrollPauseSeconds * 1000;
    state.autoScrollRun += 1;
  }

  function scrollableContainers(target) {
    const found = [];
    const add = element => {
      if (!element || found.includes(element)) return;
      if (element.scrollHeight > element.clientHeight + 4) found.push(element);
    };
    let current = target?.parentElement || null;
    while (current && current !== document.documentElement) {
      const style = getComputedStyle(current);
      const overflowY = style.overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll')
          && current.scrollHeight > current.clientHeight + 4) add(current);
      current = current.parentElement;
    }
    document.querySelectorAll(
      'main, [role="main"], [data-scroll-root], [class*="overflow-y-auto"], [class*="overflow-y-scroll"]'
    ).forEach(add);
    add(document.scrollingElement || document.documentElement);
    return found.sort((left, right) => {
      const leftContains = target && left.contains(target) ? 1 : 0;
      const rightContains = target && right.contains(target) ? 1 : 0;
      return rightContains - leftContains;
    });
  }

  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  async function naturalScrollToLatest() {
    if (state.autoScrolling) return;
    state.autoScrolling = true;
    const run = ++state.autoScrollRun;
    const options = state.settings;
    const deadline = Date.now() + options.scrollMaxSeconds * 1000;
    let stableChecks = 0;
    let previousSignature = '';
    try {
      while (state.enabled && run === state.autoScrollRun && Date.now() < deadline) {
        if (Date.now() < state.manualScrollUntil) break;
        const messages = document.querySelectorAll('[data-message-author-role]');
        const target = messages[messages.length - 1] || core.composer(document);
        const containers = scrollableContainers(target);
        if (!containers.length) break;
        let moved = false;
        for (const container of containers) {
          const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
          const remaining = maximum - container.scrollTop;
          if (remaining <= 1) continue;
          const step = Math.min(options.scrollStepMax,
            Math.max(options.scrollStepMin, remaining * 0.24));
          container.dispatchEvent(new WheelEvent('wheel', {
            deltaY: step, deltaMode: WheelEvent.DOM_DELTA_PIXEL, bubbles: true
          }));
          container.scrollTop = Math.min(maximum, container.scrollTop + step);
          moved = true;
        }
        const targetBottom = target?.getBoundingClientRect?.().bottom || 0;
        const visibleBottom = window.innerHeight - 130;
        if (targetBottom > visibleBottom) {
          window.scrollBy(0, Math.min(options.scrollStepMax,
            Math.max(options.scrollStepMin, targetBottom - visibleBottom)));
          moved = true;
        }
        if (moved) {
          stableChecks = 0;
          state.lastAutoScrollAt = Date.now();
          await nextFrame();
          continue;
        }
        await wait(options.scrollPollMs);
        const signature = containers.map(container => [
          Math.round(container.scrollHeight), Math.round(container.clientHeight),
          Math.round(container.scrollTop)
        ].join(':')).join('|') + `|${Math.round(target?.getBoundingClientRect?.().bottom || 0)}`;
        stableChecks = signature === previousSignature ? stableChecks + 1 : 0;
        previousSignature = signature;
        if (stableChecks >= options.scrollStableChecks) break;
      }
    } finally {
      state.autoScrolling = false;
    }
  }

  function followLatest(force = false) {
    if (!state.enabled || !state.settings.followScroll) return;
    if (!force && Date.now() < state.manualScrollUntil) return;
    if (!force && Date.now() - state.lastAutoScrollAt < 700) return;
    naturalScrollToLatest().catch(error => {
      log('scroll-failure', { message: String(error?.message || error) });
    });
  }

  function setStatus(text, kind = 'idle') {
    const changed = state.status !== text;
    state.status = text;
    let badge = document.getElementById('chatgpt-autopilot-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'chatgpt-autopilot-badge';
      Object.assign(badge.style, {
        position: 'fixed', left: '12px', bottom: '12px', zIndex: '2147483647',
        display: 'flex', alignItems: 'center', gap: '9px', padding: '7px 8px 7px 11px',
        borderRadius: '8px', font: '600 11px system-ui', pointerEvents: 'auto',
        boxShadow: '0 4px 18px #0005'
      });
      const summary = document.createElement('span');
      Object.assign(summary.style, { display: 'flex', flexDirection: 'column', gap: '2px' });
      const label = document.createElement('span');
      label.id = 'chatgpt-autopilot-status-text';
      const metrics = document.createElement('span');
      metrics.id = 'chatgpt-autopilot-metrics';
      Object.assign(metrics.style, { fontSize: '9px', opacity: '.78', letterSpacing: '.04em' });
      const stop = document.createElement('button');
      stop.id = 'chatgpt-autopilot-stop';
      stop.type = 'button';
      stop.textContent = 'STOP';
      stop.title = 'Detener Autopilot en todas las pestañas';
      Object.assign(stop.style, {
        appearance: 'none', border: '1px solid #ffffff66', borderRadius: '6px',
        background: '#111827', color: '#fff', padding: '5px 9px', cursor: 'pointer',
        font: '800 10px system-ui', lineHeight: '1'
      });
      stop.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        extensionApi.storage.local.set({ masterEnabled: false });
        log('front-stop', { source: 'status-badge' });
        setEnabled(false);
      });
      summary.append(label, metrics);
      badge.append(summary, stop);
      document.documentElement.appendChild(badge);
    }
    const label = badge.querySelector('#chatgpt-autopilot-status-text');
    const metrics = badge.querySelector('#chatgpt-autopilot-metrics');
    const stop = badge.querySelector('#chatgpt-autopilot-stop');
    const labelText = `AUTOPILOT · ${text}`;
    if (label && label.textContent !== labelText) label.textContent = labelText;
    if (metrics) {
      const uptimeMinutes = Math.max(0, Math.floor((Date.now() - state.contentLoadedAt) / 60000));
      const refreshMinutes = state.settings.periodicReload
        ? Math.max(0, Math.ceil((state.lastPeriodicReloadAt + state.settings.periodicReloadMinutes * 60000 - Date.now()) / 60000))
        : null;
      metrics.textContent = `CYC ${state.learned.cycles || 0} · REC ${state.learned.recoveries || 0} · ERR ${state.learned.failures || 0} · UP ${uptimeMinutes}m${refreshMinutes === null ? '' : ` · REF ${refreshMinutes}m`}`;
    }
    if (stop) stop.style.display = state.enabled ? 'inline-block' : 'none';
    badge.style.background = kind === 'error' ? '#7f1d1d' : state.enabled ? '#166534' : '#374151';
    badge.style.color = '#fff';
    badge.style.display = state.enabled || kind === 'error' ? 'flex' : 'none';
    if (changed) log('status', { status: text, kind, enabled: state.enabled });
  }

  function config() {
    if (cachedConfigPromise) return cachedConfigPromise;
    const defaults = {
      prompt: DEFAULT_PROMPT, promptSchemaVersion: PROMPT_SCHEMA_VERSION,
      delaySeconds: 15, learning: learning.EMPTY, sharedLearning: null, ...SCROLL_DEFAULTS
    };
    cachedConfigPromise = new Promise((resolve, reject) => {
      try {
        const result = extensionApi.storage.local.get(defaults, resolve);
        if (result?.then) result.then(resolve, reject);
      } catch (error) { reject(error); }
    }).then(values => {
      const prompt = core.normalize(values.prompt);
      let selectedPrompt = prompt;
      if (values.promptSchemaVersion !== PROMPT_SCHEMA_VERSION || prompt.length === 0) {
        extensionApi.storage.local.set({
          prompt: DEFAULT_PROMPT,
          promptSchemaVersion: PROMPT_SCHEMA_VERSION
        });
        selectedPrompt = DEFAULT_PROMPT;
      }
      return {
        ...values, prompt: selectedPrompt,
        followScroll: values.followScroll !== false,
        scrollStepMin: Math.max(30, Math.min(500, Number(values.scrollStepMin) || SCROLL_DEFAULTS.scrollStepMin)),
        scrollStepMax: Math.max(60, Math.min(900, Number(values.scrollStepMax) || SCROLL_DEFAULTS.scrollStepMax)),
        scrollPollMs: Math.max(80, Math.min(2000, Number(values.scrollPollMs) || SCROLL_DEFAULTS.scrollPollMs)),
        scrollStableChecks: Math.max(2, Math.min(30, Number(values.scrollStableChecks) || SCROLL_DEFAULTS.scrollStableChecks)),
        scrollMaxSeconds: Math.max(5, Math.min(180, Number(values.scrollMaxSeconds) || SCROLL_DEFAULTS.scrollMaxSeconds)),
        manualScrollPauseSeconds: Math.max(0, Math.min(300,
          Number.isFinite(Number(values.manualScrollPauseSeconds))
            ? Number(values.manualScrollPauseSeconds) : SCROLL_DEFAULTS.manualScrollPauseSeconds)),
        platformReviewMaxSeconds: Math.max(30, Math.min(1800,
          Number(values.platformReviewMaxSeconds) || SCROLL_DEFAULTS.platformReviewMaxSeconds)),
        autoReload: values.autoReload !== false,
        reloadCooldownMinutes: Math.max(1, Math.min(60, Number(values.reloadCooldownMinutes) || SCROLL_DEFAULTS.reloadCooldownMinutes)),
        periodicReload: values.periodicReload === true,
        periodicReloadMinutes: Math.max(5, Math.min(1440,
          Number(values.periodicReloadMinutes) || SCROLL_DEFAULTS.periodicReloadMinutes)),
        modelTarget: ['keep', 'gpt-6', 'gpt-5.6-sol'].includes(values.modelTarget)
          ? values.modelTarget : SCROLL_DEFAULTS.modelTarget,
        reasoningLevel: ['keep', 'high'].includes(values.reasoningLevel)
          ? values.reasoningLevel : SCROLL_DEFAULTS.reasoningLevel,
        conversationMode: ['chat', 'work'].includes(values.conversationMode)
          ? values.conversationMode : SCROLL_DEFAULTS.conversationMode
      };
    });
    cachedConfigPromise.catch(() => { cachedConfigPromise = null; });
    return cachedConfigPromise;
  }

  async function acquireRecoveryIncident(problemCode, replacement = false) {
    try {
      const route = location.pathname.startsWith('/c/') ? '/c/:id' : '/';
      const result = await extensionApi.runtime.sendMessage({
        type: 'autopilot:incident-acquire', problemCode, route, replacement
      });
      return result?.granted ? result : null;
    } catch (_error) { return null; }
  }

  function saveLearning(event, durationMs = 0, detail = {}) {
    state.learned = learning.update(state.learned, event, durationMs, detail);
    try {
      const result = extensionApi.runtime.sendMessage({
        type: 'autopilot:learning-event', event, durationMs, detail
      });
      if (result?.then) result.then(response => {
        if (response?.learning) state.learned = learning.normalize(response.learning);
      }).catch(() => {});
    } catch (_error) {}
  }

  function lastAssistantReplyFingerprint() {
    const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
    const last = messages[messages.length - 1];
    const text = core.normalize(last?.innerText || last?.textContent);
    if (!text) return '';
    const parts = reliability.signature(text).split(':');
    const hash = String(parts[1] || '').toLowerCase();
    return /^[0-9a-f]{1,8}$/.test(hash) ? hash.padStart(8, '0') : '';
  }

  function runtimeSnapshot() {
    return {
      pendingSignature: state.pendingSignature,
      assistantCountBeforeSend: state.assistantCountBeforeSend,
      lastSentAt: state.lastSentAt,
      consecutiveFailures: state.consecutiveFailures,
      circuitOpenUntil: state.circuitOpenUntil,
      reloadAttempts: state.reloadAttempts,
      reloadWindowStartedAt: state.reloadWindowStartedAt
    };
  }

  function persistRuntime() { reliability.save(sessionStorage, runtimeSnapshot()); }

  function waitForUserMessage(prompt, beforeCount, timeoutMs = 8000) {
    const expected = reliability.signature(prompt);
    const started = Date.now();
    return new Promise(resolve => {
      const check = () => {
        const appeared = core.userMessageCount(document) > beforeCount;
        const exact = reliability.signature(core.lastUserMessageText(document)) === expected;
        if (appeared && exact) return resolve(true);
        if (Date.now() - started >= timeoutMs) return resolve(false);
        setTimeout(check, 120);
      };
      check();
    });
  }

  function waitForGenerationStart(timeoutMs = 8000) {
    const started = Date.now();
    return new Promise(resolve => {
      const check = () => {
        if (core.stopButton(document)) return resolve(true);
        if (Date.now() - started >= timeoutMs) return resolve(false);
        setTimeout(check, 120);
      };
      check();
    });
  }

  function recordErrorOnce(signal, minimumIntervalMs = 60000) {
    if (state.lastErrorCode === signal.code
        && Date.now() - state.lastErrorAt < minimumIntervalMs) return;
    state.lastErrorCode = signal.code;
    state.lastErrorAt = Date.now();
    saveLearning('error', 0, signal);
  }

  async function openFreshConversation(button) {
    if (button?.click) {
      button.click();
      return true;
    }
    const newChatLink = [...document.querySelectorAll('a[href]')].find(link => {
      const href = link.getAttribute('href');
      const label = core.normalize(link.getAttribute('aria-label') || link.textContent || '');
      return (href === '/' || href === 'https://chatgpt.com/')
        && /nuevo chat|new chat/.test(label.toLowerCase());
    });
    if (newChatLink) {
      newChatLink.click();
      return true;
    }
    location.assign('https://chatgpt.com/');
    return true;
  }

  function modelSelectorButton() {
    return [...document.querySelectorAll('button,[role="button"]')].find(element => {
      const label = core.normalize([
        element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent
      ].filter(Boolean).join(' ')).toLowerCase();
      const testId = (element.getAttribute('data-testid') || '').toLowerCase();
      return /select chatgpt model|seleccionar modelo|cambiar modelo/.test(label)
        || Boolean(core.modelIdFromText(label))
        || /model.*selector|selector.*model/.test(testId);
    }) || null;
  }

  function modelOption(target) {
    return [...document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"],button')]
      .find(element => core.modelIdFromText(
        element.textContent || element.getAttribute('aria-label') || ''
      ) === target) || null;
  }

  async function ensureModel(target) {
    if (target === 'keep') return 'preserved';
    if (Date.now() - state.lastModelCheckAt < 5000) return 'recently-checked';
    state.lastModelCheckAt = Date.now();
    let selector = null;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      selector = modelSelectorButton();
      if (selector) break;
      await wait(100);
    }
    if (!selector) {
      if (Date.now() - state.lastModelUnavailableLogAt >= 300000) {
        state.lastModelUnavailableLogAt = Date.now();
        log('model', { requested: target, result: 'selector-missing', fallback: 'preserve-current' });
      }
      return 'unavailable';
    }
    if (core.modelIdFromText(controlText(selector)) === target) return 'confirmed';
    selector.click();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(100);
      const option = modelOption(target);
      if (!option) continue;
      const selected = option.getAttribute('aria-checked') === 'true'
        || option.getAttribute('aria-selected') === 'true'
        || option.dataset?.state === 'checked';
      if (!selected) option.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(600);
      log('model', { requested: target, result: selected ? 'already-selected' : 'selected' });
      return 'confirmed';
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (Date.now() - state.lastModelUnavailableLogAt >= 300000) {
      state.lastModelUnavailableLogAt = Date.now();
      log('model', { requested: target, result: 'option-missing', fallback: 'preserve-current' });
    }
    return 'unavailable';
  }

  function controlText(element) {
    return core.normalize([
      element?.getAttribute?.('aria-label'), element?.getAttribute?.('title'),
      element?.getAttribute?.('data-testid'), element?.textContent
    ].filter(Boolean).join(' ')).toLowerCase();
  }

  function highOption() {
    return [...document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"],button')]
      .find(element => /^(alta|alto|high)(\s|$)/i.test(core.normalize(
        element.textContent || element.getAttribute('aria-label') || '')));
  }

  function thinkingOption() {
    return [...document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="option"],button')]
      .find(element => /^(pensando|thinking)(\s|$)/i.test(core.normalize(
        element.textContent || element.getAttribute('aria-label') || '')));
  }

  function reasoningSelectorButton() {
    const candidates = [...document.querySelectorAll('button,[role="button"]')];
    return candidates.find(element => Boolean(core.reasoningLevelFromText(controlText(element))))
      || candidates.find(element => /reasoning|effort|thinking.*(level|time)|nivel.*razonamiento/.test(controlText(element)))
      || null;
  }

  async function setReasoningSlider(level) {
    const slider = document.querySelector('[role="slider"][aria-valuemin][aria-valuemax]');
    if (!slider) return false;
    const target = core.reasoningSliderTarget(
      level, slider.getAttribute('aria-valuemin'), slider.getAttribute('aria-valuemax')
    );
    if (target === null) return false;
    let current = Number(slider.getAttribute('aria-valuenow'));
    if (current === target) return true;
    const control = core.reasoningSliderControl(slider);
    control.focus();
    const key = current < target ? 'ArrowRight' : 'ArrowLeft';
    for (let attempt = 0; attempt < 4 && current !== target; attempt += 1) {
      control.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
      control.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }));
      await wait(150);
      current = Number(slider.getAttribute('aria-valuenow'));
    }
    return current === target;
  }

  async function ensureConversationMode(mode) {
    const desiredMode = mode === 'work' ? 'work' : 'chat';
    const modeKey = `${location.pathname}:${desiredMode}`;
    if (state.lastConversationModeKey === modeKey) return true;
    const candidates = [...document.querySelectorAll('button,[role="tab"],[role="button"]')];
    const desired = candidates.find(element =>
      core.normalize(element.textContent || element.getAttribute('aria-label') || '').toLowerCase() === desiredMode);
    if (!desired) return false;
    const selected = desired.getAttribute('aria-selected') === 'true'
      || desired.getAttribute('aria-pressed') === 'true'
      || desired.dataset?.state === 'active';
    if (!selected) {
      desired.click();
      await wait(500);
    }
    state.lastConversationModeKey = modeKey;
    log('conversation-mode', { requested: desiredMode, result: selected ? 'already-selected' : 'selected' });
    return true;
  }

  async function ensureReasoningLevel(level) {
    if (level !== 'high') return 'preserved';
    if (Date.now() - state.lastReasoningCheckAt < 5000) return 'recently-checked';
    state.lastReasoningCheckAt = Date.now();
    let selector = null;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      selector = reasoningSelectorButton() || modelSelectorButton();
      if (selector) break;
      await wait(100);
    }
    if (!selector) {
      if (Date.now() - state.lastReasoningUnavailableLogAt >= 300000) {
        state.lastReasoningUnavailableLogAt = Date.now();
        log('reasoning-level', { requested: level, result: 'selector-missing', fallback: 'preserve-current' });
      }
      return 'unavailable';
    }
    const selectorLabel = core.normalize(selector.textContent || selector.getAttribute('aria-label') || '');
    if (/^(alta|alto|high)(\s|$)/i.test(selectorLabel)) return 'confirmed';
    selector.click();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await wait(100);
      if (await setReasoningSlider(level)) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await wait(300);
        log('reasoning-level', { requested: level, result: 'selected-slider' });
        return 'confirmed';
      }
      const high = highOption();
      if (!high) continue;
      const selected = high.getAttribute('aria-checked') === 'true'
        || high.getAttribute('aria-selected') === 'true'
        || high.dataset?.state === 'checked';
      if (!selected) high.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(500);
      log('reasoning-level', { requested: level, result: selected ? 'already-selected' : 'selected' });
      return 'confirmed';
    }
    const thinking = thinkingOption();
    if (thinking) {
      thinking.click();
      await wait(500);
      const reasoningSelector = reasoningSelectorButton();
      if (reasoningSelector && !/^(alta|alto|high)(\s|$)/i.test(controlText(reasoningSelector))) {
        reasoningSelector.click();
        await wait(300);
      }
      const high = highOption() || reasoningSelectorButton();
      if (high && /^(alta|alto|high)(\s|$)/i.test(controlText(high))) {
        if (!/^(alta|alto|high)(\s|$)/i.test(controlText(reasoningSelector))) high.click();
        await wait(500);
        log('reasoning-level', { requested: level, result: 'selected-after-thinking' });
        return 'confirmed';
      }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (Date.now() - state.lastReasoningUnavailableLogAt >= 300000) {
      state.lastReasoningUnavailableLogAt = Date.now();
      log('reasoning-level', { requested: level, result: 'option-missing', fallback: 'preserve-current' });
    }
    return 'unavailable';
  }

  async function waitForBudgetBeforeSend(prompt) {
    if (!budgetGuard?.waitUntilReady) return true;
    const updateBudgetStatus = () => {
      setStatus(core.budgetWaitLabel(budgetGuard.nextAllowedAt?.()));
    };
    updateBudgetStatus();
    const statusTimer = setInterval(updateBudgetStatus, 1000);
    let budgetReady = false;
    try {
      budgetReady = await budgetGuard.waitUntilReady();
    } finally {
      clearInterval(statusTimer);
    }
    if (!budgetReady || !state.enabled) return false;
    const field = core.composer(document);
    const currentText = core.composerText(field);
    if (currentText && !promptMatches(currentText, prompt)) {
      setStatus('Pausado: el campo contiene texto', 'error');
      return false;
    }
    return true;
  }

  function waitForSendButton(timeoutMs = 10000) {
    const started = Date.now();
    const localDeadline = started + timeoutMs;
    return new Promise(resolve => {
      const check = () => {
        const button = core.sendButton(document);
        if (core.canSend(button)) return resolve(button);
        const budgetAt = budgetGuard?.nextAllowedAt?.();
        const budgetDeadline = Number.isSafeInteger(budgetAt) && budgetAt > started
          ? budgetAt + timeoutMs : 0;
        const deadline = Math.max(localDeadline, budgetDeadline);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(check, 100);
      };
      check();
    });
  }

  function waitForComposerClear(timeoutMs = 3000) {
    const started = Date.now();
    return new Promise(resolve => {
      const check = () => {
        if (!core.composerText(core.composer(document))) return resolve(true);
        if (Date.now() - started >= timeoutMs) return resolve(false);
        setTimeout(check, 100);
      };
      check();
    });
  }

  function promptMatches(value, prompt) {
    return Boolean(core.normalize(value))
      && reliability.signature(value) === reliability.signature(prompt);
  }

  async function sendPrompt(prompt) {
    const field = core.composer(document);
    if (!field) throw new Error('No encontré #prompt-textarea');
    const signature = reliability.signature(prompt);
    if (state.pendingSignature === signature) {
      throw new Error('Ya existe un envío pendiente; se evitó un duplicado');
    }
    log('send-start', { promptLength: core.normalize(prompt).length, signature });
    if (!promptMatches(core.composerText(field), prompt)
        && !core.replaceComposerText(field, prompt, document)) {
      throw new Error('El campo no contiene exactamente el mensaje');
    }
    let button = await waitForSendButton();
    if (!button) {
      log('send-control-missing', {
        controls: core.sendControlSnapshot(document),
        composer: core.interfaceSnapshot(document)
      });
      const currentField = core.composer(document);
      if (promptMatches(core.composerText(currentField), prompt)) {
        core.replaceComposerText(currentField, '', document);
      }
      throw new Error('El botón real de enviar no está disponible');
    }
    const currentField = core.composer(document);
    let currentText = core.composerText(currentField);
    if (!promptMatches(currentText, prompt)) {
      if (!currentText) {
        if (!core.replaceComposerText(currentField, prompt, document)) {
          throw new Error('El contenido cambió antes del envío');
        }
        button = await waitForSendButton(3000);
        currentText = core.composerText(core.composer(document));
      }
      if (!button || !promptMatches(currentText, prompt)) {
        throw new Error('El contenido cambió antes del envío');
      }
    }
    button = core.sendButton(document);
    if (!button?.isConnected || !core.canSend(button)) {
      throw new Error('El botón real de enviar no está disponible');
    }
    const userCountBeforeSend = core.userMessageCount(document);
    state.assistantCountBeforeSend = core.assistantMessageCount(document);
    button.click();
    const [cleared, appeared, generationStarted] = await Promise.all([
      waitForComposerClear(8000),
      waitForUserMessage(prompt, userCountBeforeSend, 8000),
      waitForGenerationStart(8000)
    ]);
    if (!reliability.sendAccepted({
      composerCleared: cleared, messageAppeared: appeared, generationStarted
    })) {
      throw new Error('ChatGPT no confirmó el mensaje dentro de la conversación');
    }
    state.lastSentAt = Date.now();
    state.generationStartedAt = 0;
    state.waiting = true;
    state.sawGeneration = generationStarted;
    state.platformReviewPlaceholderSeen = false;
    state.pendingSignature = signature;
    Object.assign(state, reliability.afterSuccess(runtimeSnapshot()));
    persistRuntime();
    log('send-confirmed', { promptLength: core.normalize(prompt).length, signature });
    setStatus('Mensaje confirmado; esperando respuesta');
  }

  async function tick() {
    if (!state.enabled || state.busy) return;
    state.busy = true;
    try {
      let signal = core.pageSignal(document);
      const generationAtSignal = Boolean(core.stopButton(document));
      const isNewChatRoute = location.pathname === '/' || location.pathname === '';
      if (signal.code === 'recoverable'
          && isNewChatRoute
          && core.composer(document)) {
        signal = { code: 'ready', action: 'none' };
      }
      if (signal.code === 'recoverable' && generationAtSignal) {
        signal = { code: 'ready', action: 'none' };
      }
      if (signal.code === 'conversation-limit' && generationAtSignal) {
        signal = { code: 'ready', action: 'none' };
      }
      if (signal.code === 'conversation-limit'
          && (location.pathname === '/' || location.pathname === '')) {
        signal = { code: 'ready', action: 'none' };
      }
      if (core.isSafeRecoverySignal(signal)) {
        if (Date.now() - state.lastRecoveryAt <= 4000) {
          setStatus('Conversación no disponible; verificando recuperación', 'error');
          return;
        }
        const previous = core.recoverableState(
          sessionStorage.getItem(RECOVERABLE_STATE_KEY)
        );
        const plan = core.recoverablePlan(previous, location.pathname, Date.now());
        sessionStorage.setItem(RECOVERABLE_STATE_KEY, JSON.stringify(plan));
        const recoveryChanged = previous.path !== plan.path
          || Number(previous.attempts) !== plan.attempts
          || Number(previous.retryAt) !== plan.retryAt;
        const attempts = plan.attempts;
        const defaultAction = plan.action === 'new-chat' ? 'open_replacement_chat' : plan.action;
        const recoveryConfig = await config();
        const decision = adaptiveRecovery?.chooseRecovery({
          problemCode: signal.code, interfaceState: 'error', isResponding: generationAtSignal,
          defaults: { action: defaultAction }, policy: recoveryConfig.sharedLearning?.policy,
          mode: 'observe', now: Date.now(),
          replacementOpened: Date.now() - state.conversationTransferAt < CONVERSATION_TRANSFER_COOLDOWN_MS
        }) || { action: defaultAction, source: 'default', confidence: 0, policyVersion: 0 };
        const escalation = decision.action === 'open_replacement_chat' ? 'new-chat' : decision.action;
        log('recovery', { code: signal.code, action: decision.recommendedAction || decision.action,
          source: decision.source, version: String(decision.policyVersion || 0) });
        state.lastRecoveryAt = Date.now();
        state.circuitOpenUntil = 0;
        state.consecutiveFailures = 0;
        state.waiting = escalation === 'retry';
        state.sawGeneration = false;
        state.assistantCountBeforeSend = core.assistantMessageCount(document);
        state.lastRecovery = { code: signal.code, action: escalation };
        persistRuntime();
        if (recoveryChanged) {
          saveLearning('recovery');
          saveLearning('error', 0, { code: signal.code });
        }
        if (escalation === 'retry') {
          signal.element.click();
          setStatus(`Conversación no disponible; reintento ${attempts}/1`);
        } else if (escalation === 'reload') {
          setStatus('Conversación no disponible; recarga controlada', 'error');
          location.reload();
        } else if (escalation === 'new-chat') {
          if (Date.now() - state.conversationTransferAt < CONVERSATION_TRANSFER_COOLDOWN_MS) {
            setStatus('Chat de recuperación ya abierto; evitando duplicados', 'error');
          } else {
            state.conversationTransferAt = Date.now();
            sessionStorage.setItem(CONVERSATION_TRANSFER_KEY, String(state.conversationTransferAt));
            state.waiting = false;
            state.sawGeneration = false;
            state.pendingSignature = '';
            state.nextSendAt = Date.now() + 5000;
            persistRuntime();
            const incident = await acquireRecoveryIncident(signal.code, true);
            if (!incident || !incident.replacementOpened) {
              setStatus('Recuperación ya coordinada en otra pestaña', 'error');
              return;
            }
            setStatus('Conversación inaccesible; abriendo un único chat de recuperación');
            await openFreshConversation(null);
          }
        } else {
          state.waiting = false;
          state.nextSendAt = plan.retryAt || Number.POSITIVE_INFINITY;
          persistRuntime();
          if (plan.retryAt > Date.now()) {
            const remainingMinutes = Math.max(1, Math.ceil((plan.retryAt - Date.now()) / 60000));
            setStatus(`Conversación inaccesible; recuperación en ${remainingMinutes} min`, 'error');
          } else {
            setStatus('Recuperación transferida; esperando en este chat', 'error');
          }
        }
        log('recovery', { code: signal.code, action: escalation, attempts,
          retryAt: plan.retryAt, priority: 'circuit-bypass' });
        return;
      }
      if (signal.code !== 'recoverable') {
        sessionStorage.removeItem(RECOVERABLE_STATE_KEY);
      }
      const circuitWasOpen = Date.now() < state.circuitOpenUntil;
      const generationIsActive = Boolean(core.stopButton(document));
      if (reliability.lateSendAccepted({
        circuitOpen: circuitWasOpen,
        generating: generationIsActive,
        assistantCount: core.assistantMessageCount(document),
        assistantCountBeforeSend: state.assistantCountBeforeSend
      })) {
        const lastUserText = core.lastUserMessageText(document);
        Object.assign(state, reliability.afterSuccess(runtimeSnapshot()));
        state.waiting = generationIsActive;
        state.sawGeneration = generationIsActive;
        state.pendingSignature = generationIsActive && lastUserText
          ? reliability.signature(lastUserText) : '';
        state.nextSendAt = generationIsActive ? Number.POSITIVE_INFINITY : Date.now() + 15000;
        persistRuntime();
        log('circuit-reset', { reason: 'late-send-confirmation' });
      }
      if (Date.now() < state.circuitOpenUntil
          && core.stopButton(document)
          && core.interruptedConnection(document)) {
        Object.assign(state, reliability.afterSuccess(runtimeSnapshot()));
        state.reloadAttempts = 0;
        state.reloadWindowStartedAt = 0;
        persistRuntime();
        log('circuit-reset', { reason: 'active-interrupted-generation' });
      }
      if (Date.now() < state.circuitOpenUntil) {
        setStatus(`Protección activa; reintento en ${Math.ceil((state.circuitOpenUntil - Date.now()) / 60000)} min`, 'error');
        return;
      }
      const currentConfig = await config();
      const { prompt, delaySeconds } = currentConfig;
      state.settings = { ...state.settings, ...currentConfig };
      const generating = Boolean(core.stopButton(document));
      if (Date.now() - state.contentLoadedAt < 5000) {
        setStatus('Inicializando la interfaz');
        return;
      }
      const periodicReloadDue = currentConfig.periodicReload
        && Date.now() - state.lastPeriodicReloadAt >= currentConfig.periodicReloadMinutes * 60000;
      if (periodicReloadDue && generating) {
        setStatus('Refresh pendiente; esperando que ChatGPT termine');
        return;
      }
      if (periodicReloadDue) {
        state.lastPeriodicReloadAt = Date.now();
        sessionStorage.setItem('chatgpt-autopilot-last-periodic-reload', String(state.lastPeriodicReloadAt));
        persistRuntime();
        log('recovery', { code: 'periodic-refresh', action: 'reload',
          intervalMinutes: currentConfig.periodicReloadMinutes,
          waiting: state.waiting,
          generating });
        setStatus('Recarga periódica; conservando la espera');
        location.reload();
        return;
      }
      if (signal.code !== 'ready') followLatest(true);
      const review = reliability.platformReviewProgress({
        startedAt: state.platformReviewStartedAt,
        escalated: state.platformReviewEscalated
      }, Date.now(), currentConfig.platformReviewMaxSeconds * 1000,
      signal.code === 'platform-review');
      state.platformReviewStartedAt = review.startedAt;
      state.platformReviewEscalated = review.escalated;
      if (signal.code === 'platform-review') {
        state.waiting = true;
        state.platformReviewPlaceholderSeen = true;
        if (generating) state.sawGeneration = true;
        if (review.action === 'escalate') {
          log('human-required', {
            code: 'platform-review-timeout',
            action: 'escalate',
            reason: 'timeout'
          });
        }
        setStatus(
          review.timedOut
            ? 'Revisión de plataforma prolongada; escalada sin reintentar'
            : 'Revisión de plataforma; esperando sin intervenir',
          review.timedOut ? 'error' : 'idle'
        );
        return;
      }
      if (review.action === 'resume') {
        if (state.waiting && state.pendingSignature) {
          state.lastSentAt = Date.now();
          state.generationStartedAt = 0;
        }
        log('recovery', { code: 'platform-review', action: 'resume' });
      }
      if (signal.code === 'authentication') {
        recordErrorOnce(signal);
        setStatus('Intervención necesaria: inicia sesión', 'error');
        log('human-required', { code: signal.code });
        return;
      }
      if (signal.code === 'rate-limit') {
        if (Date.now() >= state.nextSendAt) {
          recordErrorOnce(signal);
          state.nextSendAt = Date.now() + learning.errorBackoffMs(state.learned, signal.code);
        }
        setStatus('Límite temporal: espera adaptativa', 'error');
        return;
      }
      if (signal.code === 'conversation-limit') {
        if (Date.now() - state.conversationTransferAt < CONVERSATION_TRANSFER_COOLDOWN_MS) {
          setStatus('Chat nuevo ya abierto; evitando duplicados', 'error');
          return;
        }
        state.conversationTransferAt = Date.now();
        sessionStorage.setItem(CONVERSATION_TRANSFER_KEY, String(state.conversationTransferAt));
        state.waiting = false;
        state.sawGeneration = false;
        state.pendingSignature = '';
        state.assistantCountBeforeSend = 0;
        state.lastSentAt = 0;
        Object.assign(state, reliability.afterSuccess(runtimeSnapshot()));
        state.reloadAttempts = 0;
        state.reloadWindowStartedAt = 0;
        state.nextSendAt = Date.now() + 5000;
        persistRuntime();
        saveLearning('recovery');
        log('recovery', { code: 'conversation-limit', action: 'new-chat' });
        const incident = await acquireRecoveryIncident('conversation-limit', true);
        if (!incident || !incident.replacementOpened) {
          setStatus('Chat nuevo ya coordinado en otra pestaña', 'error');
          return;
        }
        setStatus('Límite de conversación; abriendo un chat nuevo');
        await openFreshConversation(signal.element);
        return;
      }
      if (signal.code === 'connection') {
        if (!state.connectionFirstSeenAt) state.connectionFirstSeenAt = Date.now();
        const interruptedFor = Date.now() - state.connectionFirstSeenAt;
        recordErrorOnce(signal);
        const connectionAction = core.connectionRecoveryAction({
          generating, cancelRequested: Boolean(state.connectionCancelAt)
        });
        if (connectionAction === 'cancel-generation') {
          const stop = core.stopButton(document);
          if (stop) {
            stop.click();
            state.connectionCancelAt = Date.now();
            state.lastRecovery = { code: 'connection', action: 'cancel-generation' };
            saveLearning('recovery');
            log('recovery', { code: 'connection', action: 'cancel-generation', immediate: true });
            setStatus('Conexión interrumpida; deteniendo respuesta para recuperar', 'error');
            return;
          }
        }
        const waitingForCancel = state.connectionCancelAt
          && Date.now() - state.connectionCancelAt < 30000;
        const waitingForReconnect = !state.connectionCancelAt && !generating
          && interruptedFor < 30000;
        if (waitingForCancel || waitingForReconnect) {
          setStatus(`Conexión interrumpida; esperando reconexión (${Math.ceil(interruptedFor / 1000)} s)`, 'error');
          return;
        }
      } else {
        state.connectionFirstSeenAt = 0;
        state.connectionCancelAt = 0;
      }
      const interfaceMissingLongEnough = signal.code === 'interface-missing'
        && Date.now() - state.contentLoadedAt > 15000;
      if (signal.code === 'interface-missing' && !interfaceMissingLongEnough) {
        setStatus('Esperando que ChatGPT termine de cargar la interfaz');
        return;
      }
      if (interfaceMissingLongEnough && isNewChatRoute) {
        recordErrorOnce({
          code: 'interface-loading-new-chat',
          ...core.interfaceSnapshot(document)
        }, 300000);
        setStatus('Chat nuevo todavía cargando; esperando sin recargar');
        return;
      }
      const recoveryNeedsReload = signal.code === 'connection'
        || (interfaceMissingLongEnough && !isNewChatRoute);
      if (recoveryNeedsReload && !currentConfig.autoReload) {
        setStatus(`Bloqueo ${signal.code}: recarga automática desactivada`, 'error');
        return;
      }
      const reloadCooldownMs = currentConfig.reloadCooldownMinutes * 60000;
      if (recoveryNeedsReload
          && Date.now() - state.lastReloadAt > reloadCooldownMs) {
        if (signal.code !== 'connection') recordErrorOnce(signal);
        if (!reliability.canReload(runtimeSnapshot())) {
          Object.assign(state, reliability.afterFailure(runtimeSnapshot()));
          state.circuitOpenUntil = Date.now() + 600000;
          persistRuntime();
          setStatus('Protección activa: demasiadas recargas', 'error');
          log('circuit-open', { code: signal.code, reason: 'reload-limit' });
          return;
        }
        Object.assign(state, reliability.beforeReload(runtimeSnapshot()));
        state.lastReloadAt = Date.now();
        sessionStorage.setItem('chatgpt-autopilot-last-reload', String(state.lastReloadAt));
        persistRuntime();
        setStatus(`Recuperando ${signal.code}: recarga ${state.reloadAttempts}/${reliability.MAX_RELOADS}`, 'error');
        log('recovery', { code: signal.code, action: 'reload', attempt: state.reloadAttempts });
        location.reload();
        return;
      }
      if (recoveryNeedsReload) {
        const remainingSeconds = Math.max(1, Math.ceil(
          (reloadCooldownMs - (Date.now() - state.lastReloadAt)) / 1000
        ));
        setStatus(`Bloqueo ${signal.code}: próxima recarga permitida en ${remainingSeconds} s`, 'error');
        return;
      }
      if (generating) {
        const activeField = core.composer(document);
        if (core.composerText(activeField) === core.normalize(prompt)
            && state.pendingSignature !== reliability.signature(prompt)) {
          core.replaceComposerText(activeField, '', document);
          log('draft-cleared', { reason: 'generation-active' });
        }
        if (!state.sawGeneration) {
          state.generationStartedAt = Date.now();
          if (state.lastSentAt > 0) {
            saveLearning('startup', Date.now() - state.lastSentAt);
          }
        }
        state.waiting = true;
        state.sawGeneration = true;
        state.platformReviewPlaceholderSeen = false;
        followLatest();
        setStatus('ChatGPT está respondiendo');
        return;
      }
      if (state.waiting) {
        const newAssistantMessage = core.assistantMessageCount(document) > state.assistantCountBeforeSend;
        if (newAssistantMessage && !generating && !state.platformReviewPlaceholderSeen) {
          state.sawGeneration = true;
        }
        if (!state.sawGeneration) {
          const recovery = core.recoveryButton(document);
          if (recovery && Date.now() - state.lastRecoveryAt > 10000) {
            recovery.click();
            state.lastRecoveryAt = Date.now();
            saveLearning('recovery');
            saveLearning('error', 0, { code: 'recoverable' });
            state.lastRecovery = { code: 'recoverable', action: 'click-recovery' };
            setStatus('Recuperando la respuesta');
            log('recovery', { code: 'recoverable', action: 'click-recovery' });
            return;
          }
          if (Date.now() - state.lastSentAt > learning.startupTimeoutMs(state.learned)) {
            state.waiting = false;
            state.nextSendAt = Date.now() + 1000;
            setStatus('Respuesta ausente; reintentando continuación');
            return;
          }
          setStatus('Esperando que inicie la respuesta');
          return;
        }
        saveLearning(
          'cycle',
          Date.now() - (state.generationStartedAt || state.lastSentAt),
          { replyFingerprint: lastAssistantReplyFingerprint() }
        );
        if (state.lastRecovery) {
          saveLearning('action-success', 0, state.lastRecovery);
          state.lastRecovery = null;
        }
        state.waiting = false;
        state.platformReviewPlaceholderSeen = false;
        state.pendingSignature = '';
        Object.assign(state, reliability.afterSuccess(runtimeSnapshot()));
        persistRuntime();
        state.nextSendAt = Date.now() + Math.max(5, Number(delaySeconds) || 15) * 1000;
        followLatest();
        setStatus('Respuesta terminada; preparando continuación');
        return;
      }
      if (Date.now() < state.nextSendAt) return;
      const recovery = core.recoveryButton(document);
      if (recovery && Date.now() - state.lastRecoveryAt > 10000) {
        recovery.click();
        state.lastRecoveryAt = Date.now();
        saveLearning('recovery');
        saveLearning('error', 0, { code: 'recoverable' });
        state.lastRecovery = { code: 'recoverable', action: 'click-recovery' };
        state.waiting = true;
        state.sawGeneration = false;
        state.assistantCountBeforeSend = core.assistantMessageCount(document);
        setStatus('Acción segura: reintentar/continuar');
        log('recovery', { code: 'recoverable', action: 'click-recovery' });
        return;
      }
      const field = core.composer(document);
      if (!field) {
        setStatus('Campo de mensaje no encontrado', 'error');
        return;
      }
      const composerHasText = Boolean(core.composerText(field));
      const resumableDraft = promptMatches(core.composerText(field), prompt);
      if (composerHasText && !resumableDraft) {
        setStatus('Pausado: el campo contiene texto', 'error');
        return;
      }
      if (resumableDraft) setStatus('Retomando borrador propio pendiente');
      await ensureConversationMode(currentConfig.conversationMode);
      await ensureModel(currentConfig.modelTarget);
      const reasoningResult = await ensureReasoningLevel(currentConfig.reasoningLevel);
      if (reasoningResult === 'unavailable') {
        setStatus('Nivel Alto no verificable; continuando con el nivel actual');
      }
      if (!await waitForBudgetBeforeSend(prompt)) return;
      await sendPrompt(prompt);
    } catch (error) {
      saveLearning('failure');
      const ambiguousSendFailure = error?.message === 'ChatGPT no confirmó el mensaje dentro de la conversación';
      const failure = reliability.afterFailure(runtimeSnapshot());
      if (ambiguousSendFailure) {
        failure.circuitOpenUntil = Date.now() + 300000;
        failure.retryAt = failure.circuitOpenUntil;
      }
      Object.assign(state, failure);
      state.nextSendAt = failure.retryAt;
      persistRuntime();
      log('failure', { message: String(error.message || error), failures: state.consecutiveFailures, retryAt: state.nextSendAt });
      setStatus(state.circuitOpenUntil > Date.now()
        ? ambiguousSendFailure ? 'Protección activa: envío no confirmado' : 'Protección activa tras fallos repetidos'
        : `${error.message || 'Error'}; reintento controlado`, 'error');
    } finally {
      state.busy = false;
    }
  }

  function setEnabled(enabled) {
    const nextEnabled = Boolean(enabled);
    if (!core.enabledStateChanged(state.enabled, nextEnabled)) return;
    state.enabled = nextEnabled;
    log('enabled-change', { enabled: state.enabled });
    if (state.enabled) {
      state.contentLoadedAt = Date.now();
      state.lastPeriodicReloadAt = Date.now();
      sessionStorage.setItem('chatgpt-autopilot-last-periodic-reload', String(state.lastPeriodicReloadAt));
      state.circuitOpenUntil = 0;
      state.consecutiveFailures = 0;
      state.reloadAttempts = 0;
      state.reloadWindowStartedAt = 0;
      state.lastReloadAt = 0;
      sessionStorage.removeItem('chatgpt-autopilot-last-reload');
      persistRuntime();
      const pendingStillPresent = state.pendingSignature
        && reliability.signature(core.lastUserMessageText(document)) === state.pendingSignature;
      if (pendingStillPresent) {
        state.waiting = true;
        state.sawGeneration = Boolean(core.stopButton(document));
      } else if (state.pendingSignature) {
        state.pendingSignature = '';
        persistRuntime();
      }
      state.nextSendAt = state.waiting ? Number.POSITIVE_INFINITY : Date.now() + 1000;
      state.manualScrollUntil = 0;
      followLatest(true);
      setStatus('Activo en esta pestaña');
    } else {
      setStatus('Pausado');
    }
  }

  extensionApi.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message?.type === 'autopilot:set-enabled') setEnabled(message.enabled);
    if (message?.type === 'autopilot:heartbeat') void tick();
    if (message?.type === 'autopilot:get-status') {
      reply({ enabled: state.enabled, status: state.status });
    } else reply({ ok: true, enabled: state.enabled, status: state.status });
  });

  extensionApi.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const configurationChanged = Object.keys(changes).some(key =>
      !['diagnosticLog', 'learning', 'masterEnabled'].includes(key));
    if (configurationChanged) cachedConfigPromise = null;
    if (changes.learning?.newValue) {
      state.learned = learning.normalize(changes.learning.newValue);
    }
    if (changes.masterEnabled) setEnabled(Boolean(changes.masterEnabled.newValue));
  });

  extensionApi.storage.local.get({ masterEnabled: false, learning: learning.EMPTY }, values => {
    state.learned = learning.normalize(values.learning);
    setEnabled(Boolean(values.masterEnabled));
  });

  window.addEventListener('wheel', noteManualScroll, { passive: true });
  window.addEventListener('touchmove', noteManualScroll, { passive: true });
  setStatus('Pausado');
  log('content-loaded', {
    version: extensionApi.runtime.getManifest().version,
    backgroundTabs: true,
    persistentState: true
  });
  let mutationTimer = 0;
  const mutationObserver = new MutationObserver(mutations => {
    if (!state.enabled || mutationTimer) return;
    const badge = document.getElementById('chatgpt-autopilot-badge');
    const onlyBadgeChanged = badge && mutations.every(mutation =>
      mutation.target === badge || badge.contains(mutation.target));
    if (onlyBadgeChanged) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = 0;
      void tick();
    }, 750);
  });
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  const tickInterval = setInterval(tick, 2500);
  const telemetryInterval = setInterval(() => { if (state.enabled) setStatus(state.status); }, 30000);
  const maintenanceInterval = setInterval(() => {
    state.learned = learning.normalize(state.learned);
    if (!state.enabled) cachedConfigPromise = null;
  }, 300000);
  window.addEventListener('pagehide', () => {
    state.autoScrollRun += 1;
    mutationObserver.disconnect();
    clearTimeout(mutationTimer);
    clearInterval(tickInterval);
    clearInterval(maintenanceInterval);
    clearInterval(telemetryInterval);
    cachedConfigPromise = null;
  }, { once: true });
})();
