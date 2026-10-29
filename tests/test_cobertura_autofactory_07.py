#!/usr/bin/env python3
"""AutoFactory #397: real offline README contracts, never live-ready evidence.

A = exercised *local* sub-contract, not an integral coverage promotion.
B = authentic world/browser/release receipts required; C = policy/reference.
Only one file is modified, with no network, personal data or secrets.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs/matriz-cobertura.md"
UNKNOWN = "UNKNOWN"

OFFLINE = {
    "README-06-04": "Real manifest validator rejects unapproved LAN/network permissions.",
    "README-06-05": "Real release verifier demands matching version/SHA, both smokes and rollback.",
    "README-07-04": "Real release verifier never treats an isolated green CI as delivery.",
    "README-07-05": "Real release verifier refuses evidence missing Chrome/Safari smoke.",
    "README-08-01": "Real command authorizer masks secret text in denied operations.",
    "README-08-02": "Real authorizer rejects ungranted send/purchase and broadcast actions.",
    "README-08-03": "Real account budget refuses a second send after capacity is consumed.",
    "README-08-06": "Real Chrome/Safari source preflight refuses a mismatched resource.",
    "README-08-07": "Real local publisher refuses traffic without opt-in and LAN permission.",
}
EXTERNAL = {
    "README-07-01": "Real serialized GitHub V3 reservation/CI/review/release/install receipts.",
    "README-08-05": "Authentic previous *installable* artifact and tested rollback on both browsers.",
    "README-09-04": "GitHub Releases/tag identity and CHANGELOG need authenticated provenance.",
}
DECLARATIVE = {
    "README-06-03": "Absence of a Hostinger backend is a product architecture statement.",
    "README-07-02": "Fallback when coordination bot is unavailable is an owner policy.",
    "README-07-03": "Canonical Factory coordination routing is a workflow rule.",
    "README-08-04": "Changes in personal-data treatment require legal/governance decisions.",
    "README-09-01": "Roadmap and readiness are source links, not locally callable behavior.",
    "README-09-02": "Issues and PRs are external execution references.",
    "README-09-03": "Policy file references are document provenance, not runtime.",
    "README-09-05": "PLAN-AGENTES.md is the normative external source of truth.",
}
ALL = frozenset(OFFLINE) | frozenset(EXTERNAL) | frozenset(DECLARATIVE)

NODE = r"""
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateExtensionTree } = require('./scripts/verify-extension-assets.cjs');
const { verifyReleaseEvidence } = require('./scripts/verify-release-evidence.cjs');
const { createCommandAuthorizer } = require('./factory-control-authorization.js');
const budget = require('./account-budget.js');
const { createPublisher } = require('./factory-control-local-publisher.js');
const ROOT = process.cwd();
const verified = [], denied = [];
const record = id => verified.push(id);
const deny = id => denied.push(id);
const release = () => ({
  tag: 'v1.2.3', commit_sha: 'a'.repeat(40),
  preflight: 'success', publish: 'success', chrome_smoke: 'success',
  safari_smoke: 'success', rollback: 'success'
});
const manifest = JSON.parse(fs.readFileSync('manifest.json','utf8'));
const fakeIO = changes => ({
  lstatSync: file => fs.lstatSync(file),
  readFileSync(file) {
    const absolute = path.resolve(file);
    const substitute = changes.get(absolute);
    return substitute === undefined ? fs.readFileSync(file) : substitute;
  }
});
const changed = (file, bytes) => fakeIO(new Map([[path.resolve(file), bytes]]));
async function check(mode) {
  if (mode !== 'principal' && mode !== 'negatives') throw Error('invalid mode');

  // Read actual validated sources without network or modifying Safari.
  const parity = validateExtensionTree(ROOT);
  assert.match(parity.version, /^\d+\.\d+\.\d+$/);
  assert.ok(parity.assets >= 9);
  assert.deepEqual(manifest.host_permissions, ['https://chatgpt.com/*']);
  assert.ok(manifest.optional_host_permissions.includes('http://127.0.0.1:8777/*'));
  assert.ok(!manifest.permissions.includes('debugger'));
  record('README-06-04');

  const permissionExpansion = {
    ...manifest, permissions: [...manifest.permissions, 'debugger']
  };
  assert.throws(
    () => validateExtensionTree(ROOT,
      changed('manifest.json', Buffer.from(JSON.stringify(permissionExpansion)))),
    /unexpected permission or host/
  );
  deny('network-permission-expansion');

  const safariManifest = path.join(ROOT,'safari','ChatGPT Autopilot Local Extension',
    'Resources','manifest.json');
  assert.throws(
    () => validateExtensionTree(ROOT,
      changed(safariManifest, Buffer.from('synthetic-divergent-safari-manifest'))),
    /Chrome\/Safari asset mismatch/
  );
  record('README-08-06');
  deny('safari-mirror-mismatch');

  assert.equal(verifyReleaseEvidence(release()).verified, true);
  assert.equal(verifyReleaseEvidence({...release(),commit_sha:'unknown'}).verified, false);
  assert.equal(verifyReleaseEvidence({...release(),rollback:'pending'}).verified, false);
  record('README-06-05');
  deny('untrusted-release-identity');

  assert.equal(verifyReleaseEvidence({preflight:'success'}).verified, false);
  assert.equal(verifyReleaseEvidence({...release(),publish:'pending'}).verified, false);
  record('README-07-04');
  deny('isolated-ci-not-release');

  assert.equal(verifyReleaseEvidence({...release(),chrome_smoke:'skipped'}).verified, false);
  assert.equal(verifyReleaseEvidence({...release(),safari_smoke:'skipped'}).verified, false);
  record('README-07-05');
  deny('missing-browser-smoke');

  const grant = {
    profileAlias:'fixture', expiresAt:10000, revoked:false,
    actions:['pause'],tabIds:[7],broadcast:false
  };
  const context = {profileAlias:'fixture',enabledTabIds:[7]};
  const authorizer = createCommandAuthorizer({
    loadVerifiedGrant:async()=>structuredClone(grant),now:()=>1000
  });
  const allowed = await authorizer.authorize(
    {id:'pause01',action:'pause',target:7},context
  );
  assert.equal(allowed.action,'pause');
  assert.equal(allowed.target,7);
  const syntheticSecret = 'SYNTHETIC_PRIVATE_TEXT_NOT_LOGGED';
  await assert.rejects(
    authorizer.authorize({
      id:'send01',action:'send_message',target:7,
      payload:{text:syntheticSecret}
    },context),
    error => error instanceof TypeError &&
      error.message === 'Command not authorized' &&
      !error.message.includes(syntheticSecret)
  );
  record('README-08-01');
  deny('private-payload-not-in-error');

  await assert.rejects(
    authorizer.authorize({id:'buy01',action:'purchase',target:7},context),
    /Command not authorized/
  );
  await assert.rejects(
    authorizer.authorize({id:'wide01',action:'pause',target:'all'},context),
    /Command not authorized/
  );
  const revoked = createCommandAuthorizer({
    loadVerifiedGrant:async()=>({...grant,revoked:true}),now:()=>1000
  });
  await assert.rejects(
    revoked.authorize({id:'pause01',action:'pause',target:7},context),
    /Command not authorized/
  );
  record('README-08-02');
  deny('purchases-broadcast-revoked');

  const input = {accountAlias:'fixture',reasoningLevel:'low',
    now:100000,policy:{limit:1,windowMs:60000}};
  const once = budget.consume({},input);
  assert.equal(once.allowed,true);
  const twice = budget.consume(once.state,{...input,now:100001});
  assert.equal(twice.allowed,false);
  assert.equal(twice.snapshot.remaining,0);
  assert.throws(()=>budget.consume({}, {...input,now:-1}),/Invalid budget clock/);
  record('README-08-03');
  deny('capacity-exhausted');

  let posts=0, snapshots=0;
  const publisher = opts => createPublisher({
    now:()=>100000,enabled:async()=>opts.enabled,
    permission:async()=>opts.permission,
    snapshot:async()=>{ snapshots += 1; throw new Error('snapshot should be denied'); },
    post:async()=>{ posts += 1; return true; }
  });
  assert.equal(await publisher({enabled:false,permission:true}).publish(),false);
  assert.equal(await publisher({enabled:true,permission:false}).publish(),false);
  assert.equal(posts,0);
  assert.equal(snapshots,0);
  record('README-08-07');
  deny('bridge-without-optin-or-permission');

  assert.equal(verified.length,9);
  assert.equal(denied.length,9);
  // This object is the entire observable output of the synthetic probe.
  process.stdout.write(JSON.stringify({
    verified,denied,operational_state:'UNKNOWN',requests_sent:posts
  }));
}
check(process.argv[1]).catch(() => {
  // Never echo arbitrary JS exceptions with potential synthetic payloads.
  process.stderr.write('Real AutoFactory offline acceptance probe failed\n');
  process.exitCode=1;
});
"""


def matrix_rows(text: object) -> dict[str, tuple[str, ...]]:
    """Reject missing, duplicate, malformed or prematurely promoted target IDs."""
    if type(text) is not str:
        raise ValueError("UNKNOWN: missing matrix")
    found: dict[str, tuple[str, ...]] = {}
    for line in text.splitlines():
        if not line.startswith("| README-"):
            continue
        columns = tuple(field.strip() for field in line.strip().strip("|").split("|"))
        if not columns:
            continue
        key = columns[0].split(" · ", 1)[0]
        if key not in ALL:
            continue
        if (key in found or len(columns) != 5
                or columns[0] != key + " · README.md"
                or not all(columns)
                or columns[2] != "NO_VERIFICABLE"
                or not columns[4].startswith("[#")):
            raise ValueError("UNKNOWN: invalid target " + key)
        found[key] = columns
    if set(found) != ALL:
        raise ValueError("UNKNOWN: missing target rows")
    return found


def run_probe(mode: str) -> dict[str, object]:
    """Call the actual Node modules, with no HTTP or inherited credentials."""
    if mode not in {"principal", "negatives"}:
        raise ValueError("UNKNOWN: disallowed mode")
    node = shutil.which("node")
    if not node:
        raise AssertionError("UNKNOWN: Node >=20 unavailable")
    env = {k: os.environ[k] for k in ("PATH", "LANG", "LC_ALL") if k in os.environ}
    p = subprocess.run(
        [node, "-e", NODE, mode], cwd=ROOT, env=env, text=True,
        capture_output=True, timeout=35, check=False
    )
    if p.returncode:
        raise AssertionError("UNKNOWN: real JS acceptance probe failed")
    try:
        result = json.loads(p.stdout)
    except (json.JSONDecodeError, TypeError) as error:
        raise AssertionError("UNKNOWN: invalid JS evidence") from error
    if type(result) is not dict:
        raise AssertionError("UNKNOWN: invalid JS evidence")
    return result


class CoberturaAutofactory07Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.matrix = MATRIX.read_text(encoding="utf-8")
        cls.rows = matrix_rows(cls.matrix)
        cls.probe = run_probe("principal")

    def test_contrato_principal(self):
        """AC-01: 9 real offline probes, with explicit B/C boundary for 11."""
        self.assertEqual(20, len(ALL))
        self.assertEqual(9, len(OFFLINE))
        self.assertEqual(3, len(EXTERNAL))
        self.assertEqual(8, len(DECLARATIVE))
        self.assertEqual(ALL, set(self.rows))
        self.assertEqual(set(OFFLINE), set(self.probe["verified"]))
        for key, columns in self.rows.items():
            with self.subTest(row=key):
                self.assertTrue(columns[1])
                self.assertEqual("NO_VERIFICABLE", columns[2])
                self.assertEqual("UNKNOWN", self.probe["operational_state"])
        for reason in (*EXTERNAL.values(), *DECLARATIVE.values()):
            self.assertTrue(reason)

    def test_falla_cerrado(self):
        """AC-02: malformed inventory, missing permissions and quota denied."""
        first = next(line for line in self.matrix.splitlines()
                     if line.startswith("| README-06-04 · README.md |"))
        cases = [
            None,
            self.matrix.replace(first + "\n", "", 1),
            self.matrix + "\n" + first,
            self.matrix.replace(first, first.replace("NO_VERIFICABLE", "CUBIERTO"), 1),
            self.matrix.replace(first, "| README-06-04 · README.md | malformed |", 1),
        ]
        for corrupt in cases:
            with self.subTest(case=str(corrupt)[:32]):
                with self.assertRaisesRegex(ValueError, UNKNOWN):
                    matrix_rows(corrupt)
        self.assertEqual({
            "network-permission-expansion",
            "safari-mirror-mismatch",
            "untrusted-release-identity",
            "isolated-ci-not-release",
            "missing-browser-smoke",
            "private-payload-not-in-error",
            "purchases-broadcast-revoked",
            "capacity-exhausted",
            "bridge-without-optin-or-permission",
        }, set(self.probe["denied"]))
        self.assertEqual(0, self.probe["requests_sent"])
        self.assertEqual("UNKNOWN", self.probe["operational_state"])

    def test_sin_datos_reales(self):
        """AC-03: synthetic-only outputs, no live traffic, credentials or PII."""
        self.assertTrue(MATRIX.is_file())
        self.assertEqual(
            {"verified", "denied", "operational_state", "requests_sent"},
            set(self.probe)
        )
        self.assertEqual(0, self.probe["requests_sent"])
        self.assertNotRegex(NODE, r"\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(")
        self.assertNotRegex(NODE, r"require\(['\"](?:net|tls|https?|child_process)")
        output = json.dumps(self.probe, ensure_ascii=False)
        for forbidden in (
            "SYNTHETIC_PRIVATE", "Bearer ", "ghp_", "sk-",
            "chatgpt.com/c/", "profileAlias", "accountAlias"
        ):
            self.assertNotIn(forbidden, output)


if __name__ == "__main__":
    unittest.main()
