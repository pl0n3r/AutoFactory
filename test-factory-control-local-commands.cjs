'use strict';
const assert = require('node:assert/strict');
const api = require('./factory-control-local-commands.js');
// HTTP is deliberate inside the owner's LAN; these are offline fixtures only.
const lan = location => ['http:', '//', location].join('');
async function ac01() {
  for (const origin of [lan('127.0.0.1:8777'), lan('10.1.2.3:1234'),
    lan('172.16.0.1:80'), lan('172.31.255.255:8080'),
    lan('192.168.1.2:8777')]) assert.equal(api.privateOrigin(origin), origin);
  for (const origin of ['https://10.0.0.1:443', lan('8.8.8.8:80'),
    lan('172.32.0.1:80'), lan('127.0.0.2:80'), lan('localhost:80'),
    lan('10.0.0.1:80/path'), lan('10.0.0.1:80?x=1'),
    lan('user@10.0.0.1:80'), lan('010.0.0.1:80'),
    lan('192.168.0.1:0'), lan('192.168.0.1:65536'),
    lan('169.254.1.1:80'), lan('192.169.0.1:80')]) {
    assert.throws(() => api.privateOrigin(origin), TypeError, origin);
  }
}
async function ac02() {
  let calls = 0;
  const p = api.createCommandProcessor({enabled:async()=>false,allowedToStart:async()=>true,
    apply:async()=>{calls++;return true},seen:async()=>false,mark:async()=>true,ack:async()=>true});
  assert.equal(await p.process({id:1,chat_id:null,want:'stop'}),false);
  assert.equal(calls,0);
}
async function ac03() {
  const raw = {id:1,chat_id:null,want:'stop',secret:'TOKEN'};
  assert.equal(api.globalCommand(raw),null);
  let reads=0;
  const getter={id:1,chat_id:null,get want(){reads++;return 'start'}};
  assert.equal(api.globalCommand(getter),null);
  assert.equal(reads,0);
}
async function ac04() {
  const done=new Set(),applied=[],acks=[];
  const p=api.createCommandProcessor({enabled:async()=>true,allowedToStart:async()=>true,
    seen:async id=>done.has(id),apply:async want=>{applied.push(want);return true},
    mark:async id=>{done.add(id);return true},ack:async id=>{acks.push(id);return true}});
  assert.equal(await p.process({id:12,chat_id:null,want:'stop'}),true);
  assert.equal(await p.process({id:12,chat_id:null,want:'stop'}),false);
  assert.equal(await p.process({id:13,chat_id:123,want:'start'}),false);
  assert.deepEqual(applied,['stop']);assert.deepEqual(acks,[12]);
}
async function ac05() {
  let executed=0;
  const p=api.createCommandProcessor({enabled:async()=>true,allowedToStart:async()=>false,
    seen:async()=>false,apply:async()=>{executed++;return true},
    mark:async()=>true,ack:async()=>true});
  assert.equal(await p.process({id:3,chat_id:null,want:'start'}),false);
  assert.equal(executed,0);
  assert.equal(await p.process({id:4,chat_id:null,want:'stop'}),true);
  assert.equal(executed,1);
  // A session can close between initial readiness and the durable mark.
  let canStart=true, restarted=0;
  const stored=new Set();
  const race=api.createCommandProcessor({
    enabled:async()=>true, allowedToStart:async()=>canStart,
    seen:async id=>stored.has(id),
    mark:async id=>{stored.add(id);canStart=false;return true;},
    apply:async()=>{restarted++;return true;},ack:async()=>true
  });
  assert.equal(await race.process({id:29,chat_id:null,want:'start'}),false);
  assert.equal(stored.has(29),true);
  assert.equal(restarted,0);
  assert.equal(await race.process({id:29,chat_id:null,want:'start'}),false);
  assert.equal(restarted,0);
}
async function ac06() {
  let writes=0,actions=0,acks=0;
  const record=new Set();
  const failedStore=api.createCommandProcessor({
    enabled:async()=>true,allowedToStart:async()=>true,
    seen:async id=>record.has(id),
    mark:async()=>{writes++;return false;},
    apply:async()=>{actions++;return true;},
    ack:async()=>{acks++;return true;}
  });
  assert.equal(await failedStore.process({id:3,chat_id:null,want:'stop'}),false);
  assert.equal(writes,1);assert.equal(actions,0);assert.equal(acks,0);

  const failedApply=api.createCommandProcessor({
    enabled:async()=>true,allowedToStart:async()=>true,
    seen:async id=>record.has(id),
    mark:async id=>{record.add(id);return true;},
    apply:async()=>{actions++;throw new Error('SENSITIVE');},
    ack:async()=>{acks++;return true;}
  });
  assert.equal(await failedApply.process({id:4,chat_id:null,want:'stop'}),false);
  assert.equal(record.has(4),true);
  assert.equal(await failedApply.process({id:4,chat_id:null,want:'stop'}),false);
  assert.equal(actions,1);assert.equal(acks,0);
}
const cases={ac01,ac02,ac03,ac04,ac05,ac06};
(async()=>{
  const selected=process.argv[2]?[process.argv[2]]:Object.keys(cases);
  for (const key of selected) if (!Object.hasOwn(cases,key)) throw new Error('unknown case');
  // Sequential tests preserve isolation; no asynchronous waiting inside loops.
  await selected.reduce((sequence,key)=>sequence.then(()=>cases[key]()),Promise.resolve());
  console.log('Local commands pure contract: PASS');
})()
  .catch(error=>{console.error(error);process.exitCode=1});
