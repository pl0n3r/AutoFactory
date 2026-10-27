(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChatGPTAutopilotFactoryPairingPreview = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // This is a read-only demonstration, not the Factory Control pairing contract.
  const labels = Object.freeze({
    desconectado: 'SIN CONEXIÓN · estado ficticio',
    pendiente: 'PENDIENTE · estado ficticio',
    denegado: 'DENEGADO · estado ficticio',
    vencido: 'VENCIDO · estado ficticio',
    revocado: 'REVOCADO · estado ficticio'
  });
  function present(state) {
    if (typeof state !== 'string' || !Object.hasOwn(labels, state)) {
      return Object.freeze({ state: 'unknown', label: 'UNKNOWN · simulación apagada' });
    }
    return Object.freeze({ state, label: labels[state] });
  }
  function mountPreview(doc) {
    const select = doc && typeof doc.getElementById === 'function'
      ? doc.getElementById('factory-control-preview-state') : null;
    const status = doc && typeof doc.getElementById === 'function'
      ? doc.getElementById('factory-control-preview-status') : null;
    if (!select || !status) return false;
    const render = () => { status.textContent = present(select.value).label; };
    select.addEventListener('change', render);
    render();
    return true;
  }
  return Object.freeze({ present, mountPreview });
});
