import contextlib
import io
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import zipfile

import support

release = support.release
LATEST = "https://github.com/amralieg/inspire/releases/latest/download"


class BuildTest(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="inspire_release_test_"))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def build(self, **kwargs):
        with contextlib.redirect_stdout(io.StringIO()):
            return support.build_release(self.tmp, **kwargs)

    def test_a_release_holds_exactly_the_four_files_and_its_manifest_lists_whole_files_without_parts(self):
        out = self.build()
        manifest = json.loads((out / "manifest.json").read_text())
        self.assertEqual(sorted(path.name for path in out.iterdir()),
                         ["inspire-app.zip", "inspire-assets.tar", "inspire_installer.py", "manifest.json"])
        self.assertEqual((manifest["format"], manifest["version"], manifest["starter_min_version"]), (1, "v1.3.0", 1))
        self.assertEqual(manifest["entry"], {"file": "inspire-app.zip", "module": "installer/inspire_setup.py", "function": "run"})
        self.assertEqual(manifest["installer"], {"name": "inspire_installer.py", "size": release.STARTER.stat().st_size,
                                                 "sha256": support.sha(release.STARTER.read_bytes())})
        self.assertEqual([entry["name"] for entry in manifest["files"]], ["inspire-app.zip", "inspire-assets.tar"])
        for entry in manifest["files"]:
            whole = (out / entry["name"]).read_bytes()
            self.assertEqual((len(whole), support.sha(whole)), (entry["size"], entry["sha256"]))
            self.assertNotIn("parts", entry)
        self.assertNotIn("SHA256SUMS", (out / "manifest.json").read_text())
        contents = {item["path"]: item for item in manifest["files"][0]["contents"]}
        self.assertEqual(contents["dbx_inspire_ai_agent.ipynb"]["notebook"], "jupyter")
        self.assertEqual(contents["dbx_generate_demo_data.py"]["notebook"], "source")
        self.assertIsNone(contents["installer/inspire_setup.py"]["notebook"])
        self.assertEqual(manifest["files"][0]["unzip_folder"], "inspire-app")
        support.release.load_starter()["check_manifest"](manifest)

    def test_a_manifest_with_parts_or_without_the_tar_or_the_installer_is_never_a_release(self):
        starter = release.load_starter()
        good = json.loads((self.build() / "manifest.json").read_text())
        self.assertIs(release.four_files(good, starter), good)
        for change, words in ((lambda m: m["files"][0].update(parts=[]), "lists parts of ['inspire-app.zip']"),
                              (lambda m: m["files"].pop(), "lists ['inspire-app.zip'], a release lists exactly"),
                              (lambda m: m["files"].append(dict(m["files"][1], name="inspire-app.part01")), "inspire-app.part01"),
                              (lambda m: m.pop("installer"), "names no inspire_installer.py")):
            manifest = json.loads(json.dumps(good))
            change(manifest)
            with self.assertRaises(SystemExit) as caught:
                release.four_files(manifest, starter)
            self.assertIn(words, str(caught.exception))

    def test_the_build_writes_no_parts_and_no_sums_whatever_the_file_sizes(self):
        out = self.build(assets={"cli/big.bin": bytes(range(256)) * 50000})
        self.assertGreater((out / "inspire-assets.tar").stat().st_size, 10 * 1000 * 1000)
        self.assertEqual(len(list(out.iterdir())), 4)
        self.assertFalse(hasattr(release, "split") or hasattr(release, "PART_BYTES") or hasattr(release, "parse_sums"))
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            release.main(["build", "--assets", str(self.tmp), "--out", str(self.tmp / "x"), "--part-bytes", "4096"])

    def test_the_assets_tar_is_the_assets_folder_with_its_manifest_and_builds_the_same_twice(self):
        first, second = self.build(), self.build(name="again")
        self.assertEqual((first / "inspire-assets.tar").read_bytes(), (second / "inspire-assets.tar").read_bytes())

    def test_a_damaged_assets_folder_or_another_version_is_never_released(self):
        assets = self.tmp / "assets"
        assets.mkdir()
        support.make_assets(assets)
        (assets / "fonts" / "inter-400.ttf").write_bytes(b"changed")
        app = self.tmp / "app.zip"
        support.make_app_zip(app)
        with self.assertRaises(SystemExit) as caught:
            release.build(str(app), str(assets), str(self.tmp / "out1"))
        self.assertIn("does not match its size and sha256", str(caught.exception))
        other = self.tmp / "assets2"
        other.mkdir()
        support.make_assets(other, version="v1.3.1")
        with self.assertRaises(SystemExit) as caught:
            release.build(str(app), str(other), str(self.tmp / "out2"))
        self.assertIn("is for Inspire v1.3.1, the agent in inspire-app.zip is v1.3.0", str(caught.exception))
        twice = self.tmp / "twice.zip"
        support.make_app_zip(twice)
        with zipfile.ZipFile(twice, "a") as archive:
            archive.writestr("app/installer/inspire_setup.py", "def run(env):\n    return 1\n")
        with self.assertRaises(SystemExit) as caught:
            release.build(str(twice), str(other), str(self.tmp / "out3"))
        self.assertIn("must hold one installer/inspire_setup.py, it holds 2", str(caught.exception))

    def test_the_release_leaves_the_installer_tests_and_the_release_script_out_of_the_app_zip(self):
        out = self.build(extra={"installer/test/test_x.py": b"x", "installer/release.py": b"x",
                                "installer/__pycache__/inspire_setup.cpython-312.pyc": b"x", "backend/.DS_Store": b"x"})
        with zipfile.ZipFile(out / "inspire-app.zip") as archive:
            names = [i.filename for i in archive.infolist() if not i.is_dir()]
        self.assertIn("installer/inspire_setup.py", names)
        self.assertEqual([n for n in names if "test" in n or "release.py" in n or "__pycache__" in n or ".DS_Store" in n], [])
        listed = [item["path"] for item in json.loads((out / "manifest.json").read_text())["files"][0]["contents"]]
        self.assertEqual(sorted(listed), sorted(names))

    def test_the_app_zip_keeps_its_folder_entries_because_the_workspace_unzip_needs_them(self):
        app = self.tmp / "dirs.zip"
        support.make_app_zip(app)
        with zipfile.ZipFile(app, "a") as archive:
            for folder in ("backend/", "installer/", "installer/test/", "frontend/", "frontend/dist/"):
                archive.writestr(zipfile.ZipInfo(folder), b"")
        assets = self.tmp / "dir-assets"
        assets.mkdir()
        support.make_assets(assets)
        with contextlib.redirect_stdout(io.StringIO()):
            release.build(str(app), str(assets), str(self.tmp / "dir-out"))
        with zipfile.ZipFile(self.tmp / "dir-out" / "inspire-app.zip") as archive:
            folders = sorted(i.filename for i in archive.infolist() if i.is_dir())
        self.assertEqual(folders, ["backend/", "frontend/", "frontend/dist/", "installer/"])
        contents = json.loads((self.tmp / "dir-out" / "manifest.json").read_text())["files"][0]["contents"]
        self.assertFalse([item for item in contents if item["path"].endswith("/")])

    def test_the_release_calls_the_package_script_with_the_zip_path_it_wants(self):
        source = pathlib.Path(release.__file__).read_text()
        self.assertIn('["bash", str(APP / "scripts" / "package-for-workspace.sh")]', source)
        self.assertIn('"ARTIFACT_ZIP": str(packed)', source)


class CheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="inspire_check_test_"))
        with contextlib.redirect_stdout(io.StringIO()):
            self.out = support.build_release(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def check(self, github, base=LATEST):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            failures = release.check(base, opener=github, work=self.tmp / "work")
        return failures, out.getvalue()

    def test_a_good_release_passes_with_every_file_downloaded_through_its_link(self):
        github = support.FakeGitHub(LATEST, self.out)
        failures, said = self.check(github)
        self.assertEqual(failures, [])
        self.assertEqual(sorted(github.requested), sorted([path.name for path in self.out.iterdir()] + list(release.LEFT_OUT)))
        self.assertIn("release check https://github.com/amralieg/inspire/releases/latest/download: 4 of 4 files OK, 0 failures", said)

    def test_a_changed_file_a_missing_tar_an_extra_part_extra_sums_and_a_manifest_with_parts_each_fail_the_check(self):
        manifest = json.loads((self.out / "manifest.json").read_text())
        cases = {
            "changed": (lambda files: files.update({"inspire-app.zip": b"x" + files["inspire-app.zip"][1:]}), "does not match its sha256"),
            "missing tar": (lambda files: files.pop("inspire-assets.tar"), "inspire-assets.tar: HTTP Error 404"),
            "extra part": (lambda files: files.update({"inspire-app.part01": b"part"}), "the release carries inspire-app.part01"),
            "extra sums": (lambda files: files.update({"SHA256SUMS": b"sums"}), "the release carries SHA256SUMS"),
            "big extra part": (lambda files: files.update({"inspire-assets.part01": b"p" * ((1 << 24) + 1)}),
                               "the release carries inspire-assets.part01"),
            "manifest with parts": (lambda files: files.update({"manifest.json": json.dumps(support.v130_manifest(manifest)).encode()}),
                                    "lists parts of ['inspire-app.zip', 'inspire-assets.tar']"),
            "manifest without the tar": (lambda files: files.update({"manifest.json": json.dumps(
                dict(manifest, files=manifest["files"][:1])).encode()}), "a release lists exactly"),
        }
        for label, (change, words) in cases.items():
            github = support.FakeGitHub(LATEST, self.out)
            change(github.files)
            failures, _ = self.check(github)
            self.assertTrue(any(words in failure for failure in failures), (label, failures))

    def test_a_github_error_other_than_404_on_a_left_out_name_fails_the_check_instead_of_passing_it(self):
        github = support.FakeGitHub(LATEST, self.out)
        real = github.__call__

        def flaky(url, repo, timeout):
            if url.endswith("/SHA256SUMS"):
                raise urllib.error.HTTPError(url, 503, "Service Unavailable", {}, None)
            return real(url, repo, timeout)
        failures, _ = self.check(flaky)
        self.assertEqual(failures, ["SHA256SUMS: HTTP 503, so the check cannot tell whether the release carries it"])

    def test_the_command_exits_non_zero_on_any_mismatch(self):
        github = support.FakeGitHub(LATEST, self.out)
        github.files["inspire-app.zip"] = github.files["inspire-app.zip"][:-1]
        saved = release.load_starter

        def starter():
            ns = saved()
            ns["open_trusted"] = github
            return ns
        release.load_starter = starter
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(release.main(["check"]), 1)
                github.files["inspire-app.zip"] = (self.out / "inspire-app.zip").read_bytes()
                self.assertEqual(release.main(["check"]), 0)
        finally:
            release.load_starter = saved

    def test_the_check_reads_only_the_latest_links_or_a_fork_pre_release(self):
        github = support.FakeGitHub(support.FORK_BASE, self.out)
        self.assertEqual(self.check(github, support.FORK_BASE)[0], [])
        with self.assertRaises(RuntimeError) as caught:
            self.check(github, "https://github.com/someone/else/releases/download/v1.3.0")
        self.assertIn("is not a release of amralieg/inspire on github.com", str(caught.exception))


class DeployScriptTest(unittest.TestCase):
    SCRIPT = pathlib.Path(release.__file__).resolve().parent.parent / "scripts" / "deploy-inspire-full.sh"

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="inspire_deploy_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def inline_python(self, marker):
        lines = [line for line in self.SCRIPT.read_text().splitlines() if line.startswith('python3 -c "') and marker in line]
        self.assertEqual(len(lines), 1, marker)
        return lines[0][len('python3 -c "'):].split('" "$', 1)[0]

    def test_the_local_build_is_imported_with_internet_blocked_and_nothing_else_changed(self):
        out = self.tmp / "inspire_installer.py"
        subprocess.run([sys.executable, "-c", self.inline_python("INTERNET_BLOCKED = True"), str(release.STARTER), str(out)], check=True)
        before, after = release.STARTER.read_text().splitlines(), out.read_text().splitlines()
        self.assertEqual(len(before), len(after))
        self.assertEqual([(a, b) for a, b in zip(before, after) if a != b], [("INTERNET_BLOCKED = False", "INTERNET_BLOCKED = True")])

    def test_the_flag_copy_refuses_an_installer_without_the_flag(self):
        plain = self.tmp / "old_installer.py"
        plain.write_text("RELEASE_REPO = 'x'\n")
        run = subprocess.run([sys.executable, "-c", self.inline_python("INTERNET_BLOCKED = True"), str(plain), str(self.tmp / "o.py")],
                             capture_output=True, text=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("not in the installer exactly once", run.stderr)
        self.assertFalse((self.tmp / "o.py").exists())

    def test_the_installer_job_runs_once_without_a_serverless_retry(self):
        target = self.tmp / "submit.json"
        subprocess.run([sys.executable, "-c", self.inline_python("'run_name': 'inspire-installer'"), str(target), "/Workspace/x"], check=True)
        task = json.loads(target.read_text())["tasks"][0]
        self.assertEqual((task["max_retries"], task["disable_auto_optimization"]), (0, True))
        self.assertNotIn("internet", self.SCRIPT.read_text().replace("INTERNET_BLOCKED", ""))

    def test_the_release_files_and_the_test_setting_are_imported_whole_in_one_import_dir(self):
        lines = self.SCRIPT.read_text().splitlines()
        start = lines.index('STAGE="$(mktemp -d)"')
        block = lines[start:lines.index('rm -rf "$STAGE"', start) + 1]
        release_dir = support.build_release(self.tmp)
        settings = self.tmp / "settings.json"
        settings.write_text('{"warehouse_id": "wh1"}')
        log = self.tmp / "cli.log"
        fake = self.tmp / "databricks"
        fake.write_text('#!/usr/bin/env bash\necho "$1 $2 $4 $5" >> "$LOG"\nLC_ALL=C ls "$3" >> "$LOG"\ncat "$3/inspire_installer_test.json" >> "$LOG"\n')
        fake.chmod(0o755)
        script = "\n".join([f'DB=( "{fake}" )', f'RELEASE_DIR="{release_dir}"', f'SETTINGS="{settings}"', 'FOLDER="/Workspace/x"'] + block)
        run = subprocess.run(["bash", "-euo", "pipefail", "-c", script], capture_output=True, text=True, env=dict(os.environ, LOG=str(log)))
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(log.read_text().splitlines(), ["workspace import-dir /Workspace/x --overwrite", "inspire-app.zip", "inspire-assets.tar",
                                                        "inspire_installer_test.json", "manifest.json", '{"warehouse_id": "wh1"}'])
        self.assertFalse(settings.exists())
        self.assertNotIn(".part", self.SCRIPT.read_text())


if __name__ == "__main__":
    unittest.main()
