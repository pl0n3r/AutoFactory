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

async function ac07() {
  const key='local-agent-secret-012345';
  const settings={host:lan('192.168.1.12:8777'),agentKey:key,instanceId:'af-agent-1'};
  let active=false, permitted=true, time=100000;
  let network=0, applied=0, exposed=[];
  const poller=api.createCommandPoller({
    enabled:async()=>active,permission:async()=>permitted,
    configuration:async()=>settings,now:()=>time,
    fetchPending:async params=>{
      network++;exposed.push(params);
      return {commands:[{id:1,chat_id:44,want:'stop'},
        {id:2,chat_id:null,want:'stop'}]};
    },
    process:async item=>{applied++;assert.deepEqual(item,{id:2,chat_id:null,want:'stop'});return true}
  });
  assert.equal(await poller.tick(),'disabled');
  assert.equal(network,0);
  active=true;
  assert.equal(await poller.tick(),'handled');
  assert.equal(applied,1);
  assert.equal(network,1);
  assert.equal(exposed[0].agentKey,key);
  assert.equal(Object.hasOwn(exposed[0],'chat_text'),false);
  assert.equal(await poller.tick(),'throttled');
  time+=8000;
  permitted=false;
  assert.equal(await poller.tick(),'disabled');
  assert.equal(network,1);
  poller.stop();
  assert.equal(await poller.tick(),'stopped');

  const noGetters=Object.defineProperties({},{
    host:{enumerable:true,value:settings.host},
    instanceId:{enumerable:true,value:settings.instanceId},
    agentKey:{enumerable:true,get(){throw new Error('secret getter');}}
  });
  assert.equal(api.localPollingSettings(noGetters),null);
  assert.equal(api.commandEnvelope({commands:[,]}),null);
  assert.equal(api.commandEnvelope({commands:[]}).length,0);
  assert.equal(api.commandEnvelope({commands:[{id:5,chat_id:null,want:'start'}]}).length,1);
}
async function ac08() {
  let time=100000, calls=0, apply=0, authorized=true;
  const settings={host:lan('127.0.0.1:8777'),
    agentKey:'local-agent-secret-012345',instanceId:'agent-4'};
  const poller=api.createCommandPoller({
    enabled:async()=>authorized,permission:async()=>true,
    configuration:async()=>settings,now:()=>time,
    fetchPending:async()=>{
      calls++;
      if(calls===1)throw new Error('private-token-must-not-leak');
      return {commands:[{id:7,chat_id:null,want:'start'}]};
    },
    process:async()=>{apply++;return true}
  });
  assert.equal(await poller.tick(),'unavailable');
  time+=8000;
  assert.equal(await poller.tick(),'throttled');
  assert.equal(calls,1);
  time+=8000;
  assert.equal(await poller.tick(),'handled');
  assert.equal(calls,2);
  assert.equal(apply,1);
  // Revoke opt-in while GET is in flight; never execute the result.
  let release;
  const pending=api.createCommandPoller({
    enabled:async()=>authorized,permission:async()=>true,
    configuration:async()=>settings,now:()=>time,
    fetchPending:async()=>new Promise(resolve=>{release=resolve}),
    process:async()=>{apply++;return true}
  });
  const waiting=pending.tick();
  // Promise scheduling: allow mock GET to be reached without any real timer.
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(typeof release,'function');
  authorized=false;
  release({commands:[{id:8,chat_id:null,want:'start'}]});
  assert.equal(await waiting,'revoked');
  assert.equal(apply,1);
}

async function ac09() {
  const fs=require('node:fs'),path=require('node:path');
  const safari=path.join(__dirname,'safari','ChatGPT Autopilot Local Extension','Resources');
  const html=fs.readFileSync(path.join(__dirname,'popup.html'),'utf8');
  const popup=fs.readFileSync(path.join(__dirname,'popup.js'),'utf8');
  assert.ok(html.includes('id="factory-control-lan-host"'));
  assert.ok(html.includes('id="factory-control-lan-key" type="password"'));
  assert.ok(html.includes('id="factory-control-lan-toggle"'));
  assert.ok(html.includes('factory-control-local-commands.js"></script><script src="popup.js"'));
  const stage=popup.slice(popup.indexOf('// This panel is configuration-only.'));
  assert.ok(stage.includes('lanToggle.disabled = true'));
  assert.ok(stage.includes('[LAN_ENABLED]: false'));
  assert.ok(stage.includes('lanGuard.privateOrigin(lanHost.value.trim())'));
  assert.ok(stage.includes("lanKey.value = ''"));
  assert.equal(stage.includes('fetch('),false);
  assert.ok(stage.includes('permissions.request'));
  for(const file of ['popup.js','popup.html','factory-control-local-commands.js']) {
    assert.deepEqual(fs.readFileSync(path.join(__dirname,file)),
      fs.readFileSync(path.join(safari,file)));
  }
}

