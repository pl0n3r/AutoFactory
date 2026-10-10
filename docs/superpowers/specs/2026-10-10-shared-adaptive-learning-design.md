# Shared Adaptive Learning Design

## Goal

Share AutoFactory recovery learning across every authorized browser, tab, and computer through ControlBot. AutoFactory should improve its recovery choices from observed outcomes without modifying its own code or exposing conversation data.

## Architecture

ControlBot is the central learning service. Each extension instance keeps a local cache, sends sanitized outcome events, and periodically receives a versioned policy snapshot. Tabs in one browser continue sharing state through extension storage; ControlBot connects otherwise isolated Chrome, Safari, and device installations.

The extension remains functional offline using the last valid snapshot and built-in defaults.

## Shared events

An event contains:

- Random installation and event identifiers.
- Browser family and AutoFactory version.
- Normalized problem code and coarse interface state.
- Selected recovery action, duration, attempt number, and outcome.
- Policy version and timestamp.

Events must not contain prompts, responses, conversation identifiers, URLs, repository names, account identifiers, page text, DOM content, or authentication material. ControlBot deduplicates event identifiers and expires raw events after aggregation.

## Adaptive policy

ControlBot aggregates success rate, completion time, and sample count by problem context. It returns ranked choices only from this allowlist:

- Wait.
- Retry the visible action.
- Reload the current page.
- Stop an interrupted response and wait.
- Open one replacement chat when the current conversation is conclusively unavailable or has reached its duration limit.

The policy never supplies executable code, selectors, URLs, or arbitrary browser actions. A recommendation becomes active only after a minimum sample count and confidence threshold. Recent evidence has greater weight, failed strategies decay, and exploration is tightly capped.

## Safety invariants

Local rules always override learned recommendations:

- Never interrupt a response solely because a timer expired.
- Never open a replacement chat while the existing chat is responding.
- At most one replacement chat may be opened for a recovery incident.
- Reloads and retries are bounded and use cooldowns.
- An installation can disable shared learning or reset to defaults.
- ControlBot can revoke a policy version through a kill switch.
- Invalid, expired, unsigned, or incompatible snapshots are rejected.

## Synchronization

Each installation uploads a small bounded batch after a meaningful outcome and downloads policy changes on startup and at a conservative interval. Uploads use idempotent event IDs. Snapshot updates use schema versions, monotonic policy versions, expiration times, and integrity verification.

Concurrent tabs do not independently trigger the same recovery. The browser background process owns a per-incident lease, and ControlBot provides an optional cross-device incident key when enough non-sensitive context exists. If coordination is uncertain, AutoFactory waits instead of creating another chat.

## User interface

The status panel shows:

- Shared learning on/off and last synchronization.
- Current policy version.
- Local and shared sample counts.
- Confidence and success rate for the selected recovery.
- Whether the current choice came from defaults, local learning, or shared learning.
- Reset, disable, and rollback controls.

Detailed diagnostics remain exportable without private conversation content.

## Failure handling

ControlBot unavailability never blocks AutoFactory. The extension uses its cached policy until expiry, then returns to built-in defaults. Rejected uploads remain in a bounded queue with exponential backoff. Storage is capped, aggregated counters replace old event details, and obsolete schemas are discarded.

## Delivery stages

1. Define versioned event and policy schemas plus privacy tests.
2. Add the ControlBot storage and authenticated synchronization endpoints.
3. Add extension upload, cache, validation, and offline fallback.
4. Add the allowlisted adaptive resolver in observation-only mode.
5. Compare recommendations with current behavior, then enable them behind a feature flag.
6. Add status metrics, reset, rollback, and global disable controls.
7. Enable staged rollout across Chrome and Safari after recovery and concurrency tests pass.

## Acceptance criteria

- Learning produced in one authorized browser becomes visible to another without copying private chat data.
- The same incident cannot create repeated replacement chats.
- Active responses survive refresh and recovery timers.
- A bad shared policy can be disabled or rolled back immediately.
- AutoFactory operates safely when ControlBot is unreachable.
- Tests cover event privacy, deduplication, policy validation, confidence gates, leases, offline behavior, and rollback.
