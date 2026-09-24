const assert = require('node:assert/strict');
const reliability = require('./reliability.js');
const memory = new Map();
const storage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) };
assert.equal(reliability.signature(' mensaje  exacto '), reliability.signature('mensaje exacto'));
assert.notEqual(reliability.signature('mensaje A'), reliability.signature('mensaje B'));
let runtime = reliability.normalize({ pendingSignature: reliability.signature('continuar'), assistantCountBeforeSend: 3 });
reliability.save(storage, runtime);
assert.deepEqual(reliability.load(storage), runtime);
let now = 100000;
for (let i = 1; i <= 5; i += 1) {
  const result = reliability.afterFailure(runtime, now);
  runtime = result;
  assert.ok(result.retryAt > now);
}
assert.ok(runtime.circuitOpenUntil > now);
runtime = reliability.afterSuccess(runtime);
assert.equal(runtime.consecutiveFailures, 0);
assert.equal(runtime.circuitOpenUntil, 0);
runtime = reliability.normalize();
for (let i = 0; i < 3; i += 1) runtime = reliability.beforeReload(runtime, now);
assert.equal(reliability.canReload(runtime, now), false);
runtime = reliability.beforeReload(runtime, now);
assert.ok(runtime.circuitOpenUntil > now);
console.log('Reliability: firma, persistencia, backoff y circuit breaker correctos');

const learning = require('./learning.js');
const sanitized = learning.normalize({ startupSamplesMs: [1200, Date.now()], responseSamplesMs: [3000, 999999999] });
assert.deepEqual(sanitized.startupSamplesMs, [1200]);
assert.deepEqual(sanitized.responseSamplesMs, [3000]);
console.log('Learning: muestras temporales imposibles descartadas');
