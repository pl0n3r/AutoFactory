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
            "const spawnProcess=(binary,args,options)=>{"
            "capture={binary,args,env:options.env};"
            "return {exitCode:null,kill:()=>true,on:()=>{},once:(_event,cb)=>cb(),"
            "stderr:{on:(event,cb)=>{if(mode==='runtime'&&event==='data')"
            "cb('Failed to load extension: synthetic failure')}}};"
            "};"
            "const probeWorker=async()=>mode==='missing-worker'?null:"
            "{type:'service_worker',url:'chrome-extension://'+"
            "'a'.repeat(32)+'/background-entry.js'};"
            "(async()=>{try{const evidence=await m.runChromeSmoke({"
            "root:process.argv[2],tag:process.argv[3],commitSha:process.argv[4],"
            "tempRoot:process.argv[5],spawnProcess,probeWorker,"
            "binaryResolver:()=>'/trusted/google-chrome'});"
            "console.log(JSON.stringify({evidence,capture}));}"
            "catch(e){console.error(e.message);process.exitCode=1}})();"
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

    def test_trusted_chrome_binary_is_regular_nonsymlink_and_executable(self):
        valid = self._binary_boundary("success")
        self.assertEqual(valid.returncode, 0, valid.stderr)
        self.assertEqual(valid.stdout.strip(), "/usr/local/share/chromium/chrome-linux/chrome")

        symlink_binary = self._binary_boundary("symlink")
        self.assertNotEqual(symlink_binary.returncode, 0)
        self.assertIn("regular file", symlink_binary.stderr)

        directory_binary = self._binary_boundary("directory")
        self.assertNotEqual(directory_binary.returncode, 0)
        self.assertIn("regular file", directory_binary.stderr)

        non_executable = self._binary_boundary("not-executable")
        self.assertNotEqual(non_executable.returncode, 0)
        self.assertIn("not executable", non_executable.stderr)

    def test_linux_runner_sandbox_exception_is_disposable_ci_only(self):
        # El workaround de AppArmor no se propaga al navegador del usuario.
        expression = (
            "const m=require(process.argv[1]);"
            "const platforms=['linux','darwin','win32'];"
            "const envs=["
            "{GITHUB_ACTIONS:'true',CI:'true'},"
            "{GITHUB_ACTIONS:'false',CI:'true'},"
            "{GITHUB_ACTIONS:'true',CI:'false'},"
            "{}"
            "];"
            "console.log(JSON.stringify(platforms.flatMap(platform=>"
            "envs.map(env=>({platform,env,"
            "args:m.chromeArgs('/tmp/isolated-profile','/tmp/attested-extension',platform,env)"
            "})))));"
        )
        result = subprocess.run(
            ["node", "-e", expression, str(SCRIPT)],
            check=False, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        cases = json.loads(result.stdout)
        self.assertEqual(len(cases), 12)
        for case in cases:
            scoped = (
                case["platform"] == "linux"
                and case["env"].get("GITHUB_ACTIONS") == "true"
                and case["env"].get("CI") == "true"
            )
            with self.subTest(platform=case["platform"], env=case["env"]):
                self.assertEqual("--no-sandbox" in case["args"], scoped)
                self.assertIn("--load-extension=/tmp/attested-extension", case["args"])
                self.assertIn("--user-data-dir=/tmp/isolated-profile", case["args"])
                self.assertIn("--remote-debugging-port=0", case["args"])
                self.assertEqual(case["args"][-1], "about:blank")

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
        self.assertIn("--remote-debugging-port=0", capture["args"])
        self.assertNotIn("--dump-dom", capture["args"])
        self.assertEqual(evidence["worker_url"], "chrome-extension://" + "a" * 32 + "/background-entry.js")

    def test_runtime_error_or_permission_drift_fails_closed(self):
        missing_worker = self._smoke("missing-worker")
        self.assertNotEqual(missing_worker.returncode, 0)
        self.assertIn("service worker evidence missing", missing_worker.stderr)

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


if __name__ == "__main__":
    import unittest
    unittest.main()
