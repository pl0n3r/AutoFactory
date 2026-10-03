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

assert.equal(reliability.sendAccepted({ composerCleared: true, messageAppeared: false, generationStarted: true }), true);
assert.equal(reliability.sendAccepted({ composerCleared: true, messageAppeared: true, generationStarted: false }), true);
assert.equal(reliability.sendAccepted({ composerCleared: false, messageAppeared: true, generationStarted: true }), false);
assert.equal(reliability.sendAccepted({ composerCleared: true, messageAppeared: false, generationStarted: false }), false);
console.log('Envío: acepta generación iniciada sin exigir mensaje virtualizado y evita falsos positivos');

assert.equal(reliability.lateSendAccepted({
  circuitOpen: true, generating: false, assistantCount: 4, assistantCountBeforeSend: 3
}), true);
assert.equal(reliability.lateSendAccepted({
  circuitOpen: true, generating: true, assistantCount: 3, assistantCountBeforeSend: 3
}), true);
assert.equal(reliability.lateSendAccepted({
  circuitOpen: true, generating: false, assistantCount: 3, assistantCountBeforeSend: 3
}), false);
assert.equal(reliability.lateSendAccepted({
  circuitOpen: false, generating: true, assistantCount: 3, assistantCountBeforeSend: 3
}), false);
console.log('Envío tardío: una respuesta real limpia la protección anterior');


let platformReview = reliability.platformReviewProgress({}, 1000, 5000);
assert.equal(platformReview.startedAt, 1000);
assert.equal(platformReview.timedOut, false);
assert.equal(platformReview.shouldEscalate, false);
platformReview = reliability.platformReviewProgress(platformReview, 5999, 5000);
assert.equal(platformReview.timedOut, false);
platformReview = reliability.platformReviewProgress(platformReview, 6000, 5000);
assert.equal(platformReview.timedOut, true);
assert.equal(platformReview.shouldEscalate, true);
assert.equal(platformReview.escalated, true);
platformReview = reliability.platformReviewProgress(platformReview, 7000, 5000);
assert.equal(platformReview.timedOut, true);
assert.equal(platformReview.shouldEscalate, false);
assert.equal(platformReview.action, 'hold');
platformReview = reliability.platformReviewProgress(platformReview, 7001, 5000, false);
assert.equal(platformReview.action, 'resume');
assert.equal(platformReview.startedAt, 0);
assert.equal(platformReview.escalated, false);
platformReview = reliability.platformReviewProgress(platformReview, 7002, 5000, false);
assert.equal(platformReview.action, 'none');
console.log('Plataforma: espera, escalamiento único y reanudación son deterministas');
