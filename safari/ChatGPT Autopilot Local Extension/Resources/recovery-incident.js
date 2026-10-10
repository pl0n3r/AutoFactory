(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ChatGPTAutopilotRecoveryIncident=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';const TOKEN=/^[A-Za-z0-9/][A-Za-z0-9._:/-]{0,127}$/;
function createIncidentCoordinator({load,save,clock=Date.now,ttlMs=120000}={}){
 if(typeof load!=='function'||typeof save!=='function'||typeof clock!=='function'||!Number.isSafeInteger(ttlMs)||ttlMs<100)throw new TypeError('Incident dependencies are required');
 let queue=Promise.resolve();
 function checked(v,n){if(typeof v!=='string'||!TOKEN.test(v))throw new TypeError(n+' is invalid');return v;}
 function secureSuffix(){const bytes=new Uint32Array(2);globalThis.crypto.getRandomValues(bytes);return Array.from(bytes,value=>value.toString(36)).join('');}
 function transact(fn){const run=queue.then(async()=>{const raw=await load();const state=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};const out=await fn(state);await save(state);return out;});queue=run.catch(()=>{});return run;}
 function acquire({problemCode,route,ownerId,replacement=false}={}){return transact(state=>{const now=clock();const key=checked(problemCode,'problemCode')+'|'+checked(route,'route');const current=state[key];if(current&&current.expiresAt>now)return {granted:current.ownerId===ownerId,incidentId:current.incidentId,expiresAt:current.expiresAt,replacementOpened:Boolean(current.replacementOpened)};const incidentId='incident-'+now+'-'+secureSuffix();state[key]={incidentId,ownerId:checked(ownerId,'ownerId'),expiresAt:now+ttlMs,replacementOpened:Boolean(replacement)};return {granted:true,incidentId,expiresAt:now+ttlMs,replacementOpened:Boolean(replacement)};});}
 function complete({incidentId,ownerId}={}){return transact(state=>{for(const [key,row] of Object.entries(state)){if(row.incidentId===incidentId&&row.ownerId===ownerId){delete state[key];return true;}}return false;});}
 function release(input){return complete(input);}
 return Object.freeze({acquire,complete,release});
}
return {createIncidentCoordinator};
});
