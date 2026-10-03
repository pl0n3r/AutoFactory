"""Regresiones Factory v1 del lifecycle runtime build-ahead de AutoFactory."""
from __future__ import annotations

import subprocess
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NODE_TEST = ROOT / "test-factory-control-runtime.cjs"
RUNTIME = ROOT / "factory-control-runtime.js"


class FactoryControlRuntimeTests(unittest.TestCase):
    def _run(self, mode: str) -> None:
        completed = subprocess.run(
            ["node", str(NODE_TEST), mode],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            completed.returncode,
            0,
            completed.stdout + completed.stderr,
        )
        self.assertIn(
            "factory-control runtime lifecycle: ok",
            completed.stdout,
        )

    def test_runtime_composes_heartbeat_and_command_pump_only_while_active(self) -> None:
        self._run("happy")

    def test_stop_profile_drift_or_stale_async_result_fails_closed(self) -> None:
        self._run("failclosed")
        source = RUNTIME.read_text(encoding="utf-8")
        for forbidden in (
            "fetch(",
            "chrome.",
            "browser.",
            "setInterval(",
            "setTimeout(",
            "WebSocket",
        ):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
