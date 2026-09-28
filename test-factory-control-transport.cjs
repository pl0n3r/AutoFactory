'use strict';

const assert = require('node:assert/strict');
const protocol = require('./factory-control-protocol.js');
const {
  DEFAULT_LONG_POLL_MS,
  createTransportContract,
  createCredentialBoundInvoker,
  createAuthenticatedTransportClient,
  createCommandPump
} = require('./factory-control-transport.js');

function bridge(options = {}) {
  return createTransportContract({ protocol, ...options });
}

function readyActivation() {
  return {
    evaluate: async () => Object.freeze({ allowed: true, code: 'ready' })
  };
}

function authenticatedClient(options = {}) {
  return createAuthenticatedTransportClient({
    activation: readyActivation(),
    ...options
  });
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


  assert.throws(
    () => createAuthenticatedTransportClient({
      transport,
      invoker: { execute: async () => ({ ok: false, code: 'failed' }) }
    }),
    /dependencies/
  );

  let blockedInvocations = 0;
  const blockedClient = authenticatedClient({
    activation: {
      evaluate: async ({ profileAlias }) => {
        assert.equal(profileAlias, 'perfil-1');
        return { allowed: false, code: 'legal_blocked' };
      }
    },
    invoker: {
      execute: async () => {
        blockedInvocations += 1;
        return { ok: true, code: 'authorized', response: { status: 204, body: null } };
      }
    }
  });
  assert.deepEqual(
    await blockedClient.sendHeartbeat({
      profileAlias: 'perfil-1',
      accountAlias: 'cuenta-1',
      tabs: [],
      lastEvent: 'idle'
    }),
    { ok: false, code: 'unauthorized' }
  );
  assert.deepEqual(
    await blockedClient.nextCommand({ profileAlias: 'perfil-1', cursor: null }),
    { ok: false, code: 'unauthorized' }
  );
  assert.deepEqual(
    await blockedClient.sendAck({
      profileAlias: 'perfil-1',
      ack: { id: 'command-gated-1', ok: true, code: 'ok' }
    }),
    { ok: false, code: 'unauthorized' }
  );
  assert.equal(blockedInvocations, 0);

  let malformedInvocations = 0;
  const malformedGateClient = authenticatedClient({
    activation: {
      evaluate: async () => ({ allowed: true, code: 'legal_blocked' })
    },
    invoker: {
      execute: async () => {
        malformedInvocations += 1;
        return { ok: true, code: 'authorized', response: { status: 204, body: null } };
      }
    }
  });
  assert.deepEqual(
    await malformedGateClient.nextCommand({ profileAlias: 'perfil-1', cursor: null }),
    { ok: false, code: 'failed' }
  );
  assert.equal(malformedInvocations, 0);

  let activationCalls = 0;
  const reevaluatedClient = authenticatedClient({
    activation: {
      evaluate: async () => {
        activationCalls += 1;
        return { allowed: true, code: 'ready' };
      }
    },
    invoker: {
      execute: async () => ({
        ok: true,
        code: 'authorized',
        response: { status: 204, body: null }
      })
    }
  });
  assert.deepEqual(
    await reevaluatedClient.sendHeartbeat({
      profileAlias: 'perfil-1',
      accountAlias: 'cuenta-1',
      tabs: [],
      lastEvent: 'idle'
    }),
    { ok: true, code: 'sent' }
  );
  assert.deepEqual(
    await reevaluatedClient.nextCommand({ profileAlias: 'perfil-1', cursor: null }),
    { ok: true, code: 'empty', cursor: null, command: null }
  );
  assert.deepEqual(
    await reevaluatedClient.sendAck({
      profileAlias: 'perfil-1',
      ack: { id: 'command-gated-2', ok: true, code: 'ok' }
    }),
    { ok: true, code: 'sent' }
  );
  assert.equal(activationCalls, 3);

  const clientSeen = [];
  let releaseClient;
  const clientGate = new Promise(resolve => { releaseClient = resolve; });
  const client = authenticatedClient({
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

  const emptyClient = authenticatedClient({
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

  const badStatusClient = authenticatedClient({
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

  const mismatchClient = authenticatedClient({
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

  const secretClient = authenticatedClient({
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


  const pumpEvents = [];
  const seenIds = new Set();
  let releasePoll;
  const pollGate = new Promise(resolve => { releasePoll = resolve; });
  const pump = createCommandPump({
    client: {
      nextCommand: async input => {
        pumpEvents.push(['poll', structuredClone(input)]);
        if (input.cursor === 'cursor:wait') {
          await pollGate;
          return { ok: true, code: 'empty', cursor: input.cursor, command: null };
        }
        if (input.cursor === 'cursor:empty') {
          return { ok: true, code: 'empty', cursor: 'cursor:empty-2', command: null };
        }
        return {
          ok: true,
          code: 'command',
          cursor: 'cursor:next',
          command: {
            version: 1,
            kind: 'command',
            id: 'pump-command-1',
            action: 'pause',
            target: 7,
            payload: null
          }
        };
      },
      sendAck: async input => {
        pumpEvents.push(['ack', structuredClone(input)]);
        if (input.profileAlias === 'ack-fails') return { ok: false, code: 'failed' };
        return { ok: true, code: 'sent' };
      }
    },
    executor: {
      execute: async commandValue => {
        pumpEvents.push(['execute', structuredClone(commandValue)]);
        if (seenIds.has(commandValue.id)) {
          return {
            version: 1, kind: 'ack', id: commandValue.id,
            ok: false, code: 'already_handled'
          };
        }
        seenIds.add(commandValue.id);
        return {
          version: 1, kind: 'ack', id: commandValue.id,
          ok: true, code: 'ok'
        };
      }
    }
  });

  assert.deepEqual(
    await pump.runOnce({
      profileAlias: 'perfil-1',
      cursor: 'cursor:empty',
      context: { profileAlias: 'perfil-1', enabledTabIds: [7] }
    }),
    { ok: true, code: 'empty', cursor: 'cursor:empty-2' }
  );

  const handled = await pump.runOnce({
    profileAlias: 'perfil-1',
    cursor: 'cursor:start',
    context: { profileAlias: 'perfil-1', enabledTabIds: [7] }
  });
  assert.deepEqual(handled, {
    ok: true,
    code: 'handled',
    cursor: 'cursor:next',
    commandId: 'pump-command-1',
    outcome: 'ok'
  });
  assert.equal(pumpEvents.filter(event => event[0] === 'execute').length, 1);
  assert.equal(pumpEvents.filter(event => event[0] === 'ack').length, 1);

  const replay = await pump.runOnce({
    profileAlias: 'perfil-1',
    cursor: 'cursor:start',
    context: { profileAlias: 'perfil-1', enabledTabIds: [7] }
  });
  assert.equal(replay.outcome, 'already_handled');
  assert.equal(replay.cursor, 'cursor:next');
  assert.equal(pumpEvents.filter(event => event[0] === 'execute').length, 2);

  let mismatchedAckSent = 0;
  const mismatchedAckPump = createCommandPump({
    client: {
      nextCommand: async () => ({
        ok: true,
        code: 'command',
        cursor: 'cursor:mismatch-next',
        command: {
          version: 1, kind: 'command', id: 'pump-command-mismatch',
          action: 'pause', target: 7, payload: null
        }
      }),
      sendAck: async () => {
        mismatchedAckSent++;
        return { ok: true, code: 'sent' };
      }
    },
    executor: {
      execute: async () => ({
        version: 1, kind: 'ack', id: 'different-command',
        ok: true, code: 'ok'
      })
    }
  });
  assert.deepEqual(
    await mismatchedAckPump.runOnce({
      profileAlias: 'perfil-1',
      cursor: 'cursor:mismatch-before',
      context: { profileAlias: 'perfil-1', enabledTabIds: [7] }
    }),
    { ok: false, code: 'failed', cursor: 'cursor:mismatch-before' }
  );
  assert.equal(mismatchedAckSent, 0);

  for (const invalidAck of [
    { version: 1, kind: 'ack', id: 'pump-command-invalid-ack', ok: false, code: 'ok' },
    { version: 1, kind: 'ack', id: 'pump-command-invalid-ack', ok: true, code: 'failed' },
    { version: 1, kind: 'ack', id: 'pump-command-invalid-ack', ok: false, code: 'made_up' }
  ]) {
    let invalidAckSent = 0;
    const invalidAckPump = createCommandPump({
      client: {
        nextCommand: async () => ({
          ok: true,
          code: 'command',
          cursor: 'cursor:invalid-ack-next',
          command: {
            version: 1, kind: 'command', id: 'pump-command-invalid-ack',
            action: 'pause', target: 7, payload: null
          }
        }),
        sendAck: async () => {
          invalidAckSent++;
          return { ok: true, code: 'sent' };
        }
      },
      executor: { execute: async () => invalidAck }
    });
    assert.deepEqual(
      await invalidAckPump.runOnce({
        profileAlias: 'perfil-1',
        cursor: 'cursor:invalid-ack-before',
        context: { profileAlias: 'perfil-1', enabledTabIds: [7] }
      }),
      { ok: false, code: 'failed', cursor: 'cursor:invalid-ack-before' }
    );
    assert.equal(invalidAckSent, 0);
  }

  const ackFailurePump = createCommandPump({
    client: {
      nextCommand: async () => ({
        ok: true,
        code: 'command',
        cursor: 'cursor:advanced',
        command: {
          version: 1, kind: 'command', id: 'pump-command-2',
          action: 'pause', target: 7, payload: null
        }
      }),
      sendAck: async () => ({ ok: false, code: 'failed' })
    },
    executor: {
      execute: async commandValue => ({
        version: 1, kind: 'ack', id: commandValue.id, ok: true, code: 'ok'
      })
    }
  });
  assert.deepEqual(
    await ackFailurePump.runOnce({
      profileAlias: 'perfil-1',
      cursor: 'cursor:before',
      context: { profileAlias: 'perfil-1', enabledTabIds: [7] }
    }),
    { ok: false, code: 'ack_failed', cursor: 'cursor:before' }
  );

  assert.deepEqual(
    await pump.runOnce({
      profileAlias: 'perfil-1',
      cursor: null,
      context: { profileAlias: 'perfil-2', enabledTabIds: [7] }
    }),
    { ok: false, code: 'failed', cursor: null }
  );
  assert.deepEqual(
    await pump.runOnce({
      profileAlias: 'perfil-1',
      cursor: null,
      context: { profileAlias: 'perfil-1', enabledTabIds: [7, 7] }
    }),
    { ok: false, code: 'failed', cursor: null }
  );

  const waiting = pump.runOnce({
    profileAlias: 'perfil-1',
    cursor: 'cursor:wait',
    context: { profileAlias: 'perfil-1', enabledTabIds: [7] }
  });
  assert.deepEqual(
    await pump.runOnce({
      profileAlias: 'perfil-1',
      cursor: 'cursor:second',
      context: { profileAlias: 'perfil-1', enabledTabIds: [7] }
    }),
    { ok: false, code: 'busy', cursor: 'cursor:second' }
  );
  assert.deepEqual(
    await pump.runOnce({
      profileAlias: 'perfil-1',
      cursor: { secret: 'must-not-reflect' },
      context: { profileAlias: 'perfil-1', enabledTabIds: [7] }
    }),
    { ok: false, code: 'busy', cursor: null }
  );
  releasePoll();
  assert.deepEqual(await waiting, { ok: true, code: 'empty', cursor: 'cursor:wait' });

  const opaquePump = createCommandPump({
    client: {
      nextCommand: async () => { throw new Error('credential-pump-secret private'); },
      sendAck: async () => { throw new Error('must not run'); }
    },
    executor: { execute: async () => { throw new Error('must not run'); } }
  });
  const opaque = await opaquePump.runOnce({
    profileAlias: 'perfil-1',
    cursor: null,
    context: { profileAlias: 'perfil-1', enabledTabIds: [7] }
  });
  assert.deepEqual(opaque, { ok: false, code: 'failed', cursor: null });
  assert.equal(JSON.stringify(opaque).includes('credential-pump-secret'), false);

  console.log('factory-control transport contract: ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
