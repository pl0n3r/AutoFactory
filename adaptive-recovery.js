(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ChatGPTAutopilotAdaptiveRecovery=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';const ACTIONS=new Set(['wait','retry','reload','stop_wait','open_replacement_chat']);
function chooseRecovery({problemCode,interfaceState,isResponding=false,defaults,policy,mode='off',now=Date.now(),replacementOpened=false}={}){
 const fallback=ACTIONS.has(defaults?.action)?defaults.action:'wait';
 if(isResponding)return Object.freeze({action:'wait',recommendedAction:'wait',source:'safety',confidence:1,policyVersion:policy?.policyVersion||0});
 const row=policy?.contexts?.[problemCode+':'+interfaceState];
 const valid=mode!=='off'&&policy?.enabled===true&&Number.isSafeInteger(policy.expiresAt)&&policy.expiresAt>now&&row&&ACTIONS.has(row.action)&&row.samples>=20&&row.confidence>=.80;
 if(!valid||row.action==='open_replacement_chat'&&replacementOpened)return Object.freeze({action:fallback,recommendedAction:fallback,source:'default',confidence:0,policyVersion:policy?.policyVersion||0});
 const action=mode==='enforce'?row.action:fallback;
 return Object.freeze({action,recommendedAction:row.action,source:mode==='enforce'?'shared':'shared-observe',confidence:row.confidence,policyVersion:policy.policyVersion});
}
return {chooseRecovery};
});
