const DEFAULT_PROMPT = 'Continúa autónomamente el desarrollo del proyecto desde el estado real más reciente. Antes de modificar nada: inspecciona el estado actual del repo, rama, issues, PRs, CI y revisiones. No te detengas después de cada paso; avanza mientras sea seguro, sin duplicar trabajo, y reporta solo hitos grandes.';
const PROMPT_SCHEMA_VERSION = 2;
const SETTINGS_DEFAULT_VERSION = 2;
const DEFAULTS = { prompt: DEFAULT_PROMPT, promptSchemaVersion: PROMPT_SCHEMA_VERSION, settingsDefaultVersion: 0, delaySeconds: 15, masterEnabled: false, followScroll: true, scrollStepMin: 90, scrollStepMax: 320, scrollPollMs: 220, scrollStableChecks: 8, scrollMaxSeconds: 45, manualScrollPauseSeconds: 20, autoReload: true, reloadCooldownMinutes: 1, periodicReload: true, periodicReloadMinutes: 15, modelTarget: 'gpt-6', reasoningLevel: 'high', conversationMode: 'chat' };
const extensionApi = globalThis.chrome || globalThis.browser;
const $ = id => document.getElementById(id);
// LOCAL_PROGRESS_VIEW_START
const LOCAL_PROGRESS_LABELS = Object.freeze({
  ACTIVA: 'ACTIVA · muestra sintética',
  SIN_AVANCE: 'SIN AVANCE · muestra sintética',
  UNKNOWN: 'UNKNOWN · sin fuente conectada'
});
function renderLocalTabProgress(sample = 'UNKNOWN') {
  const state = typeof sample === 'string' && Object.hasOwn(LOCAL_PROGRESS_LABELS, sample)
    ? sample : 'UNKNOWN';
  const target = $('local-progress-status');
  if (!target) return 'UNKNOWN';
  target.textContent = LOCAL_PROGRESS_LABELS[state];
  target.dataset.state = state;
  target.classList.toggle('active', state === 'ACTIVA');
  target.classList.toggle('paused', state !== 'ACTIVA');
  return state;
}
renderLocalTabProgress();
// LOCAL_PROGRESS_VIEW_END
const fields = { prompt: $('prompt'), delaySeconds: $('delay'), modelTarget: $('model-target'), reasoningLevel: $('reasoning-level'), followScroll: $('follow-scroll'), scrollStepMin: $('step-min'), scrollStepMax: $('step-max'), scrollPollMs: $('poll-ms'), scrollStableChecks: $('stable-checks'), scrollMaxSeconds: $('max-seconds'), manualScrollPauseSeconds: $('manual-pause'), autoReload: $('auto-reload'), reloadCooldownMinutes: $('reload-cooldown'), periodicReload: $('periodic-reload'), periodicReloadMinutes: $('periodic-reload-minutes') };
const extensionVersion = extensionApi.runtime.getManifest().version;
let selectedConversationMode = 'chat';
$('version').textContent = `v${extensionVersion}`;
const apiCall = (fn, ...args) => new Promise((resolve, reject) => { try { const result = fn(...args, resolve); if (result?.then) result.then(resolve, reject); } catch (error) { reject(error); } });
async function activeTab(){ const tabs=await apiCall(extensionApi.tabs.query.bind(extensionApi.tabs),{active:true,currentWindow:true}); return tabs[0]; }
async function save(){ const values={prompt:fields.prompt.value.trim()||DEFAULT_PROMPT,promptSchemaVersion:PROMPT_SCHEMA_VERSION,settingsDefaultVersion:SETTINGS_DEFAULT_VERSION,delaySeconds:Math.max(5,Number(fields.delaySeconds.value)||15),modelTarget:fields.modelTarget.value,reasoningLevel:fields.reasoningLevel.value,conversationMode:selectedConversationMode,followScroll:fields.followScroll.checked,scrollStepMin:Number(fields.scrollStepMin.value)||90,scrollStepMax:Number(fields.scrollStepMax.value)||320,scrollPollMs:Number(fields.scrollPollMs.value)||220,scrollStableChecks:Number(fields.scrollStableChecks.value)||8,scrollMaxSeconds:Number(fields.scrollMaxSeconds.value)||45,manualScrollPauseSeconds:Math.max(0,Number(fields.manualScrollPauseSeconds.value)||0),autoReload:fields.autoReload.checked,reloadCooldownMinutes:Math.max(1,Number(fields.reloadCooldownMinutes.value)||1),periodicReload:fields.periodicReload.checked,periodicReloadMinutes:Math.max(5,Number(fields.periodicReloadMinutes.value)||15)}; await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local),values); }
function renderConversationMode(mode){selectedConversationMode=mode==='work'?'work':'chat';for(const value of ['chat','work']){const button=$(`mode-${value}`);const selected=value===selectedConversationMode;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));}}
for(const mode of ['chat','work'])$(`mode-${mode}`).addEventListener('click',async()=>{renderConversationMode(mode);await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local),{conversationMode:mode});});
async function matchingTabs(){ return apiCall(extensionApi.tabs.query.bind(extensionApi.tabs),{url:['https://chatgpt.com/*']}); }
async function broadcast(enabled) {
  const tabs = await matchingTabs();
  const sends = tabs.map(tab => new Promise((resolve, reject) => {
    const result = extensionApi.tabs.sendMessage(
      tab.id,
      { type: 'autopilot:set-enabled', enabled },
      () => resolve()
    );
    if (result?.then) result.then(resolve, reject);
  }));
  // Best-effort fan-out: one unavailable tab must not block the others.
  await Promise.allSettled(sends);
}
async function runtimeMessage(payload){ return apiCall(extensionApi.runtime.sendMessage.bind(extensionApi.runtime),payload); }
async function message(payload) {
  const tab = await activeTab();
  if (!tab?.id || !String(tab.url || '').startsWith('https://chatgpt.com/')) {
    throw new Error('Abre primero una pestaña de chatgpt.com');
  }
  return new Promise((resolve, reject) => {
    try {
      extensionApi.tabs.sendMessage(tab.id, payload, response => {
        const error = extensionApi.runtime.lastError;
        if (error) {
          reject(new Error('Recarga esta pestaña para cargar Autopilot'));
          return;
        }
        if (!response) {
          reject(new Error('La pestaña no respondió; recárgala'));
          return;
        }
        resolve(response);
      });
    } catch (_error) {
      // Browser transport details may expose extension internals; return a stable user-safe error.
      reject(new Error('Recarga esta pestaña para cargar Autopilot'));
    }
  });
}
function showStatus(text,enabled){const status=$('status');status.textContent=text;status.classList.toggle('active',enabled===true);status.classList.toggle('paused',enabled===false);}
const factoryControlBridgeStatus=$('factory-control-bridge-status');
const factoryControlPair=$('factory-control-pair');
const factoryControlRevoke=$('factory-control-revoke');
function renderFactoryControlBridge(value={}) {
  const state = value && typeof value === 'object' && value.state === 'ready' ? 'ready' : 'disabled';
  const capabilities = value && typeof value.capabilities === 'object' && value.capabilities
    ? value.capabilities : {};
  factoryControlBridgeStatus.textContent = state === 'ready'
    ? 'LISTO · adapter local disponible'
    : 'DESHABILITADO · sin adapter local';
  factoryControlBridgeStatus.classList.toggle('active', state === 'ready');
  factoryControlBridgeStatus.classList.toggle('paused', state !== 'ready');
  factoryControlPair.disabled = capabilities.pair !== true;
  factoryControlRevoke.disabled = capabilities.revoke !== true;
}
async function refreshFactoryControlBridge() {
  if (typeof extensionApi.runtime.sendMessage !== 'function') {
    renderFactoryControlBridge({ state: 'disabled', capabilities: {} });
    return;
  }
  try {
    renderFactoryControlBridge(await runtimeMessage({type:'autopilot:factory-control-status'}));
  } catch (_error) {
    renderFactoryControlBridge({ state: 'disabled', capabilities: {} });
  }
}
async function refresh(){try{const result=await message({type:'autopilot:get-status'});showStatus(`${result.enabled?'ACTIVO':'PAUSADO'} · ${result.status}`,result.enabled);}catch(error){showStatus(`v${extensionVersion} · ${error.message}`);}}
const cleanSamples=(values,maximum)=>(Array.isArray(values)?values:[]).filter(value=>Number.isFinite(value)&&value>0&&value<=maximum);
const average=(values,maximum)=>{const clean=cleanSamples(values,maximum);return clean.length?clean.reduce((a,b)=>a+b,0)/clean.length:0;};
const percentile=(values,ratio,maximum)=>{const clean=cleanSamples(values,maximum).sort((a,b)=>a-b);return clean.length?clean[Math.min(clean.length-1,Math.floor(clean.length*ratio))]:0;};
function duration(ms) {
  if (!ms) {
    return '—';
  }
  const precision = ms < 10000 ? 1 : 0;
  return `${(ms / 1000).toFixed(precision)} s`;
}
function appendMetricLine(container, label, value) {
  if (container.childNodes.length > 0) container.append(document.createElement('br'));
  const heading = document.createElement('b');
  heading.textContent = label;
  container.append(heading, document.createTextNode(' ' + value));
}
function metricTopEntries(map, empty, limit) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return empty;
  const entries = Object.entries(map);
  if (!entries.length) return empty;
  entries.sort((a,b) => b[1] - a[1]);
  return entries.slice(0,limit).map(([key,count]) => key + ' (' + count + ')').join(', ');
}
function renderLearning(data={}) {
  let state = {};
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    state = data;
  }
  $('cycles').textContent = state.cycles || 0;
  $('recoveries').textContent = state.recoveries || 0;
  $('failures').textContent = state.failures || 0;
  const details = $('learning-details');
  details.replaceChildren();
  appendMetricLine(details, 'Inicio medio:',
    duration(average(state.startupSamplesMs,600000)) + ' · p90: ' + duration(percentile(state.startupSamplesMs,.9,600000)));
  appendMetricLine(details, 'Respuesta media:',
    duration(average(state.responseSamplesMs,21600000)) + ' · p90: ' + duration(percentile(state.responseSamplesMs,.9,21600000)));
  appendMetricLine(details, 'Errores:', metricTopEntries(state.errorsByCode, 'ninguno', 5));
  appendMetricLine(details, 'Recuperaciones exitosas:',
    metricTopEntries(state.actionSuccess, 'aún sin datos', 4));
}
function renderSharedLearning(data={}) {
  const state = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const status = $('shared-learning-status');
  const enabled = state.enabled === true;
  status.textContent = enabled ? `ACTIVA · ${state.mode || 'observe'}` : 'OBSERVACIÓN · sincronización bloqueada';
  status.className = `status ${enabled ? 'active' : 'paused'}`;
  const details = $('shared-learning-details');
  details.replaceChildren();
  const policyVersion = Number(state.policyVersion) || 0;
  const localSamples = Number(state.localSamples) || 0;
  const sharedSamples = Number(state.sharedSamples) || 0;
  const confidence = Number.isFinite(state.confidence) ? `${Math.round(state.confidence * 100)}% confianza` : 'sin confianza global';
  details.append(document.createTextNode(`Política ${policyVersion} · ${localSamples} locales · ${sharedSamples} compartidas · ${confidence}`));
  if (state.source) details.append(document.createElement('br'), document.createTextNode(`Fuente: ${state.source}`));
  if (state.lastError) details.append(document.createElement('br'), document.createTextNode(`Estado: ${state.lastError}`));
}
async function refreshSharedLearning(){
  if (typeof extensionApi.runtime.sendMessage !== 'function') return renderSharedLearning({});
  try { renderSharedLearning(await runtimeMessage({type:'autopilot:shared-learning-status'})); }
  catch (_error) { renderSharedLearning({lastError:'status_unavailable'}); }
}
function refreshLearning(){extensionApi.storage.local.get({learning:{}},values=>renderLearning(values.learning));}
$('start').addEventListener('click',async()=>{try{await save();await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local),{masterEnabled:true});await broadcast(true);await refresh();}catch(error){$('status').textContent=error.message;}});
$('stop').addEventListener('click',async()=>{try{await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local),{masterEnabled:false});await broadcast(false);await refresh();}catch(error){$('status').textContent=error.message;}});
function copyTextLegacy(text) {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try {
    if (!document.execCommand('copy')) { // NOSONAR: compatibility fallback for extension popups without clipboardWrite.
      throw new Error('No pude acceder al portapapeles');
    }
  } finally {
    field.remove();
  }
}
async function copyText(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_error) {
      // Clipboard API can lose transient activation after async diagnostic reads.
    }
  }
  copyTextLegacy(text);
}
$('copy-log').addEventListener('click',async()=>{try{const result=await runtimeMessage({type:'autopilot:get-log'});await copyText(JSON.stringify({exportedAt:new Date().toISOString(),extensionVersion,learning:(await apiCall(extensionApi.storage.local.get.bind(extensionApi.storage.local),{learning:{}})).learning,entries:result.entries||[]},null,2));$('status').textContent=`DIAGNÓSTICO COPIADO · ${(result.entries||[]).length} eventos`;}catch(error){$('status').textContent=`No pude copiar: ${error.message}`;}});
$('clear-log').addEventListener('click',async()=>{try{await runtimeMessage({type:'autopilot:clear-log'});$('status').textContent='LOG BORRADO';}catch(error){$('status').textContent=`No pude borrar: ${error.message}`;}});
$('shared-learning-reset').addEventListener('click',async()=>{try{const result=await runtimeMessage({type:'autopilot:shared-learning-reset'});if(result?.ok!==true)throw new Error('reset_failed');await refreshSharedLearning();}catch(_error){renderSharedLearning({lastError:'reset_failed'});}});
$('shared-learning-rollback').addEventListener('click',async()=>{try{const result=await runtimeMessage({type:'autopilot:shared-learning-rollback'});if(result?.ok!==true)throw new Error('rollback_failed');await refreshSharedLearning();}catch(_error){renderSharedLearning({lastError:'rollback_failed'});}});
factoryControlPair.addEventListener('click',async()=>{try{const result=await runtimeMessage({type:'autopilot:factory-control-pair'});if(result?.code==='disabled')renderFactoryControlBridge({state:'disabled',capabilities:{}});}catch(_error){ // NOSONAR: UI falls back to the fixed disabled state without exposing runtime details.
renderFactoryControlBridge({state:'disabled',capabilities:{}});}});
factoryControlRevoke.addEventListener('click',async()=>{try{const result=await runtimeMessage({type:'autopilot:factory-control-revoke'});if(result?.code==='disabled')renderFactoryControlBridge({state:'disabled',capabilities:{}});}catch(_error){ // NOSONAR: UI falls back to the fixed disabled state without exposing runtime details.
renderFactoryControlBridge({state:'disabled',capabilities:{}});}});
void refreshFactoryControlBridge();
void refreshSharedLearning();
extensionApi.storage.local.get(DEFAULTS,values=>{if(values.settingsDefaultVersion!==SETTINGS_DEFAULT_VERSION){values={...values,settingsDefaultVersion:SETTINGS_DEFAULT_VERSION,reloadCooldownMinutes:1,periodicReload:true,periodicReloadMinutes:15,modelTarget:'gpt-6'};extensionApi.storage.local.set({settingsDefaultVersion:SETTINGS_DEFAULT_VERSION,reloadCooldownMinutes:1,periodicReload:true,periodicReloadMinutes:15,modelTarget:'gpt-6'});}const savedPrompt=String(values.prompt||'').trim();const valid=values.promptSchemaVersion===PROMPT_SCHEMA_VERSION&&savedPrompt.length>0;fields.prompt.value=valid?savedPrompt:DEFAULT_PROMPT;fields.delaySeconds.value=values.delaySeconds;fields.modelTarget.value=values.modelTarget||'gpt-6';fields.reasoningLevel.value=values.reasoningLevel||'high';renderConversationMode(values.conversationMode);fields.followScroll.checked=values.followScroll!==false;fields.scrollStepMin.value=values.scrollStepMin;fields.scrollStepMax.value=values.scrollStepMax;fields.scrollPollMs.value=values.scrollPollMs;fields.scrollStableChecks.value=values.scrollStableChecks;fields.scrollMaxSeconds.value=values.scrollMaxSeconds;fields.manualScrollPauseSeconds.value=values.manualScrollPauseSeconds;fields.autoReload.checked=values.autoReload!==false;fields.reloadCooldownMinutes.value=values.reloadCooldownMinutes;fields.periodicReload.checked=values.periodicReload===true;fields.periodicReloadMinutes.value=values.periodicReloadMinutes;showStatus(values.masterEnabled?'ACTIVO · todas las pestañas':'PAUSADO · todas las pestañas',values.masterEnabled);refreshLearning();refresh();});
extensionApi.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.learning) {
    renderLearning(changes.learning.newValue || {});
  }
  if (area === 'local' && changes.masterEnabled) {
    const text = changes.masterEnabled.newValue
      ? 'ACTIVO · todas las pestañas'
      : 'PAUSADO · todas las pestañas';
    showStatus(text, Boolean(changes.masterEnabled.newValue));
  }
});
setInterval(refreshLearning, 5000);
setInterval(refreshSharedLearning, 15000);


