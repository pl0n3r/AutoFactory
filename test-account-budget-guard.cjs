 'use strict';
 const assert = require('node:assert/strict');
 const fs = require('node:fs');
 const { JSDOM } = require('jsdom');
 
 function readySnapshot(nextAllowedAt = null) {
   return {
     windowMs: 3600000,
     budget: 40,
     sent: nextAllowedAt ? 1 : 0,
     remaining: nextAllowedAt ? 39 : 40,
     limitEvents: 0,
     highReasoningSends: nextAllowedAt ? 1 : 0,
     nextAllowedAt,
     source: 'default'
   };
 }
 
 async function flush() {
   await Promise.resolve();
   await Promise.resolve();
 }
 
 (async () => {
   const dom = new JSDOM('<!doctype html><button id="send">Send</button>', {
     url: 'https://chatgpt.com/', runScripts: 'outside-only'
   });
   const { window } = dom;
   const button = window.document.getElementById('send');
   let fakeNow = 100000;
   window.Date.now = () => fakeNow;
   window.setInterval = () => 0;
   window.setTimeout = (callback, milliseconds = 0) => {
     fakeNow += Math.max(0, Number(milliseconds) || 0);
     void Promise.resolve().then(callback);
     return 0;
   };
 
   let storageReply = null;
   let consumeCalls = 0;
   let statusCalls = 0;
   let clickEvents = 0;
   button.addEventListener('click', () => { clickEvents += 1; });
 
   window.ChatGPTAutopilotCore = {
     canSend: candidate => candidate === button && !candidate.disabled,
     pageSignal: () => ({ code: 'ready', action: 'continue' }),
     sendButton: () => button
   };
   window.chrome = {
     runtime: {
       lastError: null,
       sendMessage(message, reply) {
         if (message.type === 'autopilot:budget-status') {
           statusCalls += 1;
           reply({ ok: true, snapshot: readySnapshot() });
         } else if (message.type === 'autopilot:budget-consume') {
           consumeCalls += 1;
           reply({
             ok: true,
             allowed: true,
             snapshot: readySnapshot(fakeNow + 90000)
           });
         } else if (message.type === 'autopilot:budget-limit') {
           reply({ ok: true, snapshot: readySnapshot(fakeNow + 90000) });
         }
       }
     },
     storage: {
       local: {
         get(_defaults, reply) { storageReply = reply; },
         set(_values, reply) { reply?.(); }
       },
       onChanged: { addListener() {} }
     }
   };
 
   window.eval(fs.readFileSync('./account-budget-guard.js', 'utf8'));
   assert.equal(window.ChatGPTAutopilotCore.canSend(button), false,
     'guard must fail closed before storage initializes');
 
   const pacingUntil = fakeNow + 90000;
   storageReply({
     masterEnabled: true,
     accountBudgetEnabled: false,
     reasoningLevel: 'high',
     accountBudgetSnapshotV1: readySnapshot(pacingUntil)
   });
   const guard = window.ChatGPTAutopilotBudgetGuard;
   assert.equal(window.ChatGPTAutopilotCore.canSend(button), true,
     'shared budget must not block sends when disabled');
   assert.equal(await guard.waitUntilReady(), true,
     'disabled shared budget must resolve immediately');
 
   storageReply({
     masterEnabled: true,
     accountBudgetEnabled: true,
     reasoningLevel: 'high',
     accountBudgetSnapshotV1: readySnapshot(pacingUntil)
   });
 
   assert.ok(guard && typeof guard.waitUntilReady === 'function');
   assert.equal(guard.nextAllowedAt(), pacingUntil);
   assert.equal(await guard.waitUntilReady(), true,
     'a long shared-budget delay must resolve as normal pacing');
   assert.ok(fakeNow >= pacingUntil,
     'test clock must cross the full ninety-second pacing window');
   assert.equal(consumeCalls, 0,
     'waiting for budget must not consume a slot before content is ready to send');
   assert.equal(clickEvents, 0,
     'waiting for budget must never click the provider send control');
   assert.equal(statusCalls, 1,
     'budget state is refreshed once when the pacing window expires');
 
   assert.equal(window.ChatGPTAutopilotCore.canSend(button), false,
     'first readiness check should consume shared capacity asynchronously');
   await flush();
   assert.equal(consumeCalls, 1);
   assert.equal(window.ChatGPTAutopilotCore.canSend(button), true,
     'next readiness check should expose the preauthorized send');
 
   button.click();
   assert.equal(clickEvents, 1, 'authorized programmatic click must remain synchronous');
   button.click();
   assert.equal(clickEvents, 1, 'a second click without authorization must be blocked');
   assert.equal(consumeCalls, 1, 'blocked second click must not bypass the shared budget');
 
   console.log('account-budget-guard: long pacing waits without failure or premature click');
 })().catch(error => {
   console.error(error);
   process.exitCode = 1;
 });
 