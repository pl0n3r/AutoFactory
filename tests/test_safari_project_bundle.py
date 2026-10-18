"""AF#122: el proyecto Safari debe poder abrirse en el Xcode de CI y empaquetar TODOS los assets."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PBX = ROOT / 'safari' / 'ChatGPT Autopilot Local.xcodeproj' / 'project.pbxproj'


class SafariProjectBundleTests(unittest.TestCase):
    def setUp(self):
        self.text = PBX.read_text(encoding='utf-8')

    def test_object_version_opens_in_ci_xcode(self):
        match = re.search(r'objectVersion = (\d+);', self.text)
        self.assertIsNotNone(match)
        self.assertLessEqual(int(match.group(1)), 77)

    def test_extension_copies_every_synced_resource(self):
        self.assertIn('PBXShellScriptBuildPhase', self.text)
        self.assertIn('rsync -a', self.text)
        self.assertIn('ChatGPT Autopilot Local Extension/Resources/', self.text)
        self.assertGreaterEqual(self.text.count('ENABLE_USER_SCRIPT_SANDBOXING = NO;'), 2)


if __name__ == '__main__':
    unittest.main()
