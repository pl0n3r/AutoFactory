# Shared Adaptive Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share privacy-safe AutoFactory recovery learning through ControlBot and apply only trusted, bounded recovery recommendations across Chrome, Safari, tabs, and computers.

**Architecture:** AutoFactory emits sanitized outcome events and caches signed, versioned policy snapshots. ControlBot deduplicates and aggregates those events, ranks only allowlisted recovery actions, and exposes authenticated upload and snapshot operations. Local safety rules, incident leases, offline defaults, rollback, and a feature flag remain authoritative.

**Tech Stack:** JavaScript MV3 extension, Chrome/Safari WebExtension APIs, Node test harness, PHP 8 ControlBot modules, Python/PHP scenario tests.

**Spec:** `docs/superpowers/specs/2026-10-10-shared-adaptive-learning-design.md`

## Global Constraints

- Never upload prompts, responses, conversation IDs, URLs, repository names, account IDs, page text, DOM content, or credentials.
- Learned actions are limited to `wait`, `retry`, `reload`, `stop_wait`, and `open_replacement_chat`.
- Never interrupt an active response because a timer expired.
- At most one replacement chat may be opened per recovery incident.
- Invalid, expired, incompatible, or unverifiable policies fall back to local defaults.
- Shared learning ships disabled behind `sharedLearningEnabled` until observation-mode evidence passes.

## Review Focus

- Malformed or oversized event batches must be rejected without retaining partial data (Task 2).
- Clock skew and expired snapshots must select built-in defaults (Task 4).
- Simultaneous tabs must acquire only one incident lease (Task 5).
- A stale recommendation must never interrupt an active response (Task 6).
- Safari packaging must contain every new runtime module in manifest order (Task 7).

---

### Task 1: AutoFactory learning protocol and privacy boundary

**Files:** Create `shared-learning-protocol.js`, `test-shared-learning-protocol.cjs`; modify `package.json`.

**Interfaces:** Produces `sanitizeOutcome(input, now)`, `validatePolicySnapshot(input, now)`, `BUILT_IN_POLICY`, schema version `1`.

- [ ] Write failing tests for exact-field validation, 16 KiB batches, forbidden-text omission, allowlisted actions, expiry, monotonic versions, and immutable results.
- [ ] Run `node test-shared-learning-protocol.cjs`; expect missing-module failure.
- [ ] Implement the pure protocol. Event fields are `schemaVersion,eventId,installationId,browserFamily,extensionVersion,problemCode,interfaceState,action,durationMs,attempt,outcome,policyVersion,observedAt`.
- [ ] Run the focused test and `npm test`; expect PASS.
- [ ] Commit: `Add privacy-safe shared learning protocol`.

### Task 2: ControlBot aggregation and policy engine

**Files (ControlBot):** Create `src/AutoFactoryLearningEvent.php`, `src/AutoFactoryLearningPolicy.php`, `tests/autofactory_learning_scenarios.php`, `tests/test_autofactory_learning.py`.

**Interfaces:** Produces `AutoFactoryLearningEvent::ingest(array $batch, array $state, int $now): array` and `AutoFactoryLearningPolicy::build(array $state, int $now): array`.

- [ ] Write failing scenarios for deduplication, atomic rejection, per-context counts, weighted ranking, minimum samples `20`, confidence `0.80`, 30-day raw expiry, and evidence decay.
- [ ] Run `python3 -m unittest tests/test_autofactory_learning.py`; expect missing-class failure.
- [ ] Implement bounded aggregate state and allowlist-only policies; discard raw unknown/private fields.
- [ ] Run focused and standard ControlBot suites; expect PASS.
- [ ] Commit: `Add AutoFactory shared learning policy engine`.

### Task 3: Authenticated ControlBot synchronization contract

**Files (ControlBot):** Modify `src/ExternalApiContract.php`; create `src/AutoFactoryLearningEndpoint.php`, endpoint scenarios/tests; update the API contract fixture used by `tests/test_external_api_contract.py`.

**Interfaces:** Produces authenticated `POST /api/v1/autofactory/learning-events` and `GET /api/v1/autofactory/learning-policy?after={version}` with scopes `autofactory.learning.write` and `autofactory.learning.read`.

- [ ] Write failing tests for authorization, scope isolation, idempotency, payload limits, conditional snapshots, kill switch, rollback, and secret-free responses/logs.
- [ ] Run focused endpoint and external-contract tests; expect route/class failures.
- [ ] Implement both operations through the existing external request gate and Task 2 engine.
- [ ] Run focused and external API suites; expect PASS.
- [ ] Commit: `Expose authenticated AutoFactory learning sync`.