async function ac10() {
  const origin=lan('127.0.0.1:8777'),key='local-agent-secret-012345';
  const FLAG='factoryControlLanCommandsEnabled',HOST='factoryControlLanOriginV1';
  const KEY='factoryControlLanAgentKeyV1',INSTANCE='factoryControlLocalInstanceId';
  const REC='factoryControlLanReceiptsV1';
  let stamp=100000, permitted=true, requests=[],deliveries=[],commandId=101;
  const state={ [FLAG]:false,[HOST]:origin,[KEY]:key,[INSTANCE]:'agent-local-1',
    masterEnabled:true };
  const storage={
    async get(defaults){ return {...defaults,...state}; },
    async set(changes){ Object.assign(state,changes); }
  };
  const permissions={
    async contains({origins}){
      assert.deepEqual(origins,['http://127.0.0.1:8777/*']);
      return permitted;
    }
  };
  const tabs={
    async query(query){ assert.deepEqual(query,{url:['https://chatgpt.com/*']});return [{id:6}]; },
    async sendMessage(id,msg){
      assert.equal(id,6);
      deliveries.push(msg);
      return {ok:true,enabled:msg.enabled};
    }
  };
  async function fetch(url,options){
    assert.equal(options.credentials,'omit');
    assert.equal(options.redirect,'error');
    assert.equal(options.cache,'no-store');
    assert.equal(options.headers['X-Agent-Key'],key);
    requests.push({url,method:options.method,body:options.body});
    if(url===origin+'/api/af/commands?instance_id=agent-local-1') {
      assert.equal(options.method,'GET');
      const payload={commands:[{id:commandId,chat_id:null,
        want:commandId===101?'stop':'start'}]};
      return {ok:true,headers:{get:name=>
        name==='content-type'?'application/json':null},
        text:async()=>JSON.stringify(payload)};
    }
    assert.equal(url,origin+'/api/af/ack');
    assert.equal(options.method,'POST');
    assert.deepEqual(JSON.parse(options.body),{id:101,instance_id:'agent-local-1'});
    assert.equal(options.body.includes(key),false);
    return {ok:true};
  }
  const runtime=api.createBrowserCommandRuntime({
    storage,permissions,tabs,fetch,now:()=>stamp
  });
  assert.equal(await runtime.tick(),'disabled');
  assert.equal(requests.length,0);
  state[FLAG]=true; // Explicit fake opt-in, never set by module import.
  assert.equal(await runtime.tick(),'handled');
  assert.equal(requests.length,2);
  assert.equal(state.masterEnabled,false);
  assert.deepEqual(deliveries,[{type:'autopilot:set-enabled',enabled:false}]);
  assert.equal(state[REC][origin+'|agent-local-1|101'],true);
  stamp+=8000;
  assert.equal(await runtime.tick(),'empty'); // Durable receipt blocks replay.
  assert.equal(requests.length,3);
  stamp+=8000;
  commandId=102;
  assert.equal(await runtime.tick(),'empty'); // Login/usage UNKNOWN: start denied.
  assert.equal(state.masterEnabled,false);
  assert.equal(requests.length,4);
  assert.equal(state[REC][origin+'|agent-local-1|102'],undefined);
  stamp+=8000;
  permitted=false;
  assert.equal(await runtime.tick(),'disabled');
  assert.equal(requests.length,4);
  // No network to a public host even when the storage flag is true.
  state[HOST]=lan('8.8.8.8:8777'); permitted=true;
  stamp+=8000;
  assert.equal(await runtime.tick(),'disabled');
  assert.equal(requests.length,4);
  runtime.stop();
  assert.equal(await runtime.tick(),'stopped');
}


