'use strict';
const assert=require('node:assert/strict');
const {createSharedLearningSync}=require('./shared-learning-sync.js');
const protocol=require('./shared-learning-protocol.js');
(async()=>{
 let state={};const storage={async get(){return state},async set(v){state={...state,...v}}};
 let uploaded=[];let fetched=0;const now=1800000000000;
 const sync=createSharedLearningSync({storage,clock:()=>now,schedule:()=>0,cancelSchedule:()=>{},
  uploadEvents:async batch=>{uploaded.push(...batch)},fetchPolicy:async()=>{fetched++;return {schemaVersion:1,policyVersion:2,issuedAt:now-1,expiresAt:now+60000,enabled:false,rollbackVersion:0,contexts:{}}}});
 for(let i=0;i<205;i++) await sync.record({eventId:'event-'+String(i).padStart(8,'0'),installationId:'install-12345678',browserFamily:'chrome',extensionVersion:'1.6.29',problemCode:'offline',interfaceState:'error',action:'wait',durationMs:1,attempt:0,outcome:'success',policyVersion:0,observedAt:now});
 assert.equal((await sync.snapshot()).queued,200);
 await sync.sync();assert.equal(uploaded.length,25);assert.equal(fetched,1);
 let snap=await sync.snapshot();assert.equal(snap.policyVersion,2);assert.equal(snap.queued,175);
 await sync.rollback();snap=await sync.snapshot();assert.equal(snap.policyVersion,0);
 await sync.reset();snap=await sync.snapshot();assert.equal(snap.queued,0);assert.deepEqual(snap.policy,protocol.BUILT_IN_POLICY);
 console.log('shared-learning sync: bounded queue, policy cache, rollback and reset pass');
})().catch(e=>{console.error(e);process.exit(1)});