### Task 4: Extension synchronization, cache, and offline fallback

**Files:** Create `shared-learning-sync.js`, `test-shared-learning-sync.cjs`; modify `background-entry.js`, `background.js`, `manifest.json`, `package.json`.

**Interfaces:** Produces `createSharedLearningSync({storage,clock,schedule,fetchPolicy,uploadEvents})` with `start()`, `record(event)`, `sync()`, `snapshot()`, `reset()`, `rollback()`.

- [ ] Write failing tests for queue `200`, batches `25`, startup sync, 15-minute polling, backoff capped at 30 minutes, skew, expired cache, kill switch, rollback, and offline defaults.
- [ ] Run `node test-shared-learning-sync.cjs`; expect missing-module failure.
- [ ] Implement the coordinator and route sanitized learning outcomes through it while retaining local counters.
- [ ] Add the configured ControlBot origin to permissions and load the module before `background.js`.
- [ ] Run focused tests and `npm test`; expect PASS.
- [ ] Commit: `Sync shared learning through ControlBot`.

### Task 5: Cross-tab incident lease and chat deduplication

**Files:** Create `recovery-incident.js`, `test-recovery-incident.cjs`; modify `background-entry.js`, `background.js`, `content.js`, `package.json`.

**Interfaces:** Adds `autopilot:incident-acquire`, `autopilot:incident-complete`, `autopilot:incident-release`; returns `{granted,incidentId,expiresAt,replacementOpened}`.

- [ ] Write failing tests for concurrent acquisition, expiry, stale owners, reload persistence, completion, and exactly one replacement-chat grant.
- [ ] Run `node test-recovery-incident.cjs`; expect missing behavior.
- [ ] Implement a storage-backed lease using normalized problem code, coarse route, and bounded time bucket; exclude conversation IDs.
- [ ] Require a lease before retry, reload, or replacement-chat execution.
- [ ] Run focused, interruption, reliability, and full tests; expect PASS.
- [ ] Commit: `Coordinate recovery incidents across tabs`.

### Task 6: Guarded adaptive resolver

**Files:** Create `adaptive-recovery.js`, `test-adaptive-recovery.cjs`; modify `reliability.js`, `content.js`, `background-entry.js`, `manifest.json`, `package.json`.

**Interfaces:** Produces `chooseRecovery({problemCode,interfaceState,isResponding,attempt,defaults,policy,mode}) -> {action,source,confidence,policyVersion}` for `mode=off|observe|enforce`.

- [ ] Write failing tests for every invariant, unknown contexts, low confidence, stale advice, active responses, bounded attempts, one-chat limit, observation mode, and fallback reporting.
- [ ] Run `node test-adaptive-recovery.cjs`; expect missing-module failure.
- [ ] Implement the pure resolver and route existing decisions through it without duplicating action execution.
- [ ] Default new and migrated installations to `observe`; allow `enforce` only when both ControlBot and the local feature flag permit it.
- [ ] Run focused and full tests; expect PASS.
- [ ] Commit: `Add guarded adaptive recovery resolver`.

### Task 7: Controls, metrics, Safari parity, and packaging

**Files:** Modify `popup.html`, `popup.js`, `test-popup-security.cjs`, `scripts/package-release.py`, Safari manifest/resources, `README.md`, `CHANGELOG.md`.

**Interfaces:** Displays `enabled,lastSyncAt,policyVersion,localSamples,sharedSamples,confidence,successRate,source,mode,lastError`.

- [ ] Write failing popup tests for enable/disable, sync time, policy, samples, confidence, source, reset, and rollback with safe DOM insertion.
- [ ] Add the compact panel and handlers for status, reset, disable, and rollback.
- [ ] Run `./build-safari.sh`; verify Chrome/Safari module parity and load order.
- [ ] Run `npm test`, Chrome/Safari smoke tests, and release-evidence checks; expect PASS.
- [ ] Document the observation gate, bump one release version everywhere, and commit: `Ship shared adaptive learning in observation mode`.

### Task 8: End-to-end staged activation

**Files:** Create `tests/test_shared_learning_e2e.py`; modify `docs/RELEASE-EVIDENCE.md`.

- [ ] Prove one browser's sanitized success changes another browser's observation recommendation while duplicate incidents create at most one replacement chat.
- [ ] Test ControlBot outage, revoked policy, rollback, restart, Safari/Chrome version skew, and active-response preservation.
- [ ] Run complete AutoFactory and ControlBot suites plus E2E; record passing commands and artifact hashes.
- [ ] Enable `enforce` only after at least `20` samples and `0.80` confidence for that context; otherwise ship observation mode.
- [ ] Commit: `Verify shared adaptive learning rollout`.
