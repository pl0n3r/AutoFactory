# AutoFactory Instance Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert AutoFactory's isolated ControlBot contracts into a browser-instance runtime that can pause or resume all ChatGPT tabs in one Chrome or Safari installation.

**Architecture:** Protocol v2 addresses stable browser instances instead of individual tabs. The background runtime owns identity, authorization, idempotency and tab fan-out; content scripts only apply local state. A transport interface remains disconnected from real endpoints until the macOS agent and legal gate are ready.

**Tech Stack:** JavaScript, WebExtensions MV3, Node.js tests, Chrome, Safari Web Extension.

**Spec:** `docs/superpowers/specs/2026-09-26-controlbot-instance-control-design.md`

## Global Constraints

- Preserve Chrome/Safari byte parity and existing permissions/origins.
- Never include chat text, URLs, account identifiers or secrets in commands, receipts, presence or logs.
- Only `pause` and `resume` are executable in this delivery.
- Do not enable a real ControlBot endpoint before verified consent, security validation and ControlBot#20.
- Keep protocol v1 parsing available only for existing tests; runtime emits v2.
- Every behavioral change follows red-green TDD and ends with `npm test`.

## Review Focus

- A command for another `instanceId` must return `not_found` without changing any tab.
- A duplicate command after restart must return the persisted receipt without reapplying state.
- One failed tab must produce `failed`, trigger reconciliation and never claim complete success.
- Revocation during authorization must prevent fan-out.
- Presence must reject extra fields that could carry private data.

---

### Task 1: Protocol v2 instance contracts

**Files:**
- Modify: `factory-control-protocol.js`
- Modify: `factory-control-authorization.js`
- Modify: `factory-control-ledger.js`
- Modify: `test-factory-control.cjs`
- Modify: `test-factory-control-ledger.cjs`

**Interfaces:**
- Produces: `protocol.presence(input)`, `protocol.command(input)`, `protocol.acknowledgement(input)` for v2.
- Produces command shape `{version:2,kind:'command',id,action,target,issuedAt,expiresAt}`.
- Produces receipt shape `{version:2,kind:'ack',id,instanceId,ok,code,enabled,appliedTabs}`.

- [ ] **Step 1: Write failing v2 protocol tests** asserting exact fields, UUID `instanceId`, `pause/resume`, timestamps, TTL, bounded tab count and rejection of extra/private fields.
- [ ] **Step 2: Run `node test-factory-control.cjs`** and confirm failure because v2 contracts do not exist.
- [ ] **Step 3: Implement the minimal v2 validators** while keeping v1 contract functions isolated for compatibility.
- [ ] **Step 4: Write failing authorization and ledger tests** for wrong instance, expired command, mid-flight revocation, duplicate-after-restart and full ledger.
- [ ] **Step 5: Run focused tests** and confirm the new cases fail for the intended reasons.
- [ ] **Step 6: Update authorization and ledger** to consume v2, persist terminal receipts and fail closed.
- [ ] **Step 7: Run `node test-factory-control.cjs && node test-factory-control-ledger.cjs`**; expected PASS.
- [ ] **Step 8: Commit** with `git commit -m "feat(control): add instance protocol v2"`.

### Task 2: Stable instance identity and consent

