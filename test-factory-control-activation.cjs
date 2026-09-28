'use strict';

const assert = require('node:assert/strict');
const { createActivationPreflight } = require('./factory-control-activation.js');

const NOW = 1_800_000_000_000;
const PROFILE = 'perfil-1';

function fixture(overrides = {}) {
  const calls = [];
  const clock = overrides.now || (() => NOW);
  const preflight = createActivationPreflight({
    now: clock,
    loadVerifiedPairing: overrides.loadVerifiedPairing || (async ({ profileAlias }) => {
      calls.push('pairing');
      return {
        profileAlias,
        id: 'credential-001',
        expiresAt: NOW + 60_000,
        revoked: false
      };
    }),
    loadVerifiedHeartbeatConsent:
      overrides.loadVerifiedHeartbeatConsent || (async ({ profileAlias }) => {
        calls.push('consent');
        return {
          profileAlias,
          purpose: 'heartbeat',
          enabled: true,
          revoked: false,
          expiresAt: NOW + 60_000
        };
      }),
    loadVerifiedLegalGate: overrides.loadVerifiedLegalGate || (async ({ profileAlias }) => {
      calls.push('legal');
      return {
        profileAlias,
        purpose: 'factory_control_bridge_activation',
        allowed: true,
        revoked: false,
        expiresAt: NOW + 60_000
      };
    })
  });
  return { preflight, calls };
}

