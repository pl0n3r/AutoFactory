const assert = require('node:assert/strict');
const { createCommandAuthorizer } = require('./factory-control-authorization.js');

(async () => {
  const pause = { id: 'pause01', action: 'pause', target: 7 };
  const send = { id: 'send01', action: 'send_message', target: 7,
    payload: { text: 'private chat content must never appear in errors' } };
  const context = { profileAlias: 'local-profile', enabledTabIds: [7] };
  const template = {
    profileAlias: 'local-profile', expiresAt: 10000, revoked: false,
    actions: ['pause'], tabIds: [7], broadcast: false
  };
  let grant = structuredClone(template);
  let now = 1000;
  const authorizer = createCommandAuthorizer({
    loadVerifiedGrant: async () => structuredClone(grant),
    now: () => now
  });
  const denied = async (command, ctx = context) => {
    await assert.rejects(authorizer.authorize(command, ctx), error =>
      error instanceof TypeError &&
      error.message === 'Command not authorized' &&
      !error.message.includes('private chat content')
    );
  };
  assert.deepEqual(await authorizer.authorize(pause, context), {
    version: 1, kind: 'command', id: 'pause01', action: 'pause',
    target: 7, payload: null
  });
  await denied(send);
  await denied({ id: 'bulk', action: 'pause', target: 'all' });
  await denied({ id: 'bulkSend', action: 'send_message', target: 'all',
    payload: { text: 'private chat content' } });
  grant.broadcast = true;
  assert.equal((await authorizer.authorize(
    { id: 'bulkAllowed', action: 'pause', target: 'all' }, context
  )).target, 'all');
  await denied({ id: 'bulkOpen', action: 'open_chat', target: 'all' });
  grant.actions.push('send_message');
  assert.equal((await authorizer.authorize(send, context)).payload.text,
    send.payload.text);
  await denied({ ...send, target: 8 });
  await denied(send, { ...context, enabledTabIds: [] });
  await denied(send, { ...context, profileAlias: 'another-profile' });
  grant.revoked = true;
  await denied(send);
  grant.revoked = false;
  now = 10000;
  await denied(send);
  now = 1000;
  grant.expiresAt = now + 86400001;
  await denied(send);
  grant.expiresAt = template.expiresAt;
  grant.tabIds = [7, 7];
  await denied(send);
  grant.tabIds = Array(1);
  await denied(send);
  grant.tabIds = [7];
  grant.actions = ['pause', 'send_message', 'send_message'];
  await denied(send);
  grant.actions = ['pause', 'send_message'];
  grant.secret = 'forbidden';
  await denied(send);
  delete grant.secret;
  await denied(send, { ...context, enabledTabIds: Array(1) });
  await denied(send, { ...context, enabledTabIds: [7, 7] });
  grant = null;
  await denied(send);
  await assert.rejects(createCommandAuthorizer({
    loadVerifiedGrant: async () => { throw Error('private API token'); },
    now: () => now
  }).authorize(send, context), error => error.message === 'Command not authorized');
  await assert.rejects(createCommandAuthorizer({
    loadVerifiedGrant: async () => template, now: () => Infinity
  }).authorize(pause, context), /Command not authorized/);
  assert.throws(() => createCommandAuthorizer({}), /required/);
  console.log('Factory Control authorization: opt-in, expiry, revocation, tab scope and fail closed');
})().catch(error => { console.error(error); process.exitCode = 1; });
require('./test-factory-control-heartbeat.cjs');