**Files:**
- Create: `factory-control-instance.js`
- Create: `test-factory-control-instance.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: WebExtension storage adapter `{get,set,remove}`.
- Produces: `createInstanceStore({storage,uuid,now,browser})` with `load()`, `create(alias,deviceAlias)`, `grant(record)`, `revoke()` and `safeSnapshot()`.
- Snapshot fields: `instanceId`, `browser`, `profileAlias`, `deviceAlias`, `extensionVersion`, `protocolVersion`.

- [ ] **Step 1: Write failing identity tests** for UUID stability, Chrome/Safari separation, exact alias rules, malformed storage, revocation and absence of secrets.
- [ ] **Step 2: Run `node test-factory-control-instance.cjs`**; expected failure because the module is absent.
- [ ] **Step 3: Implement the store** with immutable identity, bounded aliases and fail-closed malformed state.
- [ ] **Step 4: Add the test to `npm test`** and run it; expected PASS.
- [ ] **Step 5: Commit** with `git commit -m "feat(control): persist browser instance identity"`.

### Task 3: Background instance coordinator

**Files:**
- Create: `factory-control-runtime.js`
- Create: `test-factory-control-runtime.cjs`
- Modify: `background.js`
- Modify: `manifest.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: v2 protocol, authorizer, ledger, instance store and adapters `listChatTabs()`, `sendTab(tabId,message)`, `loadMasterEnabled()`, `saveMasterEnabled(enabled)`.
- Produces: `createInstanceRuntime(deps)` with `presence()`, `execute(command)` and `reconcile()`.

- [ ] **Step 1: Write failing runtime tests** for pause/resume fan-out, wrong instance, disconnected tab, partial failure, reconciliation and concurrent duplicate IDs.
- [ ] **Step 2: Run `node test-factory-control-runtime.cjs`** and confirm the missing runtime failure.
- [ ] **Step 3: Implement `createInstanceRuntime`** so persistence occurs before fan-out and success requires every current ChatGPT tab plus saved master state.
- [ ] **Step 4: Integrate the runtime into `background.js`** behind `controlBridgeEnabled:false`; no network or new permissions.
- [ ] **Step 5: Run focused tests and `npm test`**; expected PASS.
- [ ] **Step 6: Commit** with `git commit -m "feat(control): coordinate instance pause and resume"`.

### Task 4: Extension-to-agent transport boundary

**Files:**
- Create: `factory-control-transport.js`
- Create: `test-factory-control-transport.cjs`
- Modify: `background.js`
- Modify: `popup.html`
- Modify: `popup.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `createTransport({connect,instanceStore,runtime,clock})` with `start()`, `stop()`, `status()`.
- Transport accepts only authenticated local-agent envelopes and returns v2 receipts.
- Popup displays bridge state and supports explicit pair/revoke adapters without handling private keys.

- [ ] **Step 1: Write failing transport tests** for unauthenticated envelope, revoked grant, oversized frame, reconnect backoff and content-free diagnostics.
- [ ] **Step 2: Run `node test-factory-control-transport.cjs`**; expected failure because the module is absent.
- [ ] **Step 3: Implement the disabled transport boundary** with dependency-injected local connection and bounded backoff.
- [ ] **Step 4: Add popup status and pair/revoke controls** that remain disabled until an agent adapter is present.
- [ ] **Step 5: Run focused tests and `npm test`**; expected PASS with no permission/origin expansion.
- [ ] **Step 6: Commit** with `git commit -m "feat(control): add local agent transport boundary"`.

### Task 5: Browser parity and installation smoke

**Files:**
- Modify: `scripts/verify-extension-assets.cjs`
- Modify: `test-extension-integrity.cjs`
- Modify: `safari/ChatGPT Autopilot Local Extension/Resources/*` through `build-safari.sh`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes the completed runtime and transport files.
- Produces identical Chrome/Safari web assets and documented manual smoke evidence.

- [ ] **Step 1: Add failing preflight assertions** for every new declared asset and continued permission/origin allowlists.
- [ ] **Step 2: Run `npm test`** and confirm parity failure before synchronization.
- [ ] **Step 3: Run `./build-safari.sh`** and synchronize the external Safari development project.
- [ ] **Step 4: Run `npm test` and the Safari build**; expected PASS/BUILD SUCCEEDED.
- [ ] **Step 5: Smoke Chrome and Safari** with synthetic local commands: pausing one browser must leave the other active; record version/SHA evidence without chat data.
- [ ] **Step 6: Commit** with `git commit -m "test(control): verify per-browser instance control"`.