(async () => {
  {
    const { preflight, calls } = fixture();
    const result = await preflight.evaluate({ profileAlias: PROFILE });
    assert.deepEqual(result, { allowed: true, code: 'ready' });
    assert.equal(Object.isFrozen(result), true);
    assert.deepEqual(calls, ['pairing', 'consent', 'legal']);
    assert.equal(Object.hasOwn(result, 'credential'), false);
    assert.equal(Object.hasOwn(result, 'profileAlias'), false);
  }

  {
    let touched = false;
    const { preflight } = fixture({
      loadVerifiedPairing: async () => {
        touched = true;
        return null;
      }
    });
    const invalid = await preflight.evaluate({ profileAlias: PROFILE, extra: true });
    assert.deepEqual(invalid, { allowed: false, code: 'invalid' });
    assert.equal(touched, false);
  }

  {
    const { preflight, calls } = fixture({
      loadVerifiedPairing: async () => {
        calls.push('pairing');
        return null;
      }
    });
    assert.deepEqual(
      await preflight.evaluate({ profileAlias: PROFILE }),
      { allowed: false, code: 'unpaired' }
    );
    assert.deepEqual(calls, ['pairing']);
  }

  for (const pairing of [
    { profileAlias: PROFILE, id: 'credential-001', expiresAt: NOW, revoked: false },
    { profileAlias: PROFILE, id: 'credential-001', expiresAt: NOW + 60_000, revoked: true },
    { profileAlias: 'otro-perfil', id: 'credential-001', expiresAt: NOW + 60_000, revoked: false }
  ]) {
    const { preflight } = fixture({ loadVerifiedPairing: async () => pairing });
    assert.deepEqual(
      await preflight.evaluate({ profileAlias: PROFILE }),
      { allowed: false, code: 'unpaired' }
    );
  }

  for (const consent of [
    null,
    { profileAlias: PROFILE, purpose: 'heartbeat', enabled: false, revoked: false, expiresAt: NOW + 60_000 },
    { profileAlias: PROFILE, purpose: 'heartbeat', enabled: true, revoked: true, expiresAt: NOW + 60_000 },
    { profileAlias: 'otro-perfil', purpose: 'heartbeat', enabled: true, revoked: false, expiresAt: NOW + 60_000 },
    { profileAlias: PROFILE, purpose: 'response_return', enabled: true, revoked: false, expiresAt: NOW + 60_000 },
    { profileAlias: PROFILE, purpose: 'heartbeat', enabled: true, revoked: false, expiresAt: NOW }
  ]) {
    const { preflight } = fixture({
      loadVerifiedHeartbeatConsent: async () => consent
    });
    assert.deepEqual(
      await preflight.evaluate({ profileAlias: PROFILE }),
      { allowed: false, code: 'consent_denied' }
    );
  }

  for (const gate of [
    null,
    { profileAlias: PROFILE, purpose: 'factory_control_bridge_activation', allowed: false, revoked: false, expiresAt: NOW + 60_000 },
    { profileAlias: 'otro-perfil', purpose: 'factory_control_bridge_activation', allowed: true, revoked: false, expiresAt: NOW + 60_000 },
    { profileAlias: PROFILE, purpose: 'other_gate', allowed: true, revoked: false, expiresAt: NOW + 60_000 },
    { profileAlias: PROFILE, purpose: 'factory_control_bridge_activation', allowed: true, revoked: true, expiresAt: NOW + 60_000 },
    { profileAlias: PROFILE, purpose: 'factory_control_bridge_activation', allowed: true, revoked: false, expiresAt: NOW }
  ]) {
    const { preflight } = fixture({ loadVerifiedLegalGate: async () => gate });
    assert.deepEqual(
      await preflight.evaluate({ profileAlias: PROFILE }),
      { allowed: false, code: 'legal_blocked' }
    );
  }

  {
    const secret = 'credential-secret-value';
    const { preflight } = fixture({
      loadVerifiedLegalGate: async () => {
        throw new Error(secret);
      }
    });
    const result = await preflight.evaluate({ profileAlias: PROFILE });
    assert.deepEqual(result, { allowed: false, code: 'failed' });
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(JSON.stringify(result).includes(PROFILE), false);
  }

  {
    const { preflight } = fixture({
      loadVerifiedPairing: async ({ profileAlias }) => ({
        profileAlias,
        id: 'credential-001',
        expiresAt: NOW + (25 * 60 * 60 * 1000),
        revoked: false
      })
    });
    assert.deepEqual(
      await preflight.evaluate({ profileAlias: PROFILE }),
      { allowed: false, code: 'failed' }
    );
  }

  {
    let call = 0;
    const { preflight } = fixture({
      now: () => {
        call += 1;
        if (call === 1) return NOW;
        if (call === 2) return NOW + 59_000;
        return NOW + 61_000;
      }
    });
    assert.deepEqual(
      await preflight.evaluate({ profileAlias: PROFILE }),
      { allowed: false, code: 'legal_blocked' }
    );
  }

  {
    let call = 0;
    const { preflight } = fixture({
      now: () => {
        call += 1;
        if (call === 1) return NOW;
        if (call === 2) return NOW + 10_000;
        return NOW + 55_000;
      },
      loadVerifiedPairing: async ({ profileAlias }) => ({
        profileAlias,
        id: 'credential-001',
        expiresAt: NOW + 50_000,
        revoked: false
      })
    });
    assert.deepEqual(
      await preflight.evaluate({ profileAlias: PROFILE }),
      { allowed: false, code: 'unpaired' }
    );
  }

  {
    let call = 0;
    const { preflight } = fixture({
      now: () => {
        call += 1;
        if (call === 1) return NOW;
        if (call === 2) return NOW + 10_000;
        return NOW + 55_000;
      },
      loadVerifiedHeartbeatConsent: async ({ profileAlias }) => ({
        profileAlias,
        purpose: 'heartbeat',
        enabled: true,
        revoked: false,
        expiresAt: NOW + 50_000
      })
    });
    assert.deepEqual(
      await preflight.evaluate({ profileAlias: PROFILE }),
      { allowed: false, code: 'consent_denied' }
    );
  }

  {
    let call = 0;
    const { preflight } = fixture({
      now: () => {
        call += 1;
        return call === 1 ? NOW : NOW - 1;
      }
    });
    assert.deepEqual(
      await preflight.evaluate({ profileAlias: PROFILE }),
      { allowed: false, code: 'failed' }
    );
  }

  console.log('factory-control activation preflight: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
