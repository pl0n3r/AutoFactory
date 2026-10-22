import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAFARI = ROOT / "safari" / "ChatGPT Autopilot Local Extension" / "Resources"

SCRIPT = r"""
const path = require('path');
const { JSDOM } = require(path.join(process.argv[2], 'node_modules', 'jsdom'));
const core = require(path.join(process.argv[1], 'autopilot-core.js'));
function page(html) { return new JSDOM(html, { pretendToBeVisual: true }).window.document; }
const err = '<main><p>No se pudo cargar esta conversación de ChatGPT</p>';
const out = {
  retry_es: core.recoveryButton(page(err + '<button>Volver a intentar</button></main>'))?.textContent ?? null,
  retry_en: core.recoveryButton(page('<main><p>Unable to load conversation</p><button>Try again</button></main>'))?.textContent ?? null,
  signal_es: core.pageSignal(page(err + '<button>Volver a intentar</button></main>')).code,
  failed_es: core.conversationLoadFailed(page(err + '</main>')),
  failed_en: core.conversationLoadFailed(page('<main><p>Unable to load this conversation</p></main>')),
  failed_with_composer: core.conversationLoadFailed(page(err + '<textarea placeholder="ChatGPT"></textarea></main>')),
  failed_normal_page: core.conversationLoadFailed(page('<main><p>Hola</p><textarea placeholder="ChatGPT"></textarea></main>')),
  failed_empty: core.conversationLoadFailed(page('<main></main>')),
  other_button: core.recoveryButton(page('<main><button>Iniciar sesión</button></main>')) === null,
};
console.log(JSON.stringify(out));
"""


class ConversationLoadErrorTests(unittest.TestCase):
    def run_node(self, directory: Path) -> dict:
        done = subprocess.run(["node", "-e", SCRIPT, str(directory), str(ROOT)],
                              capture_output=True, text=True, timeout=60, check=False)
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        return json.loads(done.stdout.strip().splitlines()[-1])

    def test_load_error_page_is_recovered_without_touching_working_tabs(self) -> None:
        for directory in (ROOT, SAFARI):
            with self.subTest(directory=str(directory.relative_to(ROOT)) or "."):
                result = self.run_node(directory)
                self.assertEqual(result["retry_es"], "Volver a intentar")
                self.assertEqual(result["retry_en"], "Try again")
                self.assertEqual(result["signal_es"], "recoverable")
                self.assertTrue(result["failed_es"])
                self.assertTrue(result["failed_en"])
                # Con campo de escritura (chat sano, aunque cite el texto) no se considera caída.
                self.assertFalse(result["failed_with_composer"])
                self.assertFalse(result["failed_normal_page"])
                self.assertFalse(result["failed_empty"])
                self.assertTrue(result["other_button"])


if __name__ == "__main__":
    unittest.main()
