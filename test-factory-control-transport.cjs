'use strict';

const assert = require('node:assert/strict');
const protocol = require('./factory-control-protocol.js');
const {
  DEFAULT_LONG_POLL_MS,
  createTransportContract,
  createCredentialBoundInvoker,
  createAuthenticatedTransportClient
} = require('./factory-control-transport.js');

function bridge(options = {}) {
  return createTransportContract({ protocol, ...options });
}

(async () => {
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
  assert.deepEqual(ack, {
    origin: 'https://control.condorapp.com.co',
    method: 'POST',
    path: '/v1/bridge/commands/ack',
    timeoutMs: 10000,
    authScope: 'profile',
    query: null,
    body: {
      version: 1,
      kind: 'ack',
      id: 'command-001',
      ok: true,
      code: 'ok'
    }
  });

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


  const NOW = 1_900_000_000_000;
  const seen = [];
  const bound = createCredentialBoundInvoker({
    credentialStore: {
      load: async profileAlias => profileAlias === 'perfil-1'
        ? { id: 'credential-transport-001', expiresAt: NOW + 60_000 }
        : null
    },
    now: () => NOW,
    invoke: async envelope => {
      seen.push(envelope);
      return { status: 200, body: { accepted: true } };
    }
  });

  assert.deepEqual(
    await bound.execute({ profileAlias: 'perfil-1', request: heartbeat }),
    { ok: true, code: 'authorized', response: { status: 200, body: { accepted: true } } }
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].credentialId, 'credential-transport-001');
  assert.deepEqual(seen[0].request, heartbeat);
  assert.equal(JSON.stringify(await bound.execute({
    profileAlias: 'perfil-2', request: transport.nextCommandRequest({
      profileAlias: 'perfil-2', cursor: null
    })
  })).includes('credential-transport-001'), false);

  const mutableRequest = {
    ...heartbeat,
    body: { ...heartbeat.body, tabs: heartbeat.body.tabs.map(tab => ({ ...tab })) }
  };
  let releaseLoad;
  const delayedLoad = new Promise(resolve => { releaseLoad = resolve; });
  const mutableSeen = [];
  const snapshotBound = createCredentialBoundInvoker({
    credentialStore: {
      load: async () => {
        await delayedLoad;
        return { id: 'credential-snapshot-001', expiresAt: NOW + 60_000 };
      }
    },
    now: () => NOW,
    invoke: async envelope => {
      mutableSeen.push(envelope);
      return { status: 200, body: { accepted: true } };
    }
  });
  const pendingSnapshot = snapshotBound.execute({ profileAlias: 'perfil-1', request: mutableRequest });
  mutableRequest.origin = 'https://attacker.example';
  mutableRequest.body.profileAlias = 'perfil-2';
  releaseLoad();
  assert.deepEqual(
    await pendingSnapshot,
    { ok: true, code: 'authorized', response: { status: 200, body: { accepted: true } } }
  );
  assert.equal(mutableSeen[0].request.origin, 'https://control.condorapp.com.co');
  assert.equal(mutableSeen[0].request.body.profileAlias, 'perfil-1');

  const missing = await bound.execute({
    profileAlias: 'perfil-2',
    request: transport.nextCommandRequest({ profileAlias: 'perfil-2', cursor: null })
  });
  assert.deepEqual(missing, { ok: false, code: 'unauthorized' });

  const expired = createCredentialBoundInvoker({
    credentialStore: {
      load: async () => ({ id: 'credential-expired-001', expiresAt: NOW })
    },
    now: () => NOW,
    invoke: async () => { throw new Error('must not run'); }
  });
  assert.deepEqual(
    await expired.execute({ profileAlias: 'perfil-1', request: heartbeat }),
    { ok: false, code: 'unauthorized' }
  );

  const tampered = { ...heartbeat, origin: 'https://attacker.example' };
  assert.deepEqual(
    await bound.execute({ profileAlias: 'perfil-1', request: tampered }),
    { ok: false, code: 'failed' }
  );
  assert.equal(seen.length, 1);

  const secretFailure = createCredentialBoundInvoker({
    credentialStore: {
      load: async () => ({ id: 'credential-secret-001', expiresAt: NOW + 60_000 })
    },
    now: () => NOW,
    invoke: async () => { throw new Error('credential-secret-001 private transport path'); }
  });
  const failed = await secretFailure.execute({ profileAlias: 'perfil-1', request: heartbeat });
  assert.deepEqual(failed, { ok: false, code: 'failed' });
  assert.equal(JSON.stringify(failed).includes('credential-secret-001'), false);

  const reflected = createCredentialBoundInvoker({
    credentialStore: {
      load: async () => ({ id: 'credential-reflect-001', expiresAt: NOW + 60_000 })
    },
    now: () => NOW,
    invoke: async ({ credentialId }) => ({
      status: 200,
      body: { debug: credentialId }
    })
  });
  assert.deepEqual(
    await reflected.execute({ profileAlias: 'perfil-1', request: heartbeat }),
    { ok: false, code: 'failed' }
  );

  const deceptiveBody = createCredentialBoundInvoker({
    credentialStore: {
      load: async () => ({ id: 'credential-tojson-001', expiresAt: NOW + 60_000 })
    },
    now: () => NOW,
    invoke: async ({ credentialId }) => ({
      status: 200,
      body: {
        credentialId,
        accepted: true,
        toJSON() { return { accepted: true }; }
      }
    })
  });
  assert.deepEqual(
    await deceptiveBody.execute({ profileAlias: 'perfil-1', request: heartbeat }),
    { ok: true, code: 'authorized', response: { status: 200, body: { accepted: true } } }
  );


  const clientSeen = [];
  let releaseClient;
  const clientGate = new Promise(resolve => { releaseClient = resolve; });
  const client = createAuthenticatedTransportClient({
    transport,
    invoker: {
      execute: async input => {
        clientSeen.push(input);
        if (input.request.path === '/v1/bridge/commands/next') {
          return {
            ok: true,
            code: 'authorized',
            response: {
              status: 200,
              body: {
                cursor: 'cursor:client-2',
                command: { id: 'command-client-1', action: 'pause', target: 7 }
              }
            }
          };
        }
        await clientGate;
        return { ok: true, code: 'authorized', response: { status: 204, body: null } };
      }
    }
  });

  const clientHeartbeat = {
    profileAlias: 'perfil-1',
    accountAlias: 'cuenta-1',
    tabs: [{ tabId: 7, enabled: true, state: 'waiting' }],
    lastEvent: 'idle'
  };
  const pendingClientHeartbeat = client.sendHeartbeat(clientHeartbeat);
  clientHeartbeat.profileAlias = 'perfil-mutado';
  clientHeartbeat.tabs[0].state = 'error';
  releaseClient();
  assert.deepEqual(await pendingClientHeartbeat, { ok: true, code: 'sent' });
  assert.equal(clientSeen[0].profileAlias, 'perfil-1');
  assert.equal(clientSeen[0].request.body.profileAlias, 'perfil-1');
  assert.equal(clientSeen[0].request.body.tabs[0].state, 'waiting');

  assert.deepEqual(
    await client.nextCommand({ profileAlias: 'perfil-1', cursor: 'cursor:client-1' }),
    {
      ok: true,
      code: 'command',
      cursor: 'cursor:client-2',
      command: {
        version: 1,
        kind: 'command',
        id: 'command-client-1',
        action: 'pause',
        target: 7,
        payload: null
      }
    }
  );

  const emptyClient = createAuthenticatedTransportClient({
    transport,
    invoker: {
      execute: async () => ({
        ok: true, code: 'authorized', response: { status: 204, body: null }
      })
    }
  });
  assert.deepEqual(
    await emptyClient.nextCommand({ profileAlias: 'perfil-1', cursor: null }),
    { ok: true, code: 'empty', cursor: null, command: null }
  );
  assert.deepEqual(
    await emptyClient.sendAck({
      profileAlias: 'perfil-1',
      ack: { id: 'command-client-1', ok: true, code: 'ok' }
    }),
    { ok: true, code: 'sent' }
  );

  const badStatusClient = createAuthenticatedTransportClient({
    transport,
    invoker: {
      execute: async () => ({
        ok: true, code: 'authorized', response: { status: 302, body: { redirect: true } }
      })
    }
  });
  assert.deepEqual(
    await badStatusClient.sendHeartbeat({
      profileAlias: 'perfil-1',
      accountAlias: 'cuenta-1',
      tabs: [],
      lastEvent: 'idle'
    }),
    { ok: false, code: 'failed' }
  );

  const mismatchClient = createAuthenticatedTransportClient({
    transport: {
      ...transport,
      heartbeatRequest: input => ({
        ...transport.heartbeatRequest(input),
        body: { ...transport.heartbeatRequest(input).body, profileAlias: 'perfil-otro' }
      })
    },
    invoker: bound
  });
  assert.deepEqual(
    await mismatchClient.sendHeartbeat({
      profileAlias: 'perfil-1',
      accountAlias: 'cuenta-1',
      tabs: [],
      lastEvent: 'idle'
    }),
    { ok: false, code: 'failed' }
  );

  const secretClient = createAuthenticatedTransportClient({
    transport,
    invoker: {
      execute: async () => { throw new Error('credential-client-secret private'); }
    }
  });
  const secretClientResult = await secretClient.sendAck({
    profileAlias: 'perfil-1',
    ack: { id: 'command-client-2', ok: false, code: 'failed' }
  });
  assert.deepEqual(secretClientResult, { ok: false, code: 'failed' });
  assert.equal(JSON.stringify(secretClientResult).includes('credential-client-secret'), false);

  console.log('factory-control transport contract: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
