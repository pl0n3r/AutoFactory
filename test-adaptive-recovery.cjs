'use strict';const assert=require('node:assert/strict');const {chooseRecovery}=require('./adaptive-recovery.js');
const base={problemCode:'conversation-unavailable',interfaceState:'error',isResponding:false,attempt:1,defaults:{action:'reload'},mode:'enforce',policy:{enabled:true,policyVersion:4,expiresAt:2000,contexts:{'conversation-unavailable:error':{action:'retry',confidence:.9,successRate:.9,samples:25}}},now:1000,replacementOpened:false};
assert.equal(chooseRecovery(base).action,'retry');
assert.equal(chooseRecovery({...base,isResponding:true}).action,'wait');
assert.equal(chooseRecovery({...base,policy:{...base.policy,contexts:{'conversation-unavailable:error':{action:'retry',confidence:.7,successRate:.9,samples:25}}}}).action,'reload');
const observed=chooseRecovery({...base,mode:'observe'});assert.equal(observed.action,'reload');assert.equal(observed.recommendedAction,'retry');
assert.equal(chooseRecovery({...base,policy:{...base.policy,contexts:{'conversation-unavailable:error':{action:'open_replacement_chat',confidence:.9,successRate:.9,samples:25}}},replacementOpened:true}).action,'reload');
assert.equal(chooseRecovery({...base,now:3000}).source,'default');
console.log('adaptive recovery: confidence, observation and safety invariants pass');
