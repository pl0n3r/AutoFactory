# Release evidence and provenance

A GitHub Release existing with assets is **not** sufficient evidence that AutoFactory is verified or GREEN.

The canonical release-evidence gate requires all five signals for the same tag and commit:

- `preflight=success`
- `publish=success`
- `chrome_smoke=success`
- `safari_smoke=success`
- `rollback=success`

`scripts/verify-release-evidence.cjs` fails closed when any field is missing, failed, skipped, malformed, or unknown. The gate does not manufacture smoke evidence; Chrome/Safari smoke and rollback must come from their real validation surfaces.

## Historical provenance incident #31

The following releases remain intact. Their assets, tags, visibility and files were not modified by the remediation.

| Tag | Provenance | Workflow evidence | Asset digests |
| --- | --- | --- | --- |
| `v1.6.3` | `owner-uploaded / CI not verified` | Release run `36185980213`: `preflight=failure`, runner was not assigned, `publish=skipped` | Chrome `sha256:8b40b77fbd83cb04b785825e8b5ad045cdeb796b90754700d4217da163c82b03`; Safari `sha256:160ac2ed7e9990cd52cdff52ac87b515b0e642064a79413847e91f1efdca79a7` |
| `v1.6.4` | `owner-uploaded / CI not verified` | Release run `36186843982`: `preflight=failure`, runner was not assigned, `publish=skipped` | Chrome `sha256:1633d75558dd20642f5d64d6e255a43519832d6d83ff3075d3b85c620856579e`; Safari `sha256:1a724a2407f70d746956e91f8443a83058d31492e2b78b9ef894aed55c26e3b2` |

The upload account recorded by GitHub is `pl0n3r`. This record does not infer the build method and does not claim compromise or unsafe artifacts.

## Recovery evidence

Runner availability recovered by 2026-09-27. On exact main SHA `2c9d6889e95ddd4b78f16c8b574244e184e0448c`, Validate runs `36283064514` and `36283066047` both executed `npm test` successfully. Release run `36283066063` executed `preflight=success` and `publish=success`.

Those results prove runner recovery and CI execution. They do **not** retroactively make v1.6.3/v1.6.4 CI-verified, and they do not by themselves satisfy Chrome/Safari smoke plus rollback for GREEN status.

ControlBot#20 remains the legal gate for real pairing/traffic. This document does not authorize go-live, expanded permissions, payments, release deletion, or asset replacement.

## 1.7.0 shared adaptive learning observation gate

- Shared outcome schema rejects private and unknown fields and caps batches at 16 KiB.
- Cross-tab incident leases allow one replacement chat per incident.
- Cross-instance test proves policy transfer in observation mode without changing the local default action.
- Chrome/Safari sources are mirrored and smoke-tested.
- Remote ControlBot transport and enforcement remain disabled until consent, security validation, and legal gate #20 are complete.