const localControlToggle = $('factory-control-local-toggle');
const localControlStatus = $('factory-control-local-status');
const LOCAL_CONTROL_HOST = 'http://127.0.0.1:8777/*';
const LOCAL_CONTROL_FLAG = 'factoryControlLocalPublishingEnabled';
// Restrict fallback to local permission operations; never alter autopilot messaging.
function localPermission(method) {
  const api = extensionApi.permissions;
  if (!api || typeof api[method] !== 'function') return Promise.resolve(false);
  return new Promise(resolve => {
    let settled = false;
    const done = value => { if (!settled) { settled = true; resolve(value === true); } };
    const args = [{ origins: [LOCAL_CONTROL_HOST] }];
    try {
      const answer = api[method](...args, done);
      if (answer?.then) answer.then(done, () => done(false));
    } catch (_error) { // NOSONAR: Safari Promise-only API, retry without callback; deny on failure.
      // Safari Promise-only APIs reject callback options. Keep denial fail-closed.
      try {
        const answer = api[method](...args);
        if (answer?.then) answer.then(done, () => done(false));
        else done(false);
      } catch (_again) { done(false); } // NOSONAR: No permission means no publish.
    }
  });
}
async function refreshLocalControl() {
  try {
    const value = await apiCall(extensionApi.storage.local.get.bind(extensionApi.storage.local),
      { [LOCAL_CONTROL_FLAG]: false });
    const allowed = await localPermission('contains');
    const enabled = value?.[LOCAL_CONTROL_FLAG] === true && allowed === true;
    localControlToggle.checked = enabled;
    localControlStatus.textContent = enabled ? 'ACTIVO · solo 127.0.0.1' :
      'APAGADO · no envía datos';
    if (!allowed && value?.[LOCAL_CONTROL_FLAG] === true) {
      await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local),
        { [LOCAL_CONTROL_FLAG]: false });
    }
  } catch (_error) { // NOSONAR: Fail closed when permissions or storage fail; do not expose browser errors.
    localControlToggle.checked = false;
    localControlStatus.textContent = 'APAGADO · permisos no disponibles';
  }
}
localControlToggle.addEventListener('change', async () => {
  const requested = localControlToggle.checked;
  localControlToggle.disabled = true;
  try {
    if (requested) {
      if (!extensionApi.permissions?.request) throw new Error('permissions_unavailable');
      // Request in the user-triggered change handler; no permission at install.
      const granted = await localPermission('request');
      if (granted !== true) throw new Error('permission_denied');
    }
    await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local),
      { [LOCAL_CONTROL_FLAG]: requested });
    if (!requested && extensionApi.permissions?.remove) {
      await localPermission('remove');
    }
  } catch (_error) { // NOSONAR: Denied or unavailable permission must silently disable publishing.
    await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local),
      { [LOCAL_CONTROL_FLAG]: false }).catch(() => { /* NOSONAR: Fail closed if storage unavailable. */ });
  } finally {
    localControlToggle.disabled = false;
    void refreshLocalControl();
  }
});
void refreshLocalControl();