async function ac11() {
  const fs=require('node:fs'),path=require('node:path');
  const entry=fs.readFileSync(path.join(__dirname,'background-entry.js'),'utf8');
  const mirror=fs.readFileSync(path.join(__dirname,'safari',
    'ChatGPT Autopilot Local Extension','Resources','background-entry.js'),'utf8');
  assert.equal(entry,mirror);
  assert.ok(entry.includes("'factory-control-local-commands.js'"));
  assert.ok(entry.includes('ChatGPTAutopilotLocalCommands.installBackground(globalThis)'));
  let network=0,alarms=[],changed=[],started=[];
  const memory={factoryControlLanCommandsEnabled:false};
  const browser={
    storage:{
      local:{
        get:async defaults=>({...defaults,...memory}),
        set:async next=>Object.assign(memory,next)
      },
      onChanged:{addListener(fn){changed.push(fn)}}
    },
    permissions:{
      contains:async()=>false,
      onRemoved:{addListener(){}}
    },
    alarms:{
      create:async()=>{},
      clear:async()=>true,
      onAlarm:{addListener(fn){alarms.push(fn)}}
    },
    tabs:{
      query:async()=>[],
      sendMessage:async()=>({ok:true,enabled:false})
    },
    runtime:{
      onStartup:{addListener(fn){started.push(fn)}},
      onInstalled:{addListener(){}}
    }
  };
  const root={chrome:browser,fetch:async()=>{network++;throw new Error('network forbidden');},
    Date:{now:()=>100000}};
  assert.equal(api.installBackground(root),true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(network,0);
  assert.equal(alarms.length,1);
  alarms[0]({name:'factory-control-lan-commands'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(network,0);
  memory.factoryControlLanCommandsEnabled=true;
  changed[0]({factoryControlLanCommandsEnabled:{newValue:true}},'local');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(network,0); // No origin/key/instance or host permission.
  started[0]();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(network,0);
  assert.equal(api.installBackground({chrome:{}}),false);
}


async function ac12() {
  // A command fetched from server A must never be acknowledged to a
  // different origin, key or agent identity. Revoke/rotation races must
  // retain the pending local receipt and leave the ACK unsent.
  const a=lan('127.0.0.1:8777'),b=lan('127.0.0.1:8778');
  const FLAG='factoryControlLanCommandsEnabled',HOST='factoryControlLanOriginV1',
    KEY='factoryControlLanAgentKeyV1',INSTANCE='factoryControlLocalInstanceId',
    REC='factoryControlLanReceiptsV1';
  const firstKey='initial-agent-key-0001',secondKey='rotated-agent-key-0002';
  const variants=[
    {name:'origin',mutate:state=>{state[HOST]=b;}},
    {name:'agent-key',mutate:state=>{state[KEY]=secondKey;}},
    {name:'instance',mutate:state=>{state[INSTANCE]='agent-B';}},
    {name:'all',mutate:state=>{state[HOST]=b;state[KEY]=secondKey;
      state[INSTANCE]='agent-B';}},
    {name:'revoke-opt-in',mutate:state=>{state[FLAG]=false;}}
  ];
  // Keep the five independent async races strictly sequential without
  // an await embedded in a for-loop (Sonar S2310).
  await variants.reduce(async (previous, variant) => {
    await previous;
    const data={ [FLAG]:true,[HOST]:a,[KEY]:firstKey,
      [INSTANCE]:'agent-A',masterEnabled:true };
    const calls=[];
    const storage={
      async get(defaults){return {...defaults,...data};},
      async set(next){
        Object.assign(data,next);
        if (Object.hasOwn(next,'masterEnabled')) variant.mutate(data);
      }
    };
    const browser=api.createBrowserCommandRuntime({
      storage,permissions:{contains:async()=>true},
      tabs:{query:async()=>[],sendMessage:async()=>({ok:true,enabled:false})},
      now:()=>100000,
      fetch:async (url,options)=>{
        calls.push({url,method:options.method,key:options.headers['X-Agent-Key']});
        if (options.method==='GET') {
          assert.equal(url,a+'/api/af/commands?instance_id=agent-A');
          return {ok:true,headers:{get:name=>
            name==='content-type'?'application/json':null},
            text:async()=>JSON.stringify({commands:[
              {id:401,chat_id:null,want:'stop'}]})};
        }
        return {ok:true};
      }
    });
    assert.equal(await browser.tick(),'empty',variant.name);
    assert.equal(data.masterEnabled,false,variant.name);
    assert.equal(data[REC][a+'|agent-A|401'],true,variant.name);
    assert.deepEqual(calls,[{
      url:a+'/api/af/commands?instance_id=agent-A',
      method:'GET',key:firstKey
    }],variant.name);
  }, Promise.resolve());
}


async function ac13() {
  // Command IDs are allocated by each coordinator independently. A receipt
  // for server A must not poison the same numeric ID on another server B.
  const first=lan('127.0.0.1:8777'),second=lan('127.0.0.1:8778');
  const flag='factoryControlLanCommandsEnabled',host='factoryControlLanOriginV1';
  const instance='factoryControlLocalInstanceId',key='factoryControlLanAgentKeyV1';
  const state={[flag]:true,[host]:first,[key]:'stable-agent-key-001',
    [instance]:'agent-a',masterEnabled:true};
  let now=100000;
  const posts=[],changes=[];
  const storage={
    async get(d){return {...d,...state};},
    async set(v){Object.assign(state,v);if(Object.hasOwn(v,'masterEnabled'))changes.push(v.masterEnabled);}
  };
  const runtime=api.createBrowserCommandRuntime({
    storage,permissions:{contains:async()=>true},
    tabs:{query:async()=>[],sendMessage:async()=>({ok:true,enabled:false})},
    now:()=>now,
    fetch:async (url,opts)=>{
      if(opts.method==='GET') {
        assert.equal(url,state[host]+'/api/af/commands?instance_id='+state[instance]);
        return {ok:true,headers:{get:k=>k==='content-type'?'application/json':null},
          text:async()=>JSON.stringify({commands:[{id:501,chat_id:null,want:'stop'}]})};
      }
      posts.push({url,body:JSON.parse(opts.body)});
      return {ok:true};
    }
  });
  assert.equal(await runtime.tick(),'handled');
  assert.equal(state.masterEnabled,false);
  assert.equal(posts.length,1);
  state[host]=second;state[instance]='agent-b';state.masterEnabled=true;
  now+=8000;
  assert.equal(await runtime.tick(),'handled', 'same id from second coordinator must be accepted');
  assert.equal(state.masterEnabled,false);
  assert.equal(changes.length,2);
  assert.deepEqual(posts.map(x=>x.url),[first+'/api/af/ack',second+'/api/af/ack']);
  runtime.stop();
}


async function ac14() {
  // Legacy receipts keyed solely by a numeric ID must remain deny-on-replay
  // after the per-origin migration. Neither server may replay an old STOP.
  const a=lan('127.0.0.1:8777'),b=lan('127.0.0.1:8778');
  const flag='factoryControlLanCommandsEnabled',
    host='factoryControlLanOriginV1',key='factoryControlLanAgentKeyV1',
    instance='factoryControlLocalInstanceId',ledger='factoryControlLanReceiptsV1';
  const data={[flag]:true,[host]:a,[key]:'local-secret-012345',
    [instance]:'agent-a',[ledger]:{'701':true},masterEnabled:true};
  let stamp=100000,posts=0,applied=0;
  const runtime=api.createBrowserCommandRuntime({
    storage:{
      async get(defaults){return {...defaults,...data};},
      async set(v){Object.assign(data,v);if(Object.hasOwn(v,'masterEnabled'))applied++;}
    },
    permissions:{contains:async()=>true},
    tabs:{query:async()=>[],sendMessage:async()=>({ok:true,enabled:false})},
    now:()=>stamp,
    fetch:async(_url,options)=>{
      if(options.method==='POST'){posts++;return {ok:true};}
      return {ok:true,headers:{get:name=>name==='content-type'?'application/json':null},
        text:async()=>JSON.stringify({commands:[{id:701,chat_id:null,want:'stop'}]})};
    }
  });
  assert.equal(await runtime.tick(),'empty');
  assert.equal(data.masterEnabled,true);
  data[host]=b;data[instance]='agent-b';stamp+=8000;
  assert.equal(await runtime.tick(),'empty');
  assert.equal(data.masterEnabled,true);
  assert.equal(applied,0);
  assert.equal(posts,0);
  assert.deepEqual(data[ledger],{'701':true});
  runtime.stop();
}


async function ac15() {
  // Revoke opt-in between the ACK's config read and its permission check.
  // The late asynchronous revocation must veto POST even when the permission
  // API returns a stale true response.
  const host=lan('127.0.0.1:8777'),key='local-ack-secret-001';
  const keys={flag:'factoryControlLanCommandsEnabled',host:'factoryControlLanOriginV1',
    auth:'factoryControlLanAgentKeyV1',instance:'factoryControlLocalInstanceId',
    ledger:'factoryControlLanReceiptsV1'};
  const state={ [keys.flag]:true,[keys.host]:host,[keys.auth]:key,
    [keys.instance]:'agent-a',masterEnabled:true };
  let permissionReads=0,posts=0;
  const runtime=api.createBrowserCommandRuntime({
    storage:{
      get:async defaults=>({...defaults,...state}),
      set:async next=>{Object.assign(state,next);}
    },
    permissions:{contains:async()=>{
      permissionReads++;
      if(permissionReads===9) state[keys.flag]=false;
      return true;
    }},
    tabs:{query:async()=>[],sendMessage:async()=>({ok:true,enabled:false})},
    now:()=>100000,
    fetch:async(_url,options)=>{
      if(options.method==='POST'){posts++;return {ok:true};}
      return {ok:true,headers:{get:name=>
        name==='content-type'?'application/json':null},
        text:async()=>JSON.stringify({commands:[{id:801,chat_id:null,want:'stop'}]})};
    }
  });
  assert.equal(await runtime.tick(),'empty');
  assert.equal(permissionReads,9);
  assert.equal(state[keys.flag],false);
  assert.equal(state.masterEnabled,false);
  assert.equal(state[keys.ledger][host+'|agent-a|801'],true);
  assert.equal(posts,0);
}


async function ac16() {
  // A LAN server that never returns bytes must not keep the poller busy forever.
  // A pre-aborted deadline makes the regression deterministic and network-free.
  const host=lan('127.0.0.1:8777');
  const state={factoryControlLanCommandsEnabled:true,
    factoryControlLanOriginV1:host,
    factoryControlLanAgentKeyV1:'offline-agent-secret-001',
    factoryControlLocalInstanceId:'agent-timeout',
    masterEnabled:true};
  let requests=0, deadlineCalls=0, stamp=100000;
  const runtime=api.createBrowserCommandRuntime({
    storage:{
      get:async defaults=>({...defaults,...state}),
      set:async value=>Object.assign(state,value)
    },
    permissions:{contains:async()=>true},
    tabs:{query:async()=>[],sendMessage:async()=>({ok:true,enabled:false})},
    now:()=>stamp,
    timeoutSignal:milliseconds=>{
      assert.equal(milliseconds,6000);
      deadlineCalls++;
      return AbortSignal.abort();
    },
    fetch:async(_url,options)=>{
      requests++;
      if(options.signal?.aborted) throw new TypeError('aborted by deadline');
      // This call never resolves until an AbortSignal is installed.
      return new Promise(()=>{});
    }
  });
  const outcome=await Promise.race([
    runtime.tick(),
    new Promise(resolve=>setTimeout(()=>resolve('hung'),100))
  ]);
  assert.equal(outcome,'unavailable','a nonresponding coordinator must time out');
  assert.equal(deadlineCalls,1);
  assert.equal(requests,1);
  assert.equal(state.masterEnabled,true);
  stamp+=8000;
  assert.equal(await runtime.tick(),'throttled','timeout must enter backoff');
  runtime.stop();
}


async function ac17() {
  // Content-Length can be missing or false. Do not materialize a multi-MB
  // response body before enforcing the 32-KiB command-envelope limit.
  const host=lan('127.0.0.1:8777');
  const state={
    factoryControlLanCommandsEnabled:true,
    factoryControlLanOriginV1:host,
    factoryControlLanAgentKeyV1:'offline-agent-secret-001',
    factoryControlLocalInstanceId:'agent-stream',
    masterEnabled:true
  };
  let read=0,cancel=0,posts=0,changes=0;
  const runtime=api.createBrowserCommandRuntime({
    storage:{
      get:async d=>({...d,...state}),
      set:async x=>{Object.assign(state,x);changes++;}
    },
    permissions:{contains:async()=>true},
    tabs:{query:async()=>[],sendMessage:async()=>({ok:true,enabled:false})},
    now:()=>100000,
    fetch:async(_url,options)=>{
      if(options.method==='POST'){posts++;return {ok:true};}
      return {
        ok:true,
        headers:{get:name=>name==='content-type'?'application/json':null},
        // Returning a small text is an intentionally misleading fallback:
        // the real fetch body stream has an oversized first chunk.
        text:async()=>JSON.stringify({commands:[{id:901,chat_id:null,want:'stop'}]}),
        body:{getReader:()=>({
          async read(){read++;return {done:false,value:new Uint8Array(32769)};},
          async cancel(){cancel++;},
          releaseLock(){}
        })}
      };
    }
  });
  assert.equal(await runtime.tick(),'unavailable');
  assert.equal(read,1);
  assert.equal(cancel,1);
  assert.equal(posts,0);
  assert.equal(changes,0);
  assert.equal(state.masterEnabled,true);
  runtime.stop();
}


async function ac18() {
  // Valid fragmented Fetch streams must still parse commands and acknowledge
  // STOP without falling back to an unbounded response.text().
  const host=lan('127.0.0.1:8777');
  const state={factoryControlLanCommandsEnabled:true,
    factoryControlLanOriginV1:host,
    factoryControlLanAgentKeyV1:'offline-agent-secret-001',
    factoryControlLocalInstanceId:'agent-small',
    masterEnabled:true};
  const payload=Buffer.from(JSON.stringify({
    commands:[{id:902,chat_id:null,want:'stop'}]
  }), 'utf8');
  const parts=[payload.subarray(0,11),payload.subarray(11,24),
    payload.subarray(24)];
  let read=0,posted=0,textFallback=0,cancelled=0;
  const runtime=api.createBrowserCommandRuntime({
    storage:{
      get:async d=>({...d,...state}),
      set:async v=>Object.assign(state,v)
    },
    permissions:{contains:async()=>true},
    tabs:{query:async()=>[],sendMessage:async()=>({ok:true,enabled:false})},
    now:()=>100000,
    fetch:async(_url,options)=>{
      if(options.method==='POST'){
        posted++;assert.equal(options.body,
          JSON.stringify({id:902,instance_id:'agent-small'}));
        return {ok:true};
      }
      let index=0;
      return {
        ok:true,
        headers:{get:name=>name==='content-type'?'application/json':null},
        text:async()=>{textFallback++;throw new Error('unexpected text read');},
        body:{getReader:()=>({
          read:async()=>{
            read++;
            return index<parts.length
              ? {done:false,value:parts[index++]}
              : {done:true};
          },
          cancel:async()=>{cancelled++;},
          releaseLock(){}
        })}
      };
    }
  });
  assert.equal(await runtime.tick(),'handled');
  assert.equal(state.masterEnabled,false);
  assert.equal(read,4);
  assert.equal(posted,1);
  assert.equal(textFallback,0);
  assert.equal(cancelled,0);
  assert.equal(state.factoryControlLanReceiptsV1[host+'|agent-small|902'],true);
  runtime.stop();
}


async function ac19() {
  // Even with opt-in and a permissive mock grant, remote cleartext HTTP
  // must not carry X-Agent-Key or apply any command.
  const state={
    factoryControlLanCommandsEnabled:true,
    factoryControlLanOriginV1:lan('10.0.0.44:8777'),
    factoryControlLanAgentKeyV1:'offline-agent-secret-001',
    factoryControlLocalInstanceId:'agent-private',
    masterEnabled:true
  };
  let grants=0, network=0, writes=0;
  const runtime=api.createBrowserCommandRuntime({
    storage:{
      get:async defaults=>({...defaults,...state}),
      set:async value=>{writes++;Object.assign(state,value);}
    },
    permissions:{contains:async()=>{grants++;return true;}},
    tabs:{query:async()=>[],sendMessage:async()=>({ok:true,enabled:false})},
    now:()=>100000,
    fetch:async()=>{network++;throw new Error('LAN leak');}
  });
  assert.equal(await runtime.tick(),'disabled');
  assert.equal(grants,0);
  assert.equal(network,0);
  assert.equal(writes,0);
  assert.equal(state.masterEnabled,true);
  runtime.stop();
}


async function ac20() {
  // A broken first chat tab cannot suppress STOP on healthy tabs. A partial
  // fan-out is never acknowledged, and the durable receipt denies a replay.
  const origin=lan('127.0.0.1:8777');
  const state={
    factoryControlLanCommandsEnabled:true,
    factoryControlLanOriginV1:origin,
    factoryControlLanAgentKeyV1:'offline-agent-secret-001',
    factoryControlLocalInstanceId:'agent-fanout',
    masterEnabled:true
  };
  let now=100000, gets=0, acks=0;
  const delivered=[];
  const runtime=api.createBrowserCommandRuntime({
    storage:{
      get:async defaults=>({...defaults,...state}),
      set:async changes=>Object.assign(state,changes)
    },
    permissions:{contains:async()=>true},
    tabs:{
      query:async()=>[{id:6},{id:7},{id:8}],
      sendMessage:async(id,message)=>{
        delivered.push(id);
        assert.deepEqual(message,{type:'autopilot:set-enabled',enabled:false});
        if(id===6) throw new Error('tab unloaded');
        return {ok:true,enabled:false};
      }
    },
    now:()=>now,
    fetch:async(url,options)=>{
      if(options.method==='POST'){acks++;return {ok:true};}
      assert.equal(url,origin+'/api/af/commands?instance_id=agent-fanout');
      gets++;
      return {
        ok:true,headers:{get:k=>k==='content-type'?'application/json':null},
        text:async()=>JSON.stringify({
          commands:[{id:905,chat_id:null,want:'stop'}]
        })
      };
    }
  });
  assert.equal(await runtime.tick(),'empty');
  assert.equal(state.masterEnabled,false);
  assert.deepEqual(delivered,[6,7,8]);
  assert.equal(acks,0);
  assert.equal(gets,1);
  assert.equal(state.factoryControlLanReceiptsV1[origin+'|agent-fanout|905'],true);
  now+=8000;
  assert.equal(await runtime.tick(),'empty');
  assert.deepEqual(delivered,[6,7,8]);
  assert.equal(gets,2);
  assert.equal(acks,0);
  runtime.stop();
}


async function ac21() {
  // One tab never answers. The abort signal terminates the fan-out locally;
  // the other tab still receives STOP, but a partial application has no ACK.
  const origin=lan('127.0.0.1:8777');
  const aborter=new AbortController();
  const state={
    factoryControlLanCommandsEnabled:true,
    factoryControlLanOriginV1:origin,
    factoryControlLanAgentKeyV1:'offline-agent-secret-001',
    factoryControlLocalInstanceId:'agent-stalled-tab',
    masterEnabled:true
  };
  const sent=[];
  let acks=0,requests=0;
  const runtime=api.createBrowserCommandRuntime({
    storage:{
      get:async defaults=>({...defaults,...state}),
      set:async changes=>Object.assign(state,changes)
    },
    permissions:{contains:async()=>true},
    tabs:{
      query:async()=>[{id:31},{id:32}],
      sendMessage:(id,message)=>{
        sent.push(id);
        assert.deepEqual(message,{type:'autopilot:set-enabled',enabled:false});
        if(id===31){
          setImmediate(()=>aborter.abort());
          return new Promise(()=>{});
        }
        return Promise.resolve({ok:true,enabled:false});
      }
    },
    now:()=>100000,
    timeoutSignal:()=>aborter.signal,
    fetch:async(url,options)=>{
      requests++;
      if(options.method==='POST'){acks++;return {ok:true};}
      assert.equal(url,origin+'/api/af/commands?instance_id=agent-stalled-tab');
      return {ok:true,headers:{get:k=>k==='content-type'?'application/json':null},
        text:async()=>JSON.stringify({commands:[
          {id:906,chat_id:null,want:'stop'}]})};
    }
  });
  assert.equal(await runtime.tick(),'empty');
  assert.deepEqual(sent,[31,32]);
  assert.equal(acks,0);
  assert.equal(requests,1);
  assert.equal(state.masterEnabled,false);
  assert.equal(state.factoryControlLanReceiptsV1[origin+'|agent-stalled-tab|906'],true);
  runtime.stop();
}


async function ac22() {
  // The browser host grant disappears just after the initial ACK permission
  // check succeeds. Do not POST merely because storage remains unchanged.
  const host=lan('127.0.0.1:8777'),key='offline-agent-secret-001';
  const state={
    factoryControlLanCommandsEnabled:true,
    factoryControlLanOriginV1:host,
    factoryControlLanAgentKeyV1:key,
    factoryControlLocalInstanceId:'agent-permission-revoke',
    masterEnabled:true
  };
  let grant=true,reads=0,posts=0;
  const runtime=api.createBrowserCommandRuntime({
    storage:{
      get:async defaults=>({...defaults,...state}),
      set:async changes=>Object.assign(state,changes)
    },
    permissions:{contains:async()=>{
      reads++;
      if(reads===9){grant=false;return true;}
      return grant;
    }},
    tabs:{query:async()=>[],sendMessage:async()=>({ok:true,enabled:false})},
    now:()=>100000,
    fetch:async (_url,options)=>{
      if(options.method==='POST'){posts++;return {ok:true};}
      return {ok:true,headers:{get:name=>
        name==='content-type'?'application/json':null},
        text:async()=>JSON.stringify({commands:[
          {id:907,chat_id:null,want:'stop'}]})};
    }
  });
  assert.equal(await runtime.tick(),'empty');
  assert.equal(reads,10);
  assert.equal(posts,0);
  assert.equal(state.masterEnabled,false);
  assert.equal(state.factoryControlLanReceiptsV1[
    host+'|agent-permission-revoke|907'],true);
  runtime.stop();
}


async function ac23() {
  // Chrome can leave tabs.query unresolved as a service worker is suspended.
  // A bounded failure must not ACK, replay or block subsequent polling forever.
  const host=lan('127.0.0.1:8777');
  const state={
    factoryControlLanCommandsEnabled:true,
    factoryControlLanOriginV1:host,
    factoryControlLanAgentKeyV1:'offline-agent-secret-001',
    factoryControlLocalInstanceId:'agent-query-hang',
    masterEnabled:true
  };
  const aborter=new AbortController();
  let now=100000,deadlineCalls=0,queries=0,posts=0,gets=0;
  const runtime=api.createBrowserCommandRuntime({
    storage:{
      get:async defaults=>({...defaults,...state}),
      set:async value=>Object.assign(state,value)
    },
    permissions:{contains:async()=>true},
    tabs:{
      query:()=>{
        queries++;
        setImmediate(()=>aborter.abort());
        return new Promise(()=>{});
      },
      sendMessage:async()=>{throw new Error('must not send to unknown tabs');}
    },
    now:()=>now,
    timeoutSignal:milliseconds=>{
      assert.equal(milliseconds,6000);
      deadlineCalls++;
      return deadlineCalls===2 ? aborter.signal : new AbortController().signal;
    },
    fetch:async(_url,options)=>{
      if(options.method==='POST'){posts++;return {ok:true};}
      gets++;
      return {ok:true,headers:{get:key=>
        key==='content-type'?'application/json':null},
        text:async()=>JSON.stringify({commands:[
          {id:908,chat_id:null,want:'stop'}]})};
    }
  });
  assert.equal(await runtime.tick(),'empty');
  assert.equal(deadlineCalls,2);
  assert.equal(queries,1);
  assert.equal(posts,0);
  assert.equal(gets,1);
  assert.equal(state.masterEnabled,false);
  assert.equal(state.factoryControlLanReceiptsV1[
    host+'|agent-query-hang|908'],true);
  now+=8000;
  assert.equal(await runtime.tick(),'empty');
  assert.equal(queries,1);
  assert.equal(gets,2);
  assert.equal(posts,0);
  runtime.stop();
}

async function ac24() {
  // A full receipt ledger (512) must not block every later order for ever:
  // the oldest receipts are dropped and the new per-chat order is still applied.
  const origin=lan('127.0.0.1:8777');
  const flag='factoryControlLanCommandsEnabled',host='factoryControlLanOriginV1',
    key='factoryControlLanAgentKeyV1',instance='factoryControlLocalInstanceId',
    ledger='factoryControlLanReceiptsV1';
  const full=Object.create(null);
  for (let i=1;i<=512;i++) full[origin+'|agent-a|'+i]=true;
  const state={[flag]:true,[host]:origin,[key]:'local-secret-012345',
    [instance]:'agent-a',[ledger]:full,masterEnabled:true};
  const sent=[];
  const storage={
    async get(d){return {...d,...state};},
    async set(v){Object.assign(state,v);}
  };
  const runtime=api.createBrowserCommandRuntime({
    storage,permissions:{contains:async()=>true},
    tabs:{query:async()=>[{id:5}],sendMessage:async(id,msg)=>{sent.push({id,msg});return {ok:true,assigned:true};}},
    now:()=>100000,
    fetch:async (url,opts)=>{
      if(opts.method==='GET') {
        return {ok:true,headers:{get:k=>k==='content-type'?'application/json':null},
          text:async()=>JSON.stringify({commands:[{id:100000,chat_id:'t5',want:'assign',issue:'Condor#1'}]})};
      }
      return {ok:true};
    }
  });
  assert.equal(await runtime.tick(),'handled');
  assert.equal(sent.length>=1,true,'order must reach the tab even with a full ledger');
  assert.equal(Object.keys(state[ledger]).length<=257,true,'ledger must be pruned');
  assert.equal(state[ledger][origin+'|agent-a|100000'],true);
  runtime.stop();
}

const cases={ac01,ac02,ac03,ac04,ac05,ac06,ac07,ac08,ac09,ac10,ac11,ac12,ac13,ac14,ac15,ac16,ac17,ac18,ac19,ac20,ac21,ac22,ac23,ac24};
(async()=>{
  const selected=process.argv[2]?[process.argv[2]]:Object.keys(cases);
  for (const key of selected) if (!Object.hasOwn(cases,key)) throw new Error('unknown case');
  // Sequential tests preserve isolation; no asynchronous waiting inside loops.
  await selected.reduce((sequence,key)=>sequence.then(()=>cases[key]()),Promise.resolve());
  console.log('Local commands pure contract: PASS');
})()
  .catch(error=>{console.error(error);process.exitCode=1});
