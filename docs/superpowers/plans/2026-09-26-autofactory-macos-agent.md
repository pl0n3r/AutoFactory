# AutoFactory macOS Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a signed macOS agent that securely connects Chrome and Safari instances to local and remote ControlBot control.

**Architecture:** A Swift core owns Keychain credentials, instance routing, receipts and outbound HTTPS polling. Browser-specific native messaging adapters expose only the v2 protocol. Networking remains synthetic until the legal and security gates are green.

**Tech Stack:** Swift Package Manager, Foundation, Security/Keychain, URLSession, XCTest, macOS native messaging.

**Spec:** `docs/superpowers/specs/2026-09-26-controlbot-instance-control-design.md`

## Global Constraints

- No inbound public listener, WebSocket requirement or arbitrary command execution.
- Private keys stay in macOS Keychain; extensions receive only signed envelopes and public metadata.
- Remote transport is outbound HTTPS polling with backoff and short command expiry.
- Real ControlBot delivery remains disabled until ControlBot#20 and security validation are complete.
- Logs contain command IDs, codes and counts only.

## Review Focus

- Keychain unavailable or locked must fail closed without regenerating identity.
- Two browsers with the same profile alias must remain distinct by `instanceId`.
- Poll responses replayed after restart must not execute twice.
- Clock rollback must invalidate command processing until time becomes trustworthy.
- A revoked instance must be disconnected before the next delivery attempt.

---

### Task 1: Agent core package and canonical models

**Files:**
- Create: `agent-macos/Package.swift`
- Create: `agent-macos/Sources/AutoFactoryAgentCore/Models.swift`
- Create: `agent-macos/Sources/AutoFactoryAgentCore/CanonicalJSON.swift`
- Create: `agent-macos/Tests/AutoFactoryAgentCoreTests/ModelsTests.swift`

**Interfaces:**
- Produces Codable `InstancePresence`, `InstanceCommand`, `InstanceReceipt`, `PairingGrant` matching protocol v2 exactly.
- Produces `CanonicalJSON.encode<T:Encodable>(_:) throws -> Data`.

- [ ] Write failing XCTest cases for exact fields, UUIDs, bounds, canonical ordering and extra-field rejection.
- [ ] Run `swift test --package-path agent-macos`; confirm failure for missing models.
- [ ] Implement models and canonical encoding.
- [ ] Run the focused suite; expected PASS.
- [ ] Commit with `git commit -m "feat(agent): define protocol v2 models"`.

### Task 2: Keychain identity and pairing grants

**Files:**
- Create: `agent-macos/Sources/AutoFactoryAgentCore/KeyStore.swift`
- Create: `agent-macos/Sources/AutoFactoryAgentCore/PairingStore.swift`
- Create: `agent-macos/Tests/AutoFactoryAgentCoreTests/PairingStoreTests.swift`

**Interfaces:**
- Produces `KeyStore` protocol and `MacKeychainStore` implementation.
- Produces `PairingStore.create(code:instance:)`, `verifiedGrant(instanceId:)`, `revoke(instanceId:)`.

- [ ] Write failing tests with an in-memory KeyStore for one-use code, expiry, restart, revocation and locked-store failure.
- [ ] Run focused XCTest and confirm expected failures.
- [ ] Implement grant lifecycle and Keychain adapter with no secret logging.
- [ ] Run XCTest; expected PASS.
- [ ] Commit with `git commit -m "feat(agent): secure pairing credentials"`.

### Task 3: Native browser router

**Files:**
- Create: `agent-macos/Sources/AutoFactoryAgentCore/BrowserRouter.swift`
- Create: `agent-macos/Sources/AutoFactoryAgentChrome/main.swift`
- Create: `agent-macos/Sources/AutoFactoryAgentSafari/SafariBridge.swift`
- Create: `agent-macos/Tests/AutoFactoryAgentCoreTests/BrowserRouterTests.swift`

**Interfaces:**
- Produces `BrowserSession` protocol with `instanceId`, `presence()`, `execute(_:)` and `disconnect()`.
- Produces `BrowserRouter.register(_:)`, `route(_:)`, `presence()` and `revoke(_:)`.

- [ ] Write failing tests for Chrome/Safari independence, duplicate registration, wrong target, disconnect and partial routing failure.
- [ ] Run focused XCTest and confirm failures.
- [ ] Implement bounded native-message framing and per-instance routing.
- [ ] Run XCTest; expected PASS.
- [ ] Commit with `git commit -m "feat(agent): route browser instance commands"`.

### Task 4: Outbound ControlBot client

**Files:**
- Create: `agent-macos/Sources/AutoFactoryAgentCore/RelayClient.swift`
- Create: `agent-macos/Sources/AutoFactoryAgentCore/Backoff.swift`
- Create: `agent-macos/Tests/AutoFactoryAgentCoreTests/RelayClientTests.swift`

**Interfaces:**
- Produces `RelayClient.poll()`, `submitPresence(_:)`, `submitReceipt(_:)`, `stop()` using injected `HTTPSession`, `Clock` and `PairingStore`.
- Poll interval: 5 seconds active, exponential backoff capped at 5 minutes after failures; commands expire server-defined and are revalidated locally.

- [ ] Write failing tests for TLS-only URL, signature verification, polling/backoff, replay, timeout, clock rollback and stop/revocation races.
- [ ] Run focused XCTest and confirm failures.
- [ ] Implement the outbound client with cancellation-aware URLSession tasks.
- [ ] Run XCTest; expected PASS.
- [ ] Commit with `git commit -m "feat(agent): add secure relay polling"`.

### Task 5: App lifecycle, diagnostics and packaging

**Files:**
- Create: `agent-macos/Sources/AutoFactoryAgentApp/AppDelegate.swift`
- Create: `agent-macos/Sources/AutoFactoryAgentApp/AgentStatusModel.swift`
- Create: `agent-macos/Tests/AutoFactoryAgentCoreTests/PrivacyTests.swift`
- Create: `agent-macos/README.md`

**Interfaces:**
- Produces menu-bar status, start-at-login opt-in, paired-instance list and revoke action.
- Produces bounded structured logs with allowlisted technical fields.

- [ ] Write failing lifecycle/privacy tests for restart restoration, no auto-start without opt-in, redaction and revocation shutdown.
- [ ] Run full `swift test --package-path agent-macos`; confirm failures.
- [ ] Implement app lifecycle and status UI without enabling real relay configuration.
- [ ] Build an unsigned Debug artifact and run synthetic Chrome/Safari smoke tests.
- [ ] Run full Swift tests and privacy scan; expected PASS.
- [ ] Commit with `git commit -m "feat(agent): package macOS control bridge"`.