// This panel is configuration-only. It installs no network or command handlers.
const lanHost = $('factory-control-lan-host');
const lanKey = $('factory-control-lan-key');
const lanSave = $('factory-control-lan-save');
const lanClear = $('factory-control-lan-clear');
const lanToggle = $('factory-control-lan-toggle');
const lanStatus = $('factory-control-lan-status');
const LAN_HOST = 'factoryControlLanOriginV1';
const LAN_KEY = 'factoryControlLanAgentKeyV1';
const LAN_ENABLED = 'factoryControlLanCommandsEnabled';
const lanGuard = globalThis.ChatGPTAutopilotLocalCommands;
function lanFeedback(value) {
  lanStatus.textContent = value;
  lanStatus.classList.add('paused');
  lanStatus.classList.remove('active');
}
async function loadLanSetup() {
  lanKey.value = ''; // Never reflect a saved secret into the DOM.
  try {
    const stored = await apiCall(extensionApi.storage.local.get.bind(extensionApi.storage.local),
      { [LAN_HOST]: null, [LAN_KEY]: null, [LAN_ENABLED]: false });
    let host = '';
    try {
      if (typeof stored?.[LAN_HOST] === 'string') {
        host = lanGuard.privateOrigin(stored[LAN_HOST]);
      }
    } catch (_error) { /* Bad host remains unusable. */ }
    lanHost.value = host;
    const ready = Boolean(host && typeof stored?.[LAN_KEY] === 'string');
    lanToggle.disabled = !ready;
    lanToggle.checked = ready && stored[LAN_ENABLED] === true;
    lanFeedback(!ready ? 'DESACTIVADO · sin conexión'
      : lanToggle.checked ? 'ACTIVO · recibiendo órdenes del orquestador'
        : 'GUARDADO · órdenes apagadas');
  } catch (_error) { lanFeedback('NO DISPONIBLE · almacenamiento local inaccesible'); }
}
lanSave.addEventListener('click', async () => {
  lanSave.disabled = true;
  try {
    const origin = lanGuard.privateOrigin(lanHost.value.trim());
    const secret = lanKey.value;
    if (typeof secret !== 'string' || secret.length < 12 ||
        secret.length > 256 || !/^[\x21-\x7e]+$/.test(secret)) {
      throw new TypeError('invalid agent key');
    }
    await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local), {
      [LAN_HOST]: origin, [LAN_KEY]: secret, [LAN_ENABLED]: false
    });
    lanKey.value = '';
    lanFeedback('GUARDADO · sin transporte ni permisos activos');
  } catch (_error) { lanFeedback('NO GUARDADO · datos o almacenamiento inválidos'); }
  finally { lanSave.disabled = false; }
});
lanClear.addEventListener('click', async () => {
  lanClear.disabled = true;
  try {
    await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local),
      { [LAN_ENABLED]: false });
    await apiCall(extensionApi.storage.local.remove.bind(extensionApi.storage.local),
      [LAN_HOST, LAN_KEY]);
    lanHost.value = '';
    lanKey.value = '';
    lanFeedback('BORRADO · control LAN deshabilitado');
  } catch (_error) { lanFeedback('ERROR · borrado local no confirmado'); }
  finally { lanClear.disabled = false; }
});
lanToggle.addEventListener('change', async () => {
  const requested = lanToggle.checked;
  lanToggle.disabled = true;
  try {
    const stored = await apiCall(extensionApi.storage.local.get.bind(extensionApi.storage.local),
      { [LAN_HOST]: null });
    const origin = lanGuard.privateOrigin(stored?.[LAN_HOST]);
    if (requested) {
      // Request in the user's click; a denial leaves everything off.
      const granted = await new Promise(resolve => {
        let done = false;
        const fin = v => { if (!done) { done = true; resolve(v === true); } };
        try {
          const a = extensionApi.permissions.request({ origins: [origin + '/*'] }, fin);
          if (a?.then) a.then(fin, () => fin(false));
        } catch (_e) { fin(false); }
      });
      if (!granted) throw new Error('permission_denied');
    }
    await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local),
      { [LAN_ENABLED]: requested });
  } catch (_error) {
    await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local),
      { [LAN_ENABLED]: false }).catch(() => {});
  } finally { void loadLanSetup(); }
});
void loadLanSetup();


