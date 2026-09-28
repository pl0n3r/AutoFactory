const DEFAULT_PROMPT = 'Continúa autónomamente el desarrollo del proyecto desde el estado real más reciente. Antes de modificar nada: inspecciona el estado actual del repo, rama, issues, PRs, CI y revisiones. No te detengas después de cada paso; avanza mientras sea seguro, sin duplicar trabajo, y reporta solo hitos grandes.';
const PROMPT_SCHEMA_VERSION = 2;
const SETTINGS_DEFAULT_VERSION = 1;
const DEFAULTS = { prompt: DEFAULT_PROMPT, promptSchemaVersion: PROMPT_SCHEMA_VERSION, settingsDefaultVersion: 0, delaySeconds: 15, masterEnabled: false, followScroll: true, scrollStepMin: 90, scrollStepMax: 320, scrollPollMs: 220, scrollStableChecks: 8, scrollMaxSeconds: 45, manualScrollPauseSeconds: 20, autoReload: true, reloadCooldownMinutes: 1, periodicReload: true, periodicReloadMinutes: 15, reasoningLevel: 'high', conversationMode: 'chat' };
const extensionApi = globalThis.chrome || globalThis.browser;
const $ = id => document.getElementById(id);
const fields = { prompt: $('prompt'), delaySeconds: $('delay'), reasoningLevel: $('reasoning-level'), followScroll: $('follow-scroll'), scrollStepMin: $('step-min'), scrollStepMax: $('step-max'), scrollPollMs: $('poll-ms'), scrollStableChecks: $('stable-checks'), scrollMaxSeconds: $('max-seconds'), manualScrollPauseSeconds: $('manual-pause'), autoReload: $('auto-reload'), reloadCooldownMinutes: $('reload-cooldown'), periodicReload: $('periodic-reload'), periodicReloadMinutes: $('periodic-reload-minutes') };
const extensionVersion = extensionApi.runtime.getManifest().version;
let selectedConversationMode = 'chat';
$('version').textContent = `v${extensionVersion}`;
const apiCall = (fn, ...args) => new Promise((resolve, reject) => { try { const result = fn(...args, resolve); if (result?.then) result.then(resolve, reject); } catch (error) { reject(error); } });
async function activeTab(){ const tabs=await apiCall(extensionApi.tabs.query.bind(extensionApi.tabs),{active:true,currentWindow:true}); return tabs[0]; }
async function save(){ const values={prompt:fields.prompt.value.trim()||DEFAULT_PROMPT,promptSchemaVersion:PROMPT_SCHEMA_VERSION,settingsDefaultVersion:SETTINGS_DEFAULT_VERSION,delaySeconds:Math.max(5,Number(fields.delaySeconds.value)||15),reasoningLevel:fields.reasoningLevel.value,conversationMode:selectedConversationMode,followScroll:fields.followScroll.checked,scrollStepMin:Number(fields.scrollStepMin.value)||90,scrollStepMax:Number(fields.scrollStepMax.value)||320,scrollPollMs:Number(fields.scrollPollMs.value)||220,scrollStableChecks:Number(fields.scrollStableChecks.value)||8,scrollMaxSeconds:Number(fields.scrollMaxSeconds.value)||45,manualScrollPauseSeconds:Math.max(0,Number(fields.manualScrollPauseSeconds.value)||0),autoReload:fields.autoReload.checked,reloadCooldownMinutes:Math.max(1,Number(fields.reloadCooldownMinutes.value)||1),periodicReload:fields.periodicReload.checked,periodicReloadMinutes:Math.max(5,Number(fields.periodicReloadMinutes.value)||15)}; await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local),values); }
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
function refreshLearning(){extensionApi.storage.local.get({learning:{}},values=>renderLearning(values.learning));}
$('start').addEventListener('click',async()=>{try{await save();await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local),{masterEnabled:true});await broadcast(true);await refresh();}catch(error){$('status').textContent=error.message;}});
$('stop').addEventListener('click',async()=>{try{await apiCall(extensionApi.storage.local.set.bind(extensionApi.storage.local),{masterEnabled:false});await broadcast(false);await refresh();}catch(error){$('status').textContent=error.message;}});
async function copyText(text) {
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    throw new Error('Portapapeles no disponible');
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch (_error) {
    throw new Error('No pude acceder al portapapeles');
  }
}
$('copy-log').addEventListener('click',async()=>{try{const result=await runtimeMessage({type:'autopilot:get-log'});await copyText(JSON.stringify({exportedAt:new Date().toISOString(),extensionVersion,learning:(await apiCall(extensionApi.storage.local.get.bind(extensionApi.storage.local),{learning:{}})).learning,entries:result.entries||[]},null,2));$('status').textContent=`DIAGNÓSTICO COPIADO · ${(result.entries||[]).length} eventos`;}catch(error){$('status').textContent=`No pude copiar: ${error.message}`;}});
$('clear-log').addEventListener('click',async()=>{try{await runtimeMessage({type:'autopilot:clear-log'});$('status').textContent='LOG BORRADO';}catch(error){$('status').textContent=`No pude borrar: ${error.message}`;}});
extensionApi.storage.local.get(DEFAULTS,values=>{if(values.settingsDefaultVersion!==SETTINGS_DEFAULT_VERSION){values={...values,settingsDefaultVersion:SETTINGS_DEFAULT_VERSION,reloadCooldownMinutes:1,periodicReload:true,periodicReloadMinutes:15};extensionApi.storage.local.set({settingsDefaultVersion:SETTINGS_DEFAULT_VERSION,reloadCooldownMinutes:1,periodicReload:true,periodicReloadMinutes:15});}const savedPrompt=String(values.prompt||'').trim();const valid=values.promptSchemaVersion===PROMPT_SCHEMA_VERSION&&savedPrompt.length>0;fields.prompt.value=valid?savedPrompt:DEFAULT_PROMPT;fields.delaySeconds.value=values.delaySeconds;fields.reasoningLevel.value=values.reasoningLevel||'high';renderConversationMode(values.conversationMode);fields.followScroll.checked=values.followScroll!==false;fields.scrollStepMin.value=values.scrollStepMin;fields.scrollStepMax.value=values.scrollStepMax;fields.scrollPollMs.value=values.scrollPollMs;fields.scrollStableChecks.value=values.scrollStableChecks;fields.scrollMaxSeconds.value=values.scrollMaxSeconds;fields.manualScrollPauseSeconds.value=values.manualScrollPauseSeconds;fields.autoReload.checked=values.autoReload!==false;fields.reloadCooldownMinutes.value=values.reloadCooldownMinutes;fields.periodicReload.checked=values.periodicReload===true;fields.periodicReloadMinutes.value=values.periodicReloadMinutes;showStatus(values.masterEnabled?'ACTIVO · todas las pestañas':'PAUSADO · todas las pestañas',values.masterEnabled);refreshLearning();refresh();});
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
