import contextlib
import io
import json
import pathlib
import shutil
import tempfile
import unittest
import urllib.error

import support

FAKE_JWT = ".".join(["eyJ" + "hbGciOiJub25lIn0", "eyJzdWIiOiJmYWtlLXVzZXIifQ", "ZmFrZS1zaWduYXR1cmU"])
FAKE_PAT = "dapi" + "0123456789abcdef" * 2
FAKE_COOKIE = "session=fake-cookie-value-123"
SECRETS = [FAKE_JWT, FAKE_PAT, FAKE_COOKIE, "fake-cookie-value-123", "fake-org-secret"]
CARRIER = (f"Authorization: Bearer {FAKE_JWT}\ncookie: {FAKE_COOKIE}\nX-Databricks-Org-Id: fake-org-secret\n"
           f"x-forwarded-access-token: {FAKE_PAT}\nbody token={FAKE_PAT}")


def leaked(text):
    return [s for s in SECRETS if s in text]


def http_error(requests):
    response = requests.models.Response()
    response.status_code = 403
    response.url = f"https://workspace.example.com/api/2.0/apps?access_token={FAKE_PAT}"
    response.headers["Set-Cookie"] = FAKE_COOKIE
    response.headers["Authorization"] = f"Bearer {FAKE_JWT}"
    response._content = json.dumps({"error_code": "PERMISSION_DENIED", "message": f"denied for {CARRIER}"}).encode()
    return requests.exceptions.HTTPError(f"403 Client Error: Forbidden for url: {response.url} {CARRIER}", response=response)


class InstallerRedactCase(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="inspire_redact_"))
        self.ns = support.load_starter(self.tmp / "stage")
        self.folder = self.tmp / "Users" / "someone@example.com" / "inspire"
        self.folder.mkdir(parents=True)
        self.ns["installer_folder"] = lambda: (str(self.folder), f"{self.folder}/inspire_installer")
        self.ns["workspace_exporter"] = lambda stem, kind: None
        self.ns["dbutils"] = object()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def install(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            installed, failure = self.ns["inspire_install_main"]()
        return installed, failure, out.getvalue(), "\n".join(self.ns["shown"])

    def test_redact_secrets_hides_token_headers_and_strings_and_keeps_the_rest(self):
        redact = self.ns["redact_secrets"]
        self.assertEqual(leaked(redact(CARRIER)), [])
        self.assertIn("Authorization: [redacted]", redact(CARRIER))
        self.assertEqual(redact("  release.zip: ✅ downloaded, sha256 checked"), "  release.zip: ✅ downloaded, sha256 checked")
        self.assertEqual(redact("Authorization failed for this user"), "Authorization failed for this user", "a word is not a header (must-exclude)")

    def test_a_github_failure_carrying_a_token_prints_shows_and_raises_none_of_it(self):
        def opener(url, repo, timeout):
            raise urllib.error.HTTPError(url, 403, f"Forbidden {CARRIER}", {"Set-Cookie": FAKE_COOKIE}, io.BytesIO(CARRIER.encode()))
        self.ns["open_trusted"] = opener
        installed, failure, printed, shown = self.install()
        self.assertIsNone(installed)
        self.assertIsInstance(failure, self.ns["InspireNotInstalled"])
        self.assertIn("GitHub: HTTP 403", printed, "the failure still says what failed")
        self.assertTrue(shown, "the offline page is shown")
        self.assertEqual(leaked(printed), [])
        self.assertEqual(leaked(shown), [])
        self.assertEqual(leaked(str(failure)), [])

    def test_an_unexpected_failure_carrying_a_token_prints_shows_and_raises_none_of_it(self):
        def opener(url, repo, timeout):
            raise RuntimeError(f"proxy refused the call: {CARRIER}")
        self.ns["open_trusted"] = opener
        _, failure, printed, shown = self.install()
        self.assertIn("proxy refused the call", printed)
        self.assertEqual(leaked(printed + shown + str(failure)), [])

    def setup_failure(self, error):
        setup = support.load_setup()

        def broken(env):
            print(f"Connecting with {CARRIER}")
            raise error(setup)
        setup.build_runtime_context = broken
        self.ns["acquire"] = lambda folder, notebook, settings: {"manifest": {"version": "9.9.9"}, "files": {}, "source": "test"}
        self.ns["load_entry"] = lambda release: setup.run
        return self.install()

    def test_the_workspace_installer_failing_with_an_http_error_carrying_a_token_prints_shows_and_raises_none_of_it(self):
        _, failure, printed, shown = self.setup_failure(lambda setup: http_error(setup.requests))
        self.assertIn("Setup incomplete", printed)
        self.assertIn("HTTP 403", printed, "the failure still says what failed")
        self.assertIn("Setup incomplete", shown)
        self.assertEqual(leaked(printed), [])
        self.assertEqual(leaked(shown), [])
        self.assertEqual(leaked(str(failure)), [])

    def test_the_workspace_installer_failing_with_a_response_body_carrying_a_token_prints_shows_and_raises_none_of_it(self):
        _, failure, printed, shown = self.setup_failure(lambda setup: RuntimeError(f"Deploy failed: {CARRIER}"))
        self.assertIn("Deploy failed", printed)
        self.assertEqual(leaked(printed + shown + str(failure)), [])


if __name__ == "__main__":
    unittest.main()
