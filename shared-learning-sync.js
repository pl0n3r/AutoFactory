(function(root,factory){const api=factory(root.ChatGPTAutopilotSharedLearningProtocol||(typeof require==='function'?require('./shared-learning-protocol.js'):null));if(typeof module==='object'&&module.exports)module.exports=api;else root.ChatGPTAutopilotSharedLearningSync=api;})(typeof globalThis!=='undefined'?globalThis:this,function(protocol){
'use strict';
const KEY='sharedLearning';const MAX_QUEUE=200;const BATCH=25;const POLL_MS=15*60*1000;const MAX_BACKOFF_MS=30*60*1000;
function createSharedLearningSync({storage,clock=Date.now,schedule=setTimeout,cancelSchedule=clearTimeout,fetchPolicy,uploadEvents}={}){
 if(!protocol||!storage||typeof storage.get!=='function'||typeof storage.set!=='function'||typeof fetchPolicy!=='function'||typeof uploadEvents!=='function')throw new TypeError('Shared learning sync dependencies are required');
 let timer=null,failures=0;
 const empty=()=>({enabled:false,mode:'observe',queue:[],policy:protocol.BUILT_IN_POLICY,lastSyncAt:0,lastError:null,localSamples:0,sharedSamples:0});
 async function read(){const raw=await storage.get(KEY);const value=raw&&raw[KEY]?raw[KEY]:raw;return value&&typeof value==='object'?{...empty(),...value,queue:Array.isArray(value.queue)?value.queue.slice(-MAX_QUEUE):[]}:empty();}
 async function write(value){await storage.set({[KEY]:value});return value;}
 async function record(input){const state=await read();const event=protocol.sanitizeOutcome(input,clock());state.queue=[...state.queue,event].slice(-MAX_QUEUE);state.localSamples+=1;await write(state);return event;}
 async function sync(){const state=await read();try{if(state.queue.length){const batch=protocol.sanitizeBatch(state.queue.slice(0,BATCH),clock());await uploadEvents(batch);state.queue=state.queue.slice(batch.length);}const remote=await fetchPolicy(state.policy.policyVersion||0);if(remote&&!remote.notModified){state.policy=protocol.validatePolicySnapshot(remote,clock(),state.policy.policyVersion||0);state.sharedSamples=Object.values(state.policy.contexts).reduce((sum,row)=>sum+row.samples,0);}state.lastSyncAt=clock();state.lastError=null;failures=0;await write(state);return snapshot();}catch(error){failures+=1;state.lastError='sync_failed';await write(state);throw error;}}
 function arm(delay=POLL_MS){if(timer!==null)cancelSchedule(timer);timer=schedule(async()=>{try{await sync();arm(POLL_MS);}catch(_error){arm(Math.min(POLL_MS*(2**Math.min(failures,1)),MAX_BACKOFF_MS));}},delay);}
 async function start(){arm(0);return snapshot();}
 async function snapshot(){const state=await read();if(state.policy.expiresAt<=clock())state.policy=protocol.BUILT_IN_POLICY;const rows=Object.values(state.policy.contexts||{});const strongest=rows.sort((a,b)=>b.confidence-a.confidence)[0];return Object.freeze({enabled:Boolean(state.enabled),mode:state.mode,queued:state.queue.length,policy:state.policy,policyVersion:state.policy.policyVersion||0,lastSyncAt:state.lastSyncAt,lastError:state.lastError,localSamples:state.localSamples,sharedSamples:state.sharedSamples,source:strongest?'shared-observe':'default',confidence:strongest?.confidence,successRate:strongest?.successRate});}
 async function reset(){failures=0;return write(empty()).then(snapshot);}
 async function rollback(){const state=await read();state.policy=protocol.BUILT_IN_POLICY;state.mode='observe';await write(state);return snapshot();}
 return Object.freeze({start,record,sync,snapshot,reset,rollback});
}
return {createSharedLearningSync,MAX_QUEUE,BATCH,POLL_MS,MAX_BACKOFF_MS};
});
