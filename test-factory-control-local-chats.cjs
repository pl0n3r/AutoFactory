'use strict';
const assert = require('node:assert/strict');
const commands = require('./factory-control-local-commands.js');
const publisher = require('./factory-control-local-publisher.js');

(async () => {
  // Per-chat order: opaque id accepted, numeric/forged ids rejected.
  assert.deepEqual(commands.globalCommand({ id: 5, chat_id: 't12', want: 'stop' }),
    { id: 5, chat_id: 't12', want: 'stop' });
  for (const bad of [12, 'https://chatgpt.com/c/abc', 't', 'x12', '../t1', {}])
    assert.equal(commands.globalCommand({ id: 5, chat_id: bad, want: 'stop' }), null);

  // Processor forwards chat_id to apply and acks once.
  const seen = new Set(); const applied = []; let acks = 0;
  const p = commands.createCommandProcessor({
    enabled: async () => true, allowedToStart: async () => false,
    apply: async (want, chat) => { applied.push([want, chat]); return true; },
    seen: async id => seen.has(id), mark: async id => { seen.add(id); return true; },
    ack: async () => { acks++; return true; }
  });
  assert.equal(await p.process({ id: 1, chat_id: 't7', want: 'stop' }), true);
  assert.equal(await p.process({ id: 1, chat_id: 't7', want: 'stop' }), false);
  assert.deepEqual(applied, [['stop', 't7']]);
  assert.equal(acks, 1);

  // Publisher: chats are capped at 12 and carry no free text.
  const many = Array.from({ length: 20 }, (_, i) => ({
    chat_id: 't' + i, state: 'generando', title: 'SECRETO', url: 'https://x' }));
  many.push({ chat_id: 'bad id', state: 'detenido' });
  const out = publisher.payloadFrom({ instance_id: 'af-test-1', label: 'AutoFactory',
    state: 'activo', chats_open: 20, idle_reason: 'activo', chats: many });
  assert.equal(out.chats.length, 12);
  assert.equal(JSON.stringify(out).includes('SECRETO'), false);
  assert.equal(JSON.stringify(out).includes('https'), false);
  assert.deepEqual(Object.keys(out.chats[0]).sort(), ['chat_id', 'state']);
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