// Simple one-button link with the orchestrator: grants the permission, saves
// the key and turns on both state publishing and orders (see sections above).
const orchSummary = $('orchestrator-summary');
const orchConnect = $('orchestrator-connect');
const orchDisconnect = $('orchestrator-disconnect');
function storageGet(defaults) {
  return apiCall(extensionApi.storage.local.get.bind(extensionApi.storage.local), defaults);
}
function storageSet(values) {
  return apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local), values);
}
async function refreshOrchestrator() {
  try {
    const s = await storageGet({ [LAN_HOST]: null, [LAN_KEY]: null, [LAN_ENABLED]: false, [LOCAL_CONTROL_FLAG]: false });
    const on = s[LAN_ENABLED] === true && s[LOCAL_CONTROL_FLAG] === true && typeof s[LAN_KEY] === 'string';
    orchSummary.textContent = on ? 'CONECTADO · el orquestador dirige a los chats'
      : s[LAN_KEY] ? 'GUARDADO · pulsa CONECTAR' : 'SIN CONECTAR · los chats siguen con el mensaje genérico';
    const last = (await storageGet({ factoryControlLocalLastPublish: null })).factoryControlLocalLastPublish;
    if (on && last) {
      const secs = Math.max(0, Math.round((Date.now() - last.at) / 1000));
      orchSummary.textContent += ' · último envío hace ' + secs + ' s: '
        + (last.ok ? 'correcto' : 'falló en ' + last.step + ' (' + last.detail + ')');
    } else if (on) orchSummary.textContent += ' · aún sin envíos';
    const poll = on ? (await storageGet({ factoryControlLanLastPoll: null })).factoryControlLanLastPoll : null;
    if (poll) orchSummary.textContent += ' · órdenes: ' + poll.result;
    else if (on) orchSummary.textContent += ' · órdenes: sin consultar aún';
    orchSummary.classList.toggle('active', on);
    orchSummary.classList.toggle('paused', !on);
  } catch (_error) { orchSummary.textContent = 'NO DISPONIBLE · almacenamiento local inaccesible'; }
}
orchConnect.addEventListener('click', async () => {
  orchConnect.disabled = true;
  try {
    const saved = await storageGet({ [LAN_HOST]: null, [LAN_KEY]: null });
    const origin = lanGuard.privateOrigin(lanHost.value.trim() || saved[LAN_HOST] || 'http://127.0.0.1:8777');
    const secret = lanKey.value || saved[LAN_KEY];
    if (typeof secret !== 'string' || secret.length < 12 || secret.length > 256 || !/^[\x21-\x7e]+$/.test(secret)) {
      throw new TypeError('Falta la clave: ábrela en «Dirección y clave»');
    }
    // Ask first, inside the click, so the browser still counts it as a user action.
    const granted = await new Promise(resolve => {
      let done = false;
      const fin = v => { if (!done) { done = true; resolve(v === true); } };
      try {
        const a = extensionApi.permissions.request({ origins: [origin + '/*'] }, fin);
        if (a?.then) a.then(fin, () => fin(false));
      } catch (_e) { fin(false); }
    });
    if (!granted) throw new Error('Permiso denegado');
    await storageSet({ [LAN_HOST]: origin, [LAN_KEY]: secret, [LAN_ENABLED]: true, [LOCAL_CONTROL_FLAG]: true });
    lanKey.value = '';
  } catch (error) {
    orchSummary.textContent = 'NO CONECTADO · ' + (error?.message || 'revisa los datos');
    orchSummary.classList.add('paused');
    orchSummary.classList.remove('active');
    orchConnect.disabled = false;
    return;
  }
  orchConnect.disabled = false;
  void refreshOrchestrator(); void refreshLocalControl(); void loadLanSetup();
});
orchDisconnect.addEventListener('click', async () => {
  try { await storageSet({ [LAN_ENABLED]: false, [LOCAL_CONTROL_FLAG]: false }); } catch (_e) { /* fail closed */ }
  void refreshOrchestrator(); void refreshLocalControl(); void loadLanSetup();
});
extensionApi.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && [LAN_ENABLED, LOCAL_CONTROL_FLAG, LAN_KEY, 'factoryControlLocalLastPublish', 'factoryControlLanLastPoll'].some(k => Object.hasOwn(changes, k))) void refreshOrchestrator();
});
void refreshOrchestrator();
