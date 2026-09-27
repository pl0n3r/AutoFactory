# ControlBot Instance Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private ControlBot dashboard and HTTPS relay that lists AutoFactory browser instances and safely pauses or resumes each one.

**Architecture:** PHP value objects validate protocol v2; MariaDB repositories persist instances, commands, receipts and audit records. The macOS agent polls authenticated HTTPS endpoints because Hostinger shared hosting cannot run permanent Node processes or WebSockets. Server-rendered UI follows ControlBot's existing fail-closed patterns.

**Tech Stack:** PHP 8.5, MariaDB, server-rendered HTML, Hostinger shared hosting, existing Python/PHP scenario tests.

**Spec:** `docs/superpowers/specs/2026-09-26-controlbot-instance-control-design.md`

## Global Constraints

- Work occurs in `pl0n3r/ControlBot` under its `AGENTES.md`, Factory v1 and owner decisions D-054 through D-059.
- No go-live, real data or provider endpoint until ControlBot#20 is resolved and privacy/security gates are green.
- Only the owner session may operate controls; bridge keys are per instance, paired and revocable.
- No WebSockets or permanent Node process on Hostinger.
- Database migrations are additive with backup before deployment.

## Review Focus

- Simultaneous pause and resume for one instance must serialize deterministically.
- A stale heartbeat must not appear active or accept an optimistic UI success.
- A receipt for another instance/command must be rejected and audited.
- Global control must report partial results without hiding offline instances.
- Database or audit-write failure must prevent command acceptance.

---

### Task 1: Protocol v2 PHP boundary

**Files:**
- Create: `src/AutoFactoryProtocol.php`
- Create: `tests/autofactory_protocol_scenarios.php`
- Create: `tests/test_autofactory_protocol.py`

**Interfaces:**
- Produces `AutoFactoryProtocol::presence(array): array`, `command(array): array`, `receipt(array): array` matching AutoFactory v2.

- [ ] Write failing PHP scenarios for valid messages, exact fields, bounds, expiry, UUIDs and private/extra field rejection.
- [ ] Add Python wrapper assertions and run `python -m pytest tests/test_autofactory_protocol.py -q`; confirm failure.
- [ ] Implement canonical validators with fail-closed exceptions.
- [ ] Run focused tests; expected PASS.
- [ ] Commit with `git commit -m "feat(agents): validate AutoFactory protocol v2"`.

### Task 2: Instance and command domain model

**Files:**
- Create: `src/AutoFactoryInstance.php`
- Create: `src/AutoFactoryCommandQueue.php`
- Create: `tests/autofactory_instance_scenarios.php`
- Create: `tests/test_autofactory_instances.py`

**Interfaces:**
- Produces immutable instance states `active`, `paused`, `running`, `error`, `offline` with freshness calculation.
- Produces queue operations `enqueue`, `leaseForInstance`, `complete`, `expire`, each idempotent by command ID.

- [ ] Write failing tests for freshness, state transitions, conflicting commands, expiry, replay and mismatched receipt.
- [ ] Run focused pytest; confirm failures.
- [ ] Implement models and queue interfaces independent of MariaDB.
- [ ] Run focused tests; expected PASS.
- [ ] Commit with `git commit -m "feat(agents): model instances and command queue"`.

### Task 3: MariaDB repositories and audit transaction

**Files:**
- Create: `src/AutoFactoryRepository.php`
- Create: `src/AutoFactoryAudit.php`
- Create: `migrations/20260926_autofactory_instances.sql`
- Create: `tests/autofactory_repository_scenarios.php`
- Modify: `datos.yml`

**Interfaces:**
- Produces repositories for pairing grants, instances, commands and receipts.
- `enqueueWithAudit()` and `completeWithAudit()` are single database transactions.

- [ ] Write failing repository contract tests for atomic audit, unique command IDs, lease recovery, revocation and additive migration rollback.
- [ ] Run repository scenarios against the test adapter; confirm failures.
- [ ] Implement repositories and additive migration without production connection values.
- [ ] Update `datos.yml` fields to instance-level metadata only; keep `review_required` and providers empty.
- [ ] Run privacy workflow and focused tests; expected PASS.
- [ ] Commit with `git commit -m "feat(agents): persist instance control safely"`.

### Task 4: Pairing and relay HTTPS endpoints

**Files:**
- Create: `src/AutoFactoryPairingEndpoint.php`
- Create: `src/AutoFactoryRelayEndpoint.php`
- Create: `tests/autofactory_relay_scenarios.php`
- Create: `tests/test_autofactory_relay.py`

**Interfaces:**
- Pairing: issue one-use code, exchange public keys, renew grant, revoke grant.
- Relay: submit presence, poll one leased command, submit receipt.
- All requests require per-instance signature, nonce, timestamp and rate limit.

- [ ] Write failing endpoint tests for owner-only pairing, one-use code, invalid signature, nonce replay, expiry, rate limit, revoked grant and receipt mismatch.
- [ ] Run focused pytest; confirm failures.
- [ ] Implement endpoints with injected repositories, clocks and signature verifier; keep route registration disabled by configuration.
- [ ] Run focused and security tests; expected PASS.
- [ ] Commit with `git commit -m "feat(agents): add paired HTTPS relay"`.

### Task 5: Private dashboard cards and controls

**Files:**
- Create: `src/AutoFactoryDashboard.php`
- Create: `src/AutoFactoryUi.php`
- Create: `tests/autofactory_ui_scenarios.php`
- Create: `tests/test_autofactory_ui.py`

**Interfaces:**
- Produces instance cards with alias, browser, state, version, tab count, last connection and last cycle.
- Produces owner actions `pauseInstance`, `resumeInstance`, `pauseAll`, `resumeAll` protected by OwnerSession and CSRF.

- [ ] Write failing UI tests for five states, stale timestamps, sending/received/confirmed progression, retry and partial global outcome.
- [ ] Write failing action tests for owner session, CSRF, duplicate click and offline instance.
- [ ] Run focused pytest; confirm failures.
- [ ] Implement server-rendered view models and action handlers that show success only after a valid receipt.
- [ ] Run focused tests; expected PASS.
- [ ] Commit with `git commit -m "feat(agents): add instance control dashboard"`.

### Task 6: Cross-product contract and release gates

**Files:**
- Create: `tests/fixtures/autofactory-v2/*.json`
- Create: `tests/test_autofactory_contract.py`
- Modify: `.github/workflows/ci.yml` or Factory-consumed equivalent only through the allowed integration point.
- Modify: `README.md`

**Interfaces:**
- Shared fixtures are accepted identically by ControlBot PHP, AutoFactory JS and macOS Swift implementations.

- [ ] Add fixtures for valid presence/commands/receipts and malformed, expired, replayed and privacy-violating messages.
- [ ] Run contract tests before wiring consumers; confirm expected failures.
- [ ] Wire the three suites to the shared fixture contract without enabling production routes.
- [ ] Run full ControlBot CI, AutoFactory `npm test`, agent `swift test`, privacy audit and synthetic end-to-end local/remote tests.
- [ ] Verify ControlBot#20 and security review remain explicit release blockers; no go-live while either is open.
- [ ] Commit with `git commit -m "test(agents): gate AutoFactory instance control"`.
