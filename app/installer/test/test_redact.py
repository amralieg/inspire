import contextlib
import io
import json
import pathlib
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.error

import support
import release

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
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            installed, failure = self.ns["inspire_install_main"]()
        self.stderr = err.getvalue()
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
            print(f"warning from a library: {CARRIER}", file=sys.stderr)
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

    def test_what_the_install_writes_to_stderr_holds_no_token(self):
        self.setup_failure(lambda setup: RuntimeError("Deploy failed"))
        self.assertIn("warning from a library", self.stderr, "stderr still carries the warning")
        self.assertEqual(leaked(self.stderr), [])


LATEST = support.RELEASE_BASE


class ReleaseRedactCase(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="inspire_release_redact_"))
        with contextlib.redirect_stdout(io.StringIO()):
            self.out = support.build_release(self.tmp)
        self.github = support.FakeGitHub(LATEST, self.out)
        self.saved = release.load_starter

    def tearDown(self):
        release.load_starter = self.saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def check(self, broken_name):
        real = self.github.__call__

        def opener(url, repo, timeout):
            if url.endswith(f"/{broken_name}"):
                print(f"retrying with {CARRIER}", file=sys.stderr)
                raise RuntimeError(f"the proxy refused the call: {CARRIER}")
            return real(url, repo, timeout)

        def starter():
            ns = self.saved()
            ns["open_trusted"] = opener
            return ns
        release.load_starter = starter
        out, err = io.StringIO(), io.StringIO()
        result = None
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                result = release.main(["check", "--tag", support.VERSION])
            except Exception as exc:
                result = exc
        return result, out.getvalue(), err.getvalue()

    def test_a_release_check_whose_file_download_fails_with_a_token_prints_none_of_it(self):
        result, printed, errors = self.check("inspire-app.zip")
        self.assertEqual(result, 1)
        self.assertIn("FAIL  inspire-app.zip  the proxy refused the call", printed, "the check still says what failed")
        self.assertIn("retrying with", errors)
        self.assertEqual(leaked(printed + errors), [])

    def test_a_release_check_that_stops_with_a_token_in_its_error_raises_none_of_it(self):
        result, printed, errors = self.check("manifest.json")
        self.assertIsInstance(result, RuntimeError)
        self.assertIn("the proxy refused the call", str(result))
        self.assertEqual(leaked(str(result) + printed + errors), [])


PARITY_SAMPLES = [
    CARRIER,
    f"  - → GET https://inspire.example/api/x?token={FAKE_PAT}&page=2",
    f"{{ headers: {{ Authorization: 'Bearer {FAKE_JWT}', 'Set-Cookie': [ '{FAKE_COOKIE}' ], accept: 'application/json' }} }}",
    f'{{"cookie":"{FAKE_COOKIE}","X-Databricks-Org-Id":"fake-org-secret","n":1}}',
    f"client_secret=\"{FAKE_PAT}\" next; password: hunter2two",
    f"jwt {FAKE_JWT.split('.')[0]}{FAKE_JWT.split('.')[1]} and dose{'ab' * 10}",
    "Authorization failed for this user",
    "[record] Review: opened 15 of 15 use cases",
    "  release.zip: ✅ downloaded, sha256 checked",
]


class ParityCase(unittest.TestCase):
    def test_the_python_and_js_redact_helpers_redact_every_sample_the_same_way(self):
        node = shutil.which("node")
        self.assertIsNotNone(node, "node is needed to compare the JS helper")
        helper = pathlib.Path(__file__).resolve().parents[2] / "backend" / "lib" / "redact.js"
        script = ("const { redactSecrets } = require(process.argv[1]); let s = ''; process.stdin.on('data', (d) => { s += d; });"
                  "process.stdin.on('end', () => process.stdout.write(JSON.stringify(JSON.parse(s).map((t) => redactSecrets(t)))));")
        run = subprocess.run([node, "-e", script, str(helper)], input=json.dumps(PARITY_SAMPLES), capture_output=True, text=True, timeout=60,
                             env={**os.environ})
        self.assertEqual(run.returncode, 0, run.stderr[-400:])
        js = json.loads(run.stdout)
        python = [support.release.load_starter()["redact_secrets"](t) for t in PARITY_SAMPLES]
        self.assertEqual(python, js)
        self.assertEqual(leaked("\n".join(python)), [])


if __name__ == "__main__":
    unittest.main()
