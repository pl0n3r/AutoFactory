"""AutoFactory #282: replay of a revoked fictitious pairing after restart."""
from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "factory-control-pairing-revoke-replay.js"
NODE_TEST = ROOT / "test-factory-control-pairing-revoke-replay.cjs"


def run_synthetic_contract() -> str:
    """Execute the actual Node contract with a sanitized child environment."""
    node = shutil.which("node") or "node"
    node_dir = os.path.dirname(node) if os.path.isabs(node) else ""
    env = {"PATH": ":".join(p for p in
           (node_dir, "/usr/local/bin", "/usr/bin", "/bin") if p)}
    result = subprocess.run(
        [node, NODE_TEST.name],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=45,
        check=False,
    )
    if result.returncode:
        raise AssertionError("Synthetic pairing replay contract failed")
    return result.stdout


class PairingRevokeReplayTests(unittest.TestCase):
    def test_revocation_blocks_replay_after_restart(self):
        self.assertIn("pairing-revoke-replay AC-01: ok", run_synthetic_contract())

    def test_synthetic_only_no_secrets(self):
        self.assertIn("pairing-revoke-replay AC-02: ok", run_synthetic_contract())
        sources = (MODULE.read_text(encoding="utf-8"),
                   NODE_TEST.read_text(encoding="utf-8"))
        self.assertIn("require('./factory-control-pairing.js')", sources[0])
        for source in sources:
            for forbidden in ("fetch(", "XMLHttpRequest(", "WebSocket(",
                              "chrome.", "browser.", "require('node:fs')",
                              "require('node:http')", "require('node:https')"):
                self.assertNotIn(forbidden, source)
        self.assertIn("structuredClone(state)", sources[0])
        self.assertIn("credentialStored", sources[0])


if __name__ == "__main__":
    unittest.main()
