import contextlib
import io
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
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

    def test_a_release_holds_fixed_names_a_manifest_sums_whole_files_and_parts_under_10_mb(self):
        out = self.build(part_bytes=4096)
        manifest = json.loads((out / "manifest.json").read_text())
        names = sorted(path.name for path in out.iterdir())
        parts = [n for n in names if re.fullmatch(r"inspire-(app|assets)\.part\d{2}", n)]
        self.assertEqual(sorted(set(names) - set(parts)),
                         ["SHA256SUMS", "inspire-app.zip", "inspire-assets.tar", "inspire_installer.py", "manifest.json"])
        self.assertEqual([n for n in names if n.endswith(".zip")], ["inspire-app.zip"], "no part is named .zip")
        self.assertEqual((manifest["format"], manifest["version"], manifest["starter_min_version"]), (1, "v1.3.0", 1))
        self.assertEqual(manifest["entry"], {"file": "inspire-app.zip", "module": "installer/inspire_setup.py", "function": "run"})
        self.assertEqual(manifest["installer"]["sha256"], support.sha(release.STARTER.read_bytes()))
        for entry in manifest["files"]:
            whole = (out / entry["name"]).read_bytes()
            self.assertEqual((len(whole), support.sha(whole)), (entry["size"], entry["sha256"]))
            joined = b"".join((out / part["name"]).read_bytes() for part in entry["parts"])
            self.assertEqual(joined, whole)
            self.assertTrue(all(0 < part["size"] <= 4096 for part in entry["parts"]))
        self.assertGreater(len(manifest["files"][1]["parts"]), 2)
        sums = release.parse_sums((out / "SHA256SUMS").read_text())
        self.assertEqual(sorted(sums), sorted(n for n in names if n != "SHA256SUMS"))
        for name, digest in sums.items():
            self.assertEqual(support.sha((out / name).read_bytes()), digest, name)
        contents = {item["path"]: item for item in manifest["files"][0]["contents"]}
        self.assertEqual(contents["dbx_inspire_ai_agent.ipynb"]["notebook"], "jupyter")
        self.assertEqual(contents["dbx_generate_demo_data.py"]["notebook"], "source")
        self.assertIsNone(contents["installer/inspire_setup.py"]["notebook"])
        self.assertEqual(manifest["files"][0]["unzip_folder"], "inspire-app")
        support.release.load_starter()["check_manifest"](manifest)

    def test_the_default_part_size_is_under_10_mb(self):
        self.assertLess(release.PART_BYTES, 10 * 1000 * 1000)
        with self.assertRaises(SystemExit):
            self.build(part_bytes=10 * 1000 * 1000)

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
            release.build(str(app), str(assets), str(self.tmp / "dir-out"), 4096)
        with zipfile.ZipFile(self.tmp / "dir-out" / "inspire-app.zip") as archive:
            folders = sorted(i.filename for i in archive.infolist() if i.is_dir())
        self.assertEqual(folders, ["backend/", "frontend/", "frontend/dist/", "installer/"])
        contents = json.loads((self.tmp / "dir-out" / "manifest.json").read_text())["files"][0]["contents"]
        self.assertFalse([item for item in contents if item["path"].endswith("/")])

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
            release.build(str(app), str(assets), str(self.tmp / "dir-out"), 4096)
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
            self.out = support.build_release(self.tmp, part_bytes=4096)

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
        self.assertEqual(sorted(github.requested), sorted(path.name for path in self.out.iterdir()))
        self.assertRegex(said, r"release check .*: (\d+) of \1 files OK, 0 failures")

    def test_a_changed_part_a_missing_file_and_a_stale_sums_line_each_fail_the_check(self):
        for change in ("part", "missing", "sums"):
            github = support.FakeGitHub(LATEST, self.out)
            if change == "part":
                github.files["inspire-assets.part02"] = b"x" + github.files["inspire-assets.part02"][1:]
            elif change == "missing":
                del github.files["inspire-app.zip"]
            else:
                github.files["SHA256SUMS"] = github.files["SHA256SUMS"].replace(b"inspire_installer.py", b"inspire_installer.pyx")
            failures, _ = self.check(github)
            self.assertTrue(failures, change)

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


if __name__ == "__main__":
    unittest.main()
