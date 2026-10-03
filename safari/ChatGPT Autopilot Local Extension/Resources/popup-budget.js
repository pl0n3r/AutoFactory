(function () {
  'use strict';
  const extensionApi = globalThis.chrome || globalThis.browser;
  const root = document.querySelector('main.content');
  if (!root || !extensionApi?.runtime || !extensionApi?.storage?.local) return;

  const MAX_BUDGET = 512;
  const card = document.createElement('section');
  card.className = 'card';
  card.setAttribute('aria-label', 'Presupuesto compartido de mensajes');

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = 'Presupuesto de mensajes';
  const source = document.createElement('span');
  source.className = 'hint';
  title.appendChild(source);

  const enabledRow = document.createElement('div');
  enabledRow.className = 'toggle';
  const enabledCopy = document.createElement('div');
  const enabledTitle = document.createElement('b');
  enabledTitle.textContent = 'Limitar envíos entre pestañas';
  const enabledHint = document.createElement('div');
  enabledHint.className = 'hint';
  enabledHint.textContent = 'Opcional; desactivado de forma predeterminada';
  enabledCopy.append(enabledTitle, enabledHint);
  const enabledToggle = input('budget-enabled', 'checkbox', '');
  enabledRow.append(enabledCopy, enabledToggle);

  const metrics = document.createElement('div');
  metrics.className = 'metrics';
  const sent = metric('budget-sent', 'Envíos');
  const limit = metric('budget-limit', 'Presupuesto');
  const remaining = metric('budget-remaining', 'Restantes');
  metrics.append(sent.box, limit.box, remaining.box);

  const details = document.createElement('div');
  details.className = 'details';
  const next = document.createElement('div');
  const events = document.createElement('div');
  details.append(next, events);

  const aliasLabel = label('budget-account-alias', 'Alias local de cuenta (sin correo)');
  const alias = input('budget-account-alias', 'text', 'primary');
  alias.maxLength = 64;
  alias.pattern = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}';

  const grid = document.createElement('div');
  grid.className = 'grid';
  const limitGroup = document.createElement('div');
  limitGroup.append(label('budget-limit-input', 'Límite de fallback'),
    input('budget-limit-input', 'number', '40', { min: '1', max: String(MAX_BUDGET) }));
  const windowGroup = document.createElement('div');
  windowGroup.append(label('budget-window-input', 'Ventana (minutos)'),
    input('budget-window-input', 'number', '60', { min: '1', max: '1440' }));
  grid.append(limitGroup, windowGroup);

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Factory sustituye este fallback automáticamente cuando publica una política fresca y válida.';

  card.append(title, enabledRow, metrics, details, aliasLabel, alias, grid, hint);
  root.insertBefore(card, root.lastElementChild || null);

  const fallbackLimit = card.querySelector('#budget-limit-input');
  const windowMinutes = card.querySelector('#budget-window-input');
  let saveTimer = 0;

  const healthCard = document.createElement('section');
  healthCard.className = 'card';
  healthCard.setAttribute('aria-label', 'Estado local de pestañas');
  const healthTitle = document.createElement('div');
  healthTitle.className = 'card-title';
  healthTitle.textContent = 'Estado de pestañas';
  const healthSource = document.createElement('span');
  healthSource.className = 'hint';
  healthSource.textContent = 'solo local';
  healthTitle.appendChild(healthSource);
  const healthSummary = document.createElement('div');
  healthSummary.className = 'details';
  healthSummary.textContent = 'Leyendo pestañas…';
  const healthThresholdLabel = label('tab-health-stall-minutes', 'Marcar «sin avance» tras (minutos)');
  const healthThreshold = input('tab-health-stall-minutes', 'number', '30', {
    min: '1', max: '1440'
  });
  const healthTabs = document.createElement('div');
  healthTabs.className = 'details';
  const healthHint = document.createElement('div');
  healthHint.className = 'hint';
  healthHint.textContent = 'La extensión conserva solo marcas de tiempo, estado y huellas hash; nunca texto del chat.';
  healthCard.append(
    healthTitle, healthSummary, healthThresholdLabel, healthThreshold, healthTabs, healthHint
  );
  root.insertBefore(healthCard, root.lastElementChild || null);

  function metric(id, text) {
    const box = document.createElement('div');
    box.className = 'metric';
    const value = document.createElement('b');
    value.id = id;
    value.textContent = '0';
    const labelNode = document.createElement('span');
    labelNode.textContent = text;
    box.append(value, labelNode);
    return { box, value };
  }
  function label(forId, text) {
    const node = document.createElement('label');
    node.htmlFor = forId;
    node.textContent = text;
    return node;
  }
  function input(id, type, value, attrs = {}) {
    const node = document.createElement('input');
    node.id = id;
    node.type = type;
    node.value = value;
    for (const [key, attrValue] of Object.entries(attrs)) node.setAttribute(key, attrValue);
    return node;
  }
  function runtimeMessage(payload) {
    return new Promise((resolve, reject) => {
      try {
        const result = extensionApi.runtime.sendMessage(payload, response => {
          const error = extensionApi.runtime.lastError;
          if (error || !response) reject(new Error('budget-runtime-unavailable'));
          else resolve(response);
        });
        if (typeof result?.then === 'function') void result.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }
  function setLocal(values) {
    return new Promise((resolve, reject) => {
      try {
        const result = extensionApi.storage.local.set(values, resolve);
        if (typeof result?.then === 'function') void result.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }
  function formatNext(timestamp) {
    if (!timestamp) return 'Disponible ahora';
    const seconds = Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
    if (seconds <= 0) return 'Actualizando…';
    if (seconds < 60) return `Reanuda en ${seconds} s`;
    return `Reanuda en ${Math.ceil(seconds / 60)} min`;
  }
  function renderEnabled(value) {
    const active = value === true;
    enabledToggle.checked = active;
    for (const node of [metrics, details, aliasLabel, alias, grid, hint]) node.hidden = !active;
    alias.disabled = !active;
    fallbackLimit.disabled = !active;
    windowMinutes.disabled = !active;
    if (!active) {
      source.textContent = 'desactivado';
      next.textContent = 'Sin pausas de presupuesto compartido.';
    }
  }
  function render(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    sent.value.textContent = String(snapshot.sent ?? 0);
    limit.value.textContent = String(snapshot.budget ?? 0);
    remaining.value.textContent = String(snapshot.remaining ?? 0);
    source.textContent = snapshot.source === 'factory' ? 'política Factory' : 'fallback local';
    next.textContent = formatNext(snapshot.nextAllowedAt);
    events.textContent = `Límites detectados en ventana: ${snapshot.limitEvents ?? 0} · Alto: ${snapshot.highReasoningSends ?? 0}`;
  }
  function formatHealthTime(timestamp) {
    if (!Number.isFinite(Number(timestamp)) || Number(timestamp) <= 0) return '—';
    try {
      return new Date(Number(timestamp)).toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit'
      });
    } catch (_error) {
      return '—';
    }
  }

  function renderHealth(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.tabs)) return;
    const summary = snapshot.summary || {};
    healthThreshold.value = String(snapshot.thresholdMinutes || 30);
    healthSummary.textContent =
      `Activas: ${summary.active || 0} · Pausadas: ${summary.paused || 0} · ` +
      `En límite: ${summary.rateLimited || 0} · Sin avance: ${summary.stalled || 0}`;
    healthTabs.replaceChildren();
    if (summary.allSameReply === true) {
      const same = document.createElement('div');
      same.className = 'status paused';
      same.textContent = 'Todas las pestañas repiten la misma huella de respuesta.';
      healthTabs.appendChild(same);
    }
    if (snapshot.tabs.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No hay pestañas de ChatGPT con estado local todavía.';
      healthTabs.appendChild(empty);
      return;
    }
    for (const tab of snapshot.tabs) {
      const row = document.createElement('div');
      row.className = 'status';
      if (tab.stalled === true) row.classList.add('paused');
      else if (tab.paused !== true) row.classList.add('active');

      const heading = document.createElement('b');
      heading.textContent = `${tab.accountAlias || 'primary'} · pestaña ${tab.tabId}`;
      const stateLine = document.createElement('div');
      const flags = [];
      flags.push(tab.paused === true ? 'PAUSADA' : 'ACTIVA');
      if (Number(tab.rateLimitedSince) > 0) {
        flags.push(`LÍMITE desde ${formatHealthTime(tab.rateLimitedSince)}`);
      }
      if (tab.stalled === true) {
        flags.push(tab.stalledReason === 'no-reply' ? 'SIN AVANCE · sin respuesta' : 'SIN AVANCE · respuesta repetida');
      }
      stateLine.textContent = flags.join(' · ');
      const times = document.createElement('div');
      times.className = 'hint';
      times.textContent =
        `Último envío: ${formatHealthTime(tab.lastSendAt)} · ` +
        `Última respuesta: ${formatHealthTime(tab.lastReplyAt)}`;
      row.append(heading, stateLine, times);
      healthTabs.appendChild(row);
    }
  }

  async function refreshHealth() {
    const response = await runtimeMessage({ type: 'autopilot:tab-health-status' })
      .then(value => value, () => null);
    if (response?.ok && response.snapshot) {
      renderHealth(response.snapshot);
      return;
    }
    healthSummary.textContent = 'Estado de pestañas no disponible.';
  }

  async function refresh() {
    const response = await runtimeMessage({ type: 'autopilot:budget-status' })
      .then(value => value, () => null);
    if (response?.ok) {
      render(response.snapshot);
      return;
    }
    next.textContent = 'Presupuesto no disponible; los envíos fallan cerrado.';
  }
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const wantedAlias = alias.value.trim();
      const safeAlias = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(wantedAlias) && !wantedAlias.includes('@')
        ? wantedAlias : 'primary';
      const wantedLimit = Math.max(1, Math.min(MAX_BUDGET, Number(fallbackLimit.value) || 40));
      const wantedWindow = Math.max(1, Math.min(1440, Number(windowMinutes.value) || 60));
      alias.value = safeAlias;
      fallbackLimit.value = String(wantedLimit);
      windowMinutes.value = String(wantedWindow);
      void setLocal({
        accountBudgetEnabled: enabledToggle.checked,
        accountBudgetAccountAlias: safeAlias,
        accountBudgetLimit: wantedLimit,
        accountBudgetWindowMinutes: wantedWindow
      }).then(
        () => { void refresh(); },
        () => { next.textContent = 'No se pudieron guardar los ajustes del presupuesto.'; }
      );
    }, 250);
  }

  extensionApi.storage.local.get({
    accountBudgetEnabled: false,
    accountBudgetAccountAlias: 'primary',
    accountBudgetLimit: 40,
    accountBudgetWindowMinutes: 60,
    accountBudgetSnapshotV1: null,
    tabHealthStallMinutes: 30
  }, values => {
    renderEnabled(values.accountBudgetEnabled === true);
    alias.value = values.accountBudgetAccountAlias || 'primary';
    fallbackLimit.value = String(values.accountBudgetLimit || 40);
    windowMinutes.value = String(values.accountBudgetWindowMinutes || 60);
    render(values.accountBudgetSnapshotV1);
    healthThreshold.value = String(values.tabHealthStallMinutes || 30);
    void refresh();
    void refreshHealth();
  });
  for (const node of [enabledToggle, alias, fallbackLimit, windowMinutes]) node.addEventListener('change', saveSettings);
  healthThreshold.addEventListener('change', () => {
    const minutes = Math.max(1, Math.min(1440, Number(healthThreshold.value) || 30));
    healthThreshold.value = String(minutes);
    void setLocal({ tabHealthStallMinutes: minutes }).then(
      () => { void refreshHealth(); },
      () => { healthSummary.textContent = 'No se pudo guardar el umbral de «sin avance».'; }
    );
  });
  extensionApi.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.accountBudgetEnabled) {
      renderEnabled(changes.accountBudgetEnabled.newValue === true);
    }
    if (area === 'local' && changes.accountBudgetSnapshotV1?.newValue) {
      render(changes.accountBudgetSnapshotV1.newValue);
    }
    if (area === 'local' && changes.tabHealthStallMinutes?.newValue) {
      healthThreshold.value = String(changes.tabHealthStallMinutes.newValue || 30);
      void refreshHealth();
    }
  });
  setInterval(() => {
    void refresh();
    void refreshHealth();
  }, 5000);
})();
