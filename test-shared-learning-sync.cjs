'use strict';
const assert=require('node:assert/strict');
const {createSharedLearningSync}=require('./shared-learning-sync.js');
const protocol=require('./shared-learning-protocol.js');
(async()=>{
 let state={sharedLearning:{enabled:true}};const storage={async get(){return state},async set(v){state={...state,...v}}};
 let uploaded=[];let fetched=0;const now=1800000000000;
 const sync=createSharedLearningSync({storage,clock:()=>now,schedule:()=>0,cancelSchedule:()=>{},
  uploadEvents:async batch=>{uploaded.push(...batch)},fetchPolicy:async()=>{fetched++;return {schemaVersion:1,policyVersion:2,issuedAt:now-1,expiresAt:now+60000,enabled:false,rollbackVersion:0,contexts:{}}}});
 for(let i=0;i<205;i++) await sync.record({eventId:'event-'+String(i).padStart(8,'0'),installationId:'install-12345678',browserFamily:'chrome',extensionVersion:'1.6.29',problemCode:'offline',interfaceState:'error',action:'wait',durationMs:1,attempt:0,outcome:'success',policyVersion:0,observedAt:now});
 assert.equal((await sync.snapshot()).queued,200);
 await sync.sync();assert.equal(uploaded.length,25);assert.equal(fetched,1);
 assert.equal((await sync.snapshot()).queued,175,'opted-in upload leaves bounded remainder');
 let snap=await sync.snapshot();assert.equal(snap.policyVersion,2);assert.equal(snap.queued,175);
 await sync.rollback();snap=await sync.snapshot();assert.equal(snap.policyVersion,0);assert.equal(snap.enabled,false,'rollback revokes sync consent');
 const fetchedBeforeRollbackSync=fetched,uploadsBeforeRollbackSync=uploaded.length;
 await sync.sync();snap=await sync.snapshot();
 assert.equal(snap.policyVersion,0,'later sync must not reapply rollbacked remote policy');
 assert.equal(fetched,fetchedBeforeRollbackSync,'rollback prevents remote policy refetch');
 assert.equal(uploaded.length,uploadsBeforeRollbackSync,'rollback prevents new event uploads');
 await sync.reset();snap=await sync.snapshot();assert.equal(snap.queued,0);assert.deepEqual(snap.policy,protocol.BUILT_IN_POLICY);
 const afterResetUploads=uploaded.length,afterResetFetches=fetched;
 await sync.record({eventId:'after-reset-event',installationId:'install-12345678',browserFamily:'chrome',extensionVersion:'1.7.0',problemCode:'offline',interfaceState:'error',action:'wait',durationMs:1,attempt:0,outcome:'success',policyVersion:0,observedAt:now});
 await sync.sync();assert.equal(uploaded.length,afterResetUploads);assert.equal(fetched,afterResetFetches);
 assert.equal((await sync.snapshot()).queued,0,'pre-consent events must never enter the upload queue');await sync.reset();
 let expiredState={sharedLearning:{enabled:true}};const expiredStorage={async get(){return expiredState},async set(v){expiredState={...expiredState,...v}}};
 let tick=now;const freshUploads=[];
 const cleaner=createSharedLearningSync({storage:expiredStorage,clock:()=>tick,schedule:()=>0,cancelSchedule:()=>{},
  uploadEvents:async batch=>{freshUploads.push(...batch)},fetchPolicy:async()=>({notModified:true})});
 const fixture={installationId:'install-12345678',browserFamily:'chrome',extensionVersion:'1.7.0',problemCode:'offline',interfaceState:'error',action:'wait',durationMs:1,attempt:0,outcome:'success',policyVersion:0};
 await cleaner.record({...fixture,eventId:'expired-event',observedAt:now-30*86_400_000});
 tick=now+1;await cleaner.record({...fixture,eventId:'fresh-event',observedAt:tick});
 await cleaner.sync();assert.deepEqual(freshUploads.map(event=>event.eventId),['fresh-event']);
 assert.equal((await cleaner.snapshot()).queued,0);
 // Regression: pre-fix disabled storage could retain unsent outcomes. Never upload
 // such legacy events after an independent, later enablement.
 let legacyStore={sharedLearning:{enabled:false,queue:[protocol.sanitizeOutcome({...fixture,eventId:'legacy-event',observedAt:now},now)]}};
 const legacyStorage={
  async get(){return legacyStore},
  async set(value){legacyStore={...legacyStore,...value}}
 };
 const legacyUploads=[];
 let legacyFetches=0;
 const legacy=createSharedLearningSync({storage:legacyStorage,clock:()=>now,schedule:()=>0,cancelSchedule:()=>{},
  uploadEvents:async batch=>{legacyUploads.push(...batch)},fetchPolicy:async()=>{legacyFetches++;return {notModified:true}}});
 assert.equal((await legacy.snapshot()).queued,1,'legacy disabled queue fixture');
 await legacy.sync();
 assert.equal((await legacy.snapshot()).queued,0,'disabled sync purges inherited queue');
 assert.equal(legacyUploads.length,0);
 assert.equal(legacyFetches,0);
 legacyStore.sharedLearning={...legacyStore.sharedLearning,enabled:true};
 await legacy.sync();
 assert.equal(legacyUploads.length,0,'later consent cannot transmit inherited events');
 legacyStore.sharedLearning={enabled:false,queue:[protocol.sanitizeOutcome({...fixture,eventId:'legacy-record',observedAt:now},now)]};
 await legacy.record({...fixture,eventId:'local-disabled',observedAt:now});
 assert.equal((await legacy.snapshot()).queued,0,'disabled recording purges inherited queue');
 assert.equal(legacyUploads.length,0);
 assert.equal(legacyFetches,1,'only explicitly enabled sync fetches policy');

 // Concurrent network IO must never resurrect the state after a completed reset.
 const pending=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
 const raceEvent={...fixture,eventId:'race-event',observedAt:now};
 let raceStorage={sharedLearning:{enabled:true,queue:[]}};
 const raceAdapter={async get(){return raceStorage},async set(value){raceStorage={...raceStorage,...value}}};
 const uploadStarted=pending(),releaseUpload=pending();
 const racing=createSharedLearningSync({storage:raceAdapter,clock:()=>now,schedule:()=>0,cancelSchedule:()=>{},
  uploadEvents:async()=>{uploadStarted.resolve();await releaseUpload.promise},
  fetchPolicy:async()=>({notModified:true})});
 await racing.record(raceEvent);
 const inFlight=racing.sync();
 await uploadStarted.promise;
 const resetSnap=await racing.reset();assert.equal(resetSnap.enabled,false);
 assert.equal(resetSnap.queued,0);
 releaseUpload.resolve();
 await inFlight;
 assert.equal((await racing.snapshot()).enabled,false,'in-flight upload cannot restore consent');
 assert.equal((await racing.snapshot()).queued,0,'in-flight upload cannot restore queued events');
 // A delayed policy fetch must not overwrite a more recent rollback.
 let policyStorage={sharedLearning:{enabled:true,mode:'observe'}};
 const policyAdapter={async get(){return policyStorage},async set(value){policyStorage={...policyStorage,...value}}};
 const fetchStarted=pending(),releaseFetch=pending();
 const policyRace=createSharedLearningSync({storage:policyAdapter,clock:()=>now,schedule:()=>0,cancelSchedule:()=>{},
  uploadEvents:async()=>{},fetchPolicy:async()=>{fetchStarted.resolve();return releaseFetch.promise}});
 const oldSync=policyRace.sync();await fetchStarted.promise;
 const rollbackSnap=await policyRace.rollback();assert.equal(rollbackSnap.policyVersion,0);
 releaseFetch.resolve({schemaVersion:1,policyVersion:5,issuedAt:now-1,expiresAt:now+60000,enabled:true,rollbackVersion:0,contexts:{}});
 await oldSync;
 assert.equal((await policyRace.snapshot()).policyVersion,0,'old fetch cannot overwrite rollback');
 // An upload rejected after reset must not store a stale failure/status.
 let rejectionStore={sharedLearning:{enabled:true,queue:[]}};
 const rejectionAdapter={async get(){return rejectionStore},async set(value){rejectionStore={...rejectionStore,...value}}};
 const rejectionStarted=pending(),releaseReject=pending();
 const rejectionRace=createSharedLearningSync({storage:rejectionAdapter,clock:()=>now,schedule:()=>0,cancelSchedule:()=>{},
  uploadEvents:async()=>{rejectionStarted.resolve();return releaseReject.promise},
  fetchPolicy:async()=>({notModified:true})});
 await rejectionRace.record({...fixture,eventId:'reject-after-reset',observedAt:now});
 const lateFailure=rejectionRace.sync();await rejectionStarted.promise;
 await rejectionRace.reset();releaseReject.reject(new Error('network failed after revocation'));
 await lateFailure;
 assert.equal((await rejectionRace.snapshot()).enabled,false);
 assert.equal((await rejectionRace.snapshot()).lastError,null,'stale sync error cannot overwrite reset');

 // Serializing the entire read-modify-write transaction preserves both records.
 let concurrentData={sharedLearning:{enabled:true,queue:[]}};
 const concurrentStorage={async get(){return concurrentData},async set(value){concurrentData={...concurrentData,...value}}};
 const sent=[];
 let failUpload=true;
 const concurrent=createSharedLearningSync({storage:concurrentStorage,clock:()=>now,schedule:()=>0,cancelSchedule:()=>{},
  uploadEvents:async batch=>{if(failUpload){failUpload=false;throw new Error('synthetic network unavailable')}sent.push(...batch)},
  fetchPolicy:async()=>({notModified:true})});
 await Promise.all([
  concurrent.record({...fixture,eventId:'concurrent-a',observedAt:now}),
  concurrent.record({...fixture,eventId:'concurrent-b',observedAt:now})
 ]);
 let simultaneousSnap=await concurrent.snapshot();
 assert.equal(simultaneousSnap.localSamples,2,'concurrent events must both count');
 assert.equal(simultaneousSnap.queued,2,'concurrent records must not overwrite one another');
 await assert.rejects(concurrent.sync(),/synthetic network unavailable/);
 assert.equal((await concurrent.snapshot()).queued,2,'failed upload must keep queue');
 await Promise.all([concurrent.sync(),concurrent.sync()]);
 assert.deepEqual(sent.map(x=>x.eventId),['concurrent-a','concurrent-b'],
  'concurrent sync must upload each event only once');
 assert.equal((await concurrent.snapshot()).queued,0);
 console.log('shared-learning sync: bounded queue, expired-event pruning, policy cache, rollback and reset pass');
})().catch(e=>{console.error(e);process.exit(1)});
