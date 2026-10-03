import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_node(source: str) -> dict:
    completed = subprocess.run(
        ["node", "-e", source],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


class TabHealthStatusTests(unittest.TestCase):
    def test_status_per_tab_reports_last_send_last_reply_and_rate_limit(self):
        result = run_node(
            r"""
const health = require('./account-budget-background.js');
let state = {};
state = health.recordTabEvent(state, {
  tabId: 7, type: 'send', at: 1000, accountAlias: 'primary'
});
state = health.recordTabEvent(state, {
  tabId: 7, type: 'reply', at: 2000, fingerprint: 'deadbeef',
  accountAlias: 'primary'
});
state = health.recordTabEvent(state, {
  tabId: 7, type: 'rate-limit', at: 3000, accountAlias: 'primary'
});
state = health.recordTabEvent(state, {
  tabId: 7, type: 'enabled', enabled: false, at: 4000,
  accountAlias: 'primary'
});
const snapshot = health.tabHealthSnapshot(state, {
  now: 5000, thresholdMinutes: 30, tabIds: [7]
});
process.stdout.write(JSON.stringify(snapshot.tabs[0]));
"""
        )
        self.assertEqual(result["accountAlias"], "primary")
        self.assertEqual(result["lastSendAt"], 1000)
        self.assertEqual(result["lastReplyAt"], 2000)
        self.assertEqual(result["rateLimitedSince"], 3000)
        self.assertTrue(result["paused"])
        self.assertFalse(result["stalled"])

    def test_repeated_identical_reply_marks_tab_stalled_after_threshold(self):
        result = run_node(
            r"""
const health = require('./account-budget-background.js');
let state = {};
state = health.recordTabEvent(state, {
  tabId: 3, type: 'send', at: 1000, accountAlias: 'primary'
});
state = health.recordTabEvent(state, {
  tabId: 3, type: 'reply', at: 10000, fingerprint: 'cafebabe',
  accountAlias: 'primary'
});
state = health.recordTabEvent(state, {
  tabId: 3, type: 'send', at: 20000, accountAlias: 'primary'
});
state = health.recordTabEvent(state, {
  tabId: 3, type: 'reply', at: 40000, fingerprint: 'cafebabe',
  accountAlias: 'primary'
});
const snapshot = health.tabHealthSnapshot(state, {
  now: 1810001, thresholdMinutes: 30, tabIds: [3]
});
process.stdout.write(JSON.stringify(snapshot.tabs[0]));
"""
        )
        self.assertEqual(result["repeatedReplyCount"], 2)
        self.assertEqual(result["stalledReason"], "repeated-reply")
        self.assertTrue(result["stalled"])

    def test_local_log_is_bounded_and_contains_no_conversation_text(self):
        result = run_node(
            r"""
const health = require('./account-budget-background.js');
let log = [];
for (let index = 0; index < 250; index += 1) {
  log = health.appendTabHealthLog(log, {
    tabId: 9,
    type: index % 2 ? 'reply' : 'send',
    at: index + 1,
    fingerprint: '1234abcd',
    conversationText: 'never-persist-this',
    token: 'never-persist-this-either'
  });
}
process.stdout.write(JSON.stringify({ length: log.length, serialized: JSON.stringify(log) }));
"""
        )
        self.assertEqual(result["length"], 200)
        self.assertNotIn("never-persist-this", result["serialized"])
        self.assertNotIn("conversationText", result["serialized"])
        self.assertNotIn("token", result["serialized"])

    def test_chrome_and_safari_resources_stay_identical(self):
        pairs = [
            ("account-budget-background.js", "account-budget-background.js"),
            ("popup-budget.js", "popup-budget.js"),
            ("popup.html", "popup.html"),
            ("popup.js", "popup.js"),
            ("content.js", "content.js"),
        ]
        safari = ROOT / "safari" / "ChatGPT Autopilot Local Extension" / "Resources"
        for chrome_name, safari_name in pairs:
            with self.subTest(resource=chrome_name):
                self.assertEqual(
                    (ROOT / chrome_name).read_bytes(),
                    (safari / safari_name).read_bytes(),
                )


if __name__ == "__main__":
    unittest.main()
