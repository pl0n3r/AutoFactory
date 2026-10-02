"""Regresiones del smoke Chrome efímero y secret-free."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from tests.test_release_artifact_attestation import (
    ASSETS,
    SAFARI,
    SHA as ATTESTATION_SHA,
    TAG,
    ReleaseArtifactAttestationTests,
)

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "chrome-ephemeral-smoke.cjs"
SMOKE_SHA = "b" * 40


class ChromeEphemeralSmokeTests(ReleaseArtifactAttestationTests):
    test_attestation_binds_tag_sha_versions_assets_and_digests = None
    test_mismatch_symlink_or_undeclared_asset_fails_closed = None

    def _smoke(self, mode="success"):
        expression = (
            "const m=require(process.argv[1]);"
            "const mode=process.argv[6];"
            "let capture=null;"
            "const spawn=(binary,args,options)=>{"
            "capture={binary,args,env:options.env};"
            "if(mode==='runtime')return {status:0,stdout:'',"
            "stderr:'Failed to load extension: synthetic failure'};"
            "return {status:0,stdout:'<html>ok</html>',stderr:''};"
            "};"
            "try{const evidence=m.runChromeSmoke({"
            "root:process.argv[2],tag:process.argv[3],commitSha:process.argv[4],"
            "tempRoot:process.argv[5],spawn,"
            "binaryResolver:()=>'/trusted/google-chrome'});"
            "console.log(JSON.stringify({evidence,capture}));}"
            "catch(e){console.error(e.message);process.exit(1)}"
        )
        return subprocess.run(
            [
                "node", "-e", expression, str(SCRIPT), str(self.fixture),
                TAG, SMOKE_SHA, str(self.fixture), mode,
            ],
            check=False,
            capture_output=True,
            text=True,
        )

    def _binary_boundary(self, mode):
        expression = (
            "const fs=require('node:fs');"
            "const m=require(process.argv[1]);"
            "const mode=process.argv[2];"
            "fs.existsSync=()=>true;"
            "fs.lstatSync=()=>({"
            "isSymbolicLink:()=>mode==='symlink',"
            "isFile:()=>mode!=='directory'"
            "});"
            "fs.accessSync=()=>{if(mode==='not-executable')throw new Error('denied')};"
            "try{console.log(m.resolveChromeBinary('linux'))}"
            "catch(e){console.error(e.message);process.exit(1)}"
        )
        return subprocess.run(
            ["node", "-e", expression, str(SCRIPT), mode],
            check=False,
            capture_output=True,
            text=True,
        )

    def test_ephemeral_profile_loads_packaged_extension_without_user_data(self):
        result = self._smoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        evidence = payload["evidence"]
        capture = payload["capture"]

        self.assertTrue(evidence["verified"])
        self.assertEqual(evidence["profile_mode"], "ephemeral")
        self.assertEqual(evidence["extension_mode"], "attested-copy")
        self.assertEqual(evidence["commit_sha"], SMOKE_SHA)
        self.assertEqual(evidence["assets"], len(ASSETS))
        self.assertEqual(capture["binary"], "/trusted/google-chrome")

        profile = next(
            value.split("=", 1)[1]
            for value in capture["args"]
            if value.startswith("--user-data-dir=")
        )
        extension = next(
            value.split("=", 1)[1]
            for value in capture["args"]
            if value.startswith("--load-extension=")
        )
        self.assertEqual(capture["env"]["HOME"], profile)
        self.assertNotEqual(profile, str(Path.home()))
        self.assertFalse(Path(profile).exists())
        self.assertFalse(Path(extension).exists())
        self.assertIn("--disable-background-networking", capture["args"])

    def test_runtime_error_or_permission_drift_fails_closed(self):
        runtime = self._smoke("runtime")
        self.assertNotEqual(runtime.returncode, 0)
        self.assertIn("runtime/load error", runtime.stderr)

        manifest = self._manifest()
        manifest["permissions"].append("webRequest")
        encoded = json.dumps(manifest, separators=(",", ":"))
        self._write("manifest.json", encoded)
        self._write(SAFARI / "manifest.json", encoded)
        permission = self._smoke()
        self.assertNotEqual(permission.returncode, 0)
        self.assertIn("unexpected permission", permission.stderr)

        symlink_binary = self._binary_boundary("symlink")
        self.assertNotEqual(symlink_binary.returncode, 0)
        self.assertIn("regular file", symlink_binary.stderr)

        directory_binary = self._binary_boundary("directory")
        self.assertNotEqual(directory_binary.returncode, 0)
        self.assertIn("regular file", directory_binary.stderr)

        non_executable = self._binary_boundary("not-executable")
        self.assertNotEqual(non_executable.returncode, 0)
        self.assertIn("not executable", non_executable.stderr)


if __name__ == "__main__":
    import unittest
    unittest.main()
