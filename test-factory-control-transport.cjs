'use strict';

const assert = require('node:assert/strict');
const protocol = require('./factory-control-protocol.js');
const {
  ORIGIN,
  DEFAULT_LONG_POLL_MS,
  createTransportContract
} = require('./factory-control-transport.js');

function bridge(options = {}) {
  return createTransportContract({ protocol, ...options });
}

(() => {
  const transport = bridge();

  const heartbeat = transport.heartbeatRequest({
    profileAlias: 'perfil-1',
    accountAlias: 'cuenta-1',
    tabs: [{ tabId: 7, enabled: true, state: 'waiting' }],
    lastEvent: 'idle'
  });
  assert.deepEqual(heartbeat, {
    origin: 'https://control.condorapp.com.co',
    method: 'POST',
    path: '/v1/bridge/heartbeat',
    timeoutMs: 10000,
    authScope: 'profile',
    query: null,
    body: {
      version: 1,
      kind: 'heartbeat',
      profileAlias: 'perfil-1',
      accountAlias: 'cuenta-1',
      tabs: [{ tabId: 7, enabled: true, state: 'waiting' }],
      lastEvent: 'idle'
    }
  });

  const poll = transport.nextCommandRequest({
    profileAlias: 'perfil-1',
    cursor: 'cursor:001'
  });
  assert.deepEqual(poll, {
    origin: 'https://control.condorapp.com.co',
    method: 'GET',
    path: '/v1/bridge/commands/next',
    timeoutMs: DEFAULT_LONG_POLL_MS + 5000,
    authScope: 'profile',
    query: {
      profileAlias: 'perfil-1',
      cursor: 'cursor:001',
      waitMs: DEFAULT_LONG_POLL_MS
    },
    body: null
  });

  const ack = transport.acknowledgementRequest({
    id: 'command-001',
    ok: true,
    code: 'ok'
  });
  assert.equal(ack.origin, 'https://control.condorapp.com.co');
  assert.equal(ack.path, '/v1/bridge/commands/ack');
  assert.equal(ack.method, 'POST');
  assert.equal(ack.body.kind, 'ack');

  const response = transport.commandResponse({
    cursor: 'cursor:002',
    command: {
      id: 'command-002',
      action: 'pause',
      target: 7
    }
  });
  assert.deepEqual(response, {
    cursor: 'cursor:002',
    command: {
      version: 1,
      kind: 'command',
      id: 'command-002',
      action: 'pause',
      target: 7,
      payload: null
    }
  });

  assert.throws(
    () => transport.nextCommandRequest({
      profileAlias: 'perfil-1',
      cursor: null,
      origin: 'https://attacker.example'
    }),
    /invalid/
  );
  assert.throws(
    () => transport.nextCommandRequest({
      profileAlias: 'perfil-1',
      cursor: '../admin'
    }),
    /cursor is invalid/
  );
  assert.throws(
    () => bridge({ longPollMs: 31_000 }),
    /longPollMs is invalid/
  );
  assert.throws(
    () => transport.commandResponse({
      cursor: 'cursor:003',
      command: { id: 'command-003', action: 'pause', target: 7 },
      url: 'https://attacker.example'
    }),
    /invalid/
  );

  const serialized = JSON.stringify([heartbeat, poll, ack]);
  for (const forbidden of ['authorization', 'bearer', 'token', 'secret', 'cookie']) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false);
  }

  assert.equal(Object.isFrozen(heartbeat), true);
  assert.equal(Object.isFrozen(heartbeat.body), true);
  assert.equal(Object.isFrozen(heartbeat.body.tabs), true);
  assert.equal(Object.isFrozen(heartbeat.body.tabs[0]), true);
  assert.equal(Object.isFrozen(poll.query), true);
  assert.equal(Object.isFrozen(response), true);
  assert.equal(Object.isFrozen(response.command), true);

  const message = transport.commandResponse({
    cursor: 'cursor:004',
    command: {
      id: 'command-004',
      action: 'send_message',
      target: 7,
      payload: { text: 'owner message' }
    }
  });
  assert.equal(Object.isFrozen(message.command.payload), true);

  console.log('factory-control transport contract: ok');
})();
