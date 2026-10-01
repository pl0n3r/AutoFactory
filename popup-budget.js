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
  hint.textContent = 'Factory sustituye este fallback automáticamente cuando publica una política válida.';

  card.append(title, metrics, details, aliasLabel, alias, grid, hint);
  root.insertBefore(card, root.lastElementChild || null);

  const fallbackLimit = card.querySelector('#budget-limit-input');
  const windowMinutes = card.querySelector('#budget-window-input');
  let saveTimer = 0;

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
        if (typeof result?.then === 'function') result.then(resolve, reject);
      } catch (error) { reject(error); }
    });
  }
  function setLocal(values) {
    return new Promise((resolve, reject) => {
      try {
        const result = extensionApi.storage.local.set(values, resolve);
        if (typeof result?.then === 'function') result.then(resolve, reject);
      } catch (error) { reject(error); }
    });
  }
  function formatNext(timestamp) {
    if (!timestamp) return 'Disponible ahora';
    const seconds = Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
    if (seconds <= 0) return 'Actualizando…';
    if (seconds < 60) return `Reanuda en ${seconds} s`;
    return `Reanuda en ${Math.ceil(seconds / 60)} min`;
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
  async function refresh() {
    try {
      const response = await runtimeMessage({ type: 'autopilot:budget-status' });
      if (response?.ok) render(response.snapshot);
    } catch (_error) {
      // Runtime failures are represented only as a local availability message;
      // the underlying exception is intentionally not surfaced or persisted.
      next.textContent = 'Presupuesto no disponible; los envíos fallan cerrado.';
    }
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
        accountBudgetAccountAlias: safeAlias,
        accountBudgetLimit: wantedLimit,
        accountBudgetWindowMinutes: wantedWindow
      }).then(
        () => refresh(),
        () => { next.textContent = 'No se pudieron guardar los ajustes del presupuesto.'; }
      );
    }, 250);
  }

  extensionApi.storage.local.get({
    accountBudgetAccountAlias: 'primary',
    accountBudgetLimit: 40,
    accountBudgetWindowMinutes: 60,
    accountBudgetSnapshotV1: null
  }, values => {
    alias.value = values.accountBudgetAccountAlias || 'primary';
    fallbackLimit.value = String(values.accountBudgetLimit || 40);
    windowMinutes.value = String(values.accountBudgetWindowMinutes || 60);
    render(values.accountBudgetSnapshotV1);
    void refresh();
  });
  for (const node of [alias, fallbackLimit, windowMinutes]) node.addEventListener('change', saveSettings);
  extensionApi.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.accountBudgetSnapshotV1?.newValue) {
      render(changes.accountBudgetSnapshotV1.newValue);
    }
  });
  setInterval(() => { void refresh(); }, 5000);
})();
