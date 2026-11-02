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
import types
import unittest
import urllib.error
import zipfile
from unittest import mock

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


def damaged(data):
    return bytes([data[0] ^ 1]) + data[1:]


class FillTest(unittest.TestCase):
    module = release
    TAG = "v1.3.0-fill"
    REPO = support.FakeReleases.REPO

    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="inspire_fill_test_"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        with contextlib.redirect_stdout(io.StringIO()):
            out = support.build_release(self.tmp, part_bytes=1000)
        self.files = {path.name: path.read_bytes() for path in out.iterdir()}
        self.manifest = json.loads(self.files["manifest.json"])
        self.parts = {entry["name"]: [part["name"] for part in entry["parts"]] for entry in self.manifest["files"]}
        self.assertGreater(min(len(parts) for parts in self.parts.values()), 1)
        self.github = support.FakeReleases()
        self.github.release("v1.2.9", {"inspire_installer.py": b"old"}, prerelease=False, latest=True)
        self.runs = 0

    def without(self, *names):
        return {name: data for name, data in self.files.items() if name not in names}

    def unique_part(self):
        digests = [support.sha(data) for data in self.files.values()]
        return next(name for name in self.parts["inspire-assets.tar"] if digests.count(support.sha(self.files[name])) == 1)

    def fill(self, tag=None):
        self.runs += 1
        said = io.StringIO()
        with contextlib.redirect_stdout(said):
            failures = self.module.fill(self.REPO, tag or self.TAG, api=self.github, opener=self.github, work=self.tmp / f"work{self.runs}")
        return failures, said.getvalue()

    def url(self, name, tag=None):
        return f"https://github.com/{self.REPO}/releases/download/{tag or self.TAG}/{name}"

    def test_fill_copies_joins_and_splits_and_skips_what_the_release_already_holds(self):
        app_parts, tar_parts = self.parts["inspire-app.zip"], self.parts["inspire-assets.tar"]
        self.assertGreater(len(tar_parts), 2)
        self.github.release("v1.3.0-src", {"inspire_installer_copy.py": self.files["inspire_installer.py"], app_parts[0]: self.files[app_parts[0]]})
        target = self.github.release(self.TAG, self.without("inspire_installer.py", "inspire-app.zip", app_parts[0], *tar_parts))
        with mock.patch.object(self.module, "split", wraps=self.module.split) as splitter:
            failures, said = self.fill()
        self.assertEqual(failures, [])
        self.assertEqual(self.github.bytes_of(target), self.files)
        made = ["inspire_installer.py", "inspire-app.zip", app_parts[0], *tar_parts]
        self.assertEqual(sorted(self.github.writes()), sorted(("POST", f"/repos/{self.REPO}/releases/{target}/assets", name) for name in made))
        self.assertIn(f"release fill {self.TAG}: {1 + len(app_parts)} already held, 2 copied, 1 joined, {len(tar_parts)} split, 0 failures", said)
        self.assertEqual(self.github.downloads.count(self.url("inspire-assets.tar")), 2)
        self.assertEqual(self.github.downloads.count(self.url(app_parts[0], "v1.3.0-src")), 1)
        self.assertEqual(splitter.call_count, 1)
        self.assertRegex(said, r"release check .*: (\d+) of \1 files OK, 0 failures")
        self.github.calls.clear()
        failures, said = self.fill()
        self.assertEqual((failures, self.github.writes()), ([], []))
        self.assertIn(f"{len(self.files) - 1} already held, 0 copied, 0 joined, 0 split, 0 failures", said)

    def test_a_corrupted_part_never_produces_an_upload(self):
        bad = self.unique_part()
        for lying in (True, False):
            self.github = support.FakeReleases()
            files = self.without("inspire-assets.tar")
            files[bad] = damaged(files[bad])
            self.github.release(self.TAG, files, digests={bad: support.sha(self.files[bad])} if lying else None)
            failures, _ = self.fill()
            self.assertEqual(self.github.writes(), [], lying)
            self.assertTrue(any(failure.startswith("inspire-assets.tar: ") for failure in failures), failures)
            self.assertTrue(any(failure.startswith(f"{bad}: ") for failure in failures), failures)

    def test_a_missing_file_fails_by_name_and_a_draft_is_never_a_source(self):
        self.github.release("v1.3.0-draft", {"inspire_installer.py": self.files["inspire_installer.py"]}, draft=True)
        self.github.release(self.TAG, self.without("inspire_installer.py"))
        failures, said = self.fill()
        self.assertIn(f"inspire_installer.py: no release of {self.REPO} holds it, its parts or its whole with the sha256 SHA256SUMS lists", failures)
        self.assertIn(f"inspire_installer.py: {self.TAG} does not hold it with the sha256 SHA256SUMS lists", failures)
        self.assertEqual(self.github.writes(), [])
        self.assertNotIn(self.url("inspire_installer.py", "v1.3.0-draft"), self.github.downloads)
        self.assertIn("  FAIL inspire_installer.py: no release", said)

    def test_a_latest_a_full_or_a_draft_release_is_refused_before_any_write(self):
        cases = ((dict(latest=True), "is the latest release, so fill leaves it alone"),
                 (dict(prerelease=False), "is not a published pre-release, so fill leaves it alone"),
                 (dict(draft=True), "is not a published pre-release, so fill leaves it alone"),
                 (None, f"{self.REPO} has no release {self.TAG}"))
        for flags, said in cases:
            self.github = support.FakeReleases()
            if flags is not None:
                self.github.release(self.TAG, self.without("inspire_installer.py"), **flags)
            self.github.release("v1.3.0-src", {"inspire_installer.py": self.files["inspire_installer.py"]})
            with self.assertRaises(SystemExit) as caught:
                self.fill()
            self.assertIn(said, str(caught.exception))
            self.assertEqual((self.github.writes(), self.github.downloads), ([], []), flags)

    def test_an_extra_file_is_reported_and_left_in_place(self):
        target = self.github.release(self.TAG, {**self.files, "notes.bin": b"x"})
        failures, _ = self.fill()
        self.assertEqual(failures, [f"{self.TAG} holds files SHA256SUMS does not list: ['notes.bin']"])
        self.assertEqual(self.github.writes(), [])
        self.assertIn("notes.bin", self.github.names(target))

    def test_a_held_copy_with_bytes_that_do_not_match_its_digest_is_skipped_for_a_good_one(self):
        good = self.files["inspire_installer.py"]
        self.github.release("v1.3.0-bad", {"inspire_installer.py": damaged(good)}, digests={"inspire_installer.py": support.sha(good)})
        self.github.release("v1.3.0-good", {"inspire_installer.py": good})
        target = self.github.release(self.TAG, self.without("inspire_installer.py"))
        failures, said = self.fill()
        self.assertEqual(failures, [])
        self.assertEqual(self.github.bytes_of(target)["inspire_installer.py"], good)
        self.assertIn(f"{self.url('inspire_installer.py', 'v1.3.0-bad')} gives no good copy of inspire_installer.py", said)

    def test_a_target_file_with_other_bytes_is_deleted_and_uploaded_again(self):
        target = self.github.release(self.TAG, {**self.files, "inspire_installer.py": b"stale"})
        self.github.release("v1.3.0-src", {"inspire_installer.py": self.files["inspire_installer.py"]})
        failures, _ = self.fill()
        self.assertEqual(failures, [])
        self.assertEqual([call[0] for call in self.github.writes()], ["DELETE", "POST"])
        self.assertEqual(self.github.bytes_of(target), self.files)

    def test_bytes_on_the_release_that_do_not_match_their_digest_fail_the_final_check(self):
        bad = self.unique_part()
        files = dict(self.files)
        files[bad] = damaged(files[bad])
        self.github.release(self.TAG, files, digests={bad: support.sha(self.files[bad])})
        failures, said = self.fill()
        self.assertEqual(self.github.writes(), [])
        self.assertTrue(any(failure.startswith(f"{bad}: ") for failure in failures), failures)
        self.assertIn(f"FAIL  {bad}", said)

    def test_bytes_that_do_not_hash_to_the_listed_sha256_are_never_uploaded(self):
        tar = self.files["inspire-assets.tar"]
        listed = support.sha(damaged(tar))
        manifest = json.loads(self.files["manifest.json"])
        manifest["files"][1]["sha256"] = listed
        manifest_bytes = (json.dumps(manifest, indent=1) + "\n").encode("utf-8")
        sums = release.parse_sums(self.files["SHA256SUMS"].decode("utf-8"))
        sums.update({"inspire-assets.tar": listed, "manifest.json": support.sha(manifest_bytes)})
        files = self.without("inspire-assets.tar")
        files.update({"manifest.json": manifest_bytes, "SHA256SUMS": "".join(f"{sums[name]}  {name}\n" for name in sorted(sums)).encode("utf-8")})
        self.github.release(self.TAG, files)
        failures, _ = self.fill()
        self.assertEqual(self.github.writes(), [])
        self.assertTrue(any(failure.startswith("inspire-assets.tar: no release") for failure in failures), failures)

    def test_sums_and_a_manifest_that_disagree_are_refused_before_any_write(self):
        lines = self.files["SHA256SUMS"].decode("utf-8").splitlines()
        self.github.release(self.TAG, {**self.files, "SHA256SUMS": "\n".join(lines[1:]).encode("utf-8") + b"\n"})
        with self.assertRaises(SystemExit) as caught:
            self.fill()
        self.assertIn("do not list the same files and sha256", str(caught.exception))
        self.assertEqual(self.github.writes(), [])

    def test_an_upload_github_stores_as_other_bytes_is_reported(self):
        self.github.release("v1.3.0-src", {"inspire_installer.py": self.files["inspire_installer.py"]})
        self.github.release(self.TAG, self.without("inspire_installer.py"))
        self.github.damage_uploads = True
        failures, _ = self.fill()
        self.assertIn("inspire_installer.py: the upload was refused or stored other bytes (GitHub answered 201)", failures)

    def test_listing_reads_every_page(self):
        with mock.patch.object(self.module, "PAGE", 2):
            for number in range(3):
                self.github.release(f"v1.2.{number}", {f"other{number}.bin": bytes([number])})
            self.github.release("v1.3.0-src", {"inspire_installer.py": self.files["inspire_installer.py"]})
            target = self.github.release(self.TAG, self.without("inspire_installer.py"))
            failures, _ = self.fill()
        self.assertEqual(failures, [])
        self.assertEqual(self.github.bytes_of(target), self.files)

    def test_the_command_needs_a_token_and_exits_non_zero_on_any_failure(self):
        target = self.github.release(self.TAG, self.without("inspire_installer.py"))
        original, tokens = self.module.load_starter, []

        def starter():
            ns = original()
            ns["open_trusted"] = self.github
            return ns

        def api(token):
            tokens.append(token)
            return self.github

        argv = ["fill", "--repo", self.REPO, "--tag", self.TAG]
        with mock.patch.dict(os.environ), mock.patch.object(self.module, "load_starter", starter), \
                mock.patch.object(self.module, "GitHubApi", api), contextlib.redirect_stdout(io.StringIO()):
            os.environ.pop("GITHUB_TOKEN", None)
            with self.assertRaises(SystemExit) as caught:
                self.module.main(argv)
            self.assertIn("GITHUB_TOKEN is not set", str(caught.exception))
            os.environ["GITHUB_TOKEN"] = "fake-value"
            self.assertEqual(self.module.main(argv), 1)
            self.github.add(target, "inspire_installer.py", self.files["inspire_installer.py"])
            self.assertEqual(self.module.main(argv), 0)
        self.assertEqual(tokens, ["fake-value", "fake-value"])

    def test_the_api_client_sends_the_token_only_to_github_and_reads_refusals(self):
        seen = []

        def opener(request, timeout):
            seen.append((request.get_method(), request.full_url, request.get_header("Authorization"), request.get_header("Content-length")))
            if request.full_url.endswith("/missing"):
                raise urllib.error.HTTPError(request.full_url, 404, "Not Found", {}, io.BytesIO(b'{"message": "Not Found"}'))
            response = support.FakeResponse(b'{"id": 7}', request.full_url)
            response.status = 201
            return response

        api = self.module.GitHubApi("fake-value", opener)
        self.assertEqual(api.call("GET", "/repos/x/missing"), (404, {"message": "Not Found"}))
        upload = "https://uploads.github.com/repos/x/releases/1/assets?name=a"
        self.assertEqual(api.call("POST", upload, io.BytesIO(b"abc"), "application/octet-stream", 3), (201, {"id": 7}))
        self.assertEqual(seen, [("GET", "https://api.github.com/repos/x/missing", "Bearer fake-value", None),
                                ("POST", upload, "Bearer fake-value", "3")])
        for url in ("https://example.com/repos/x", "http://api.github.com/repos/x", "https://api.github.com.example.org/x"):
            with self.assertRaises(SystemExit):
                api.call("GET", url)
        self.assertEqual(len(seen), 2)


MUTANTS = (
    ('latest.get("id") == release.get("id")', "False", "test_a_latest_a_full_or_a_draft_release_is_refused_before_any_write"),
    ('if release.get("draft") or not release.get("prerelease"):', "if False:", "test_a_latest_a_full_or_a_draft_release_is_refused_before_any_write"),
    ('extra = sorted(set(now) - set(sums) - {starter["SUMS"]})', "extra = []", "test_an_extra_file_is_reported_and_left_in_place"),
    ("repo, size, digest, opener=opener", "repo, size, None, opener=opener", "test_a_held_copy_with_bytes_that_do_not_match_its_digest_is_skipped_for_a_good_one"),
    (" or digest_of(str(path)) != (sizes[name][1], sizes[name][0])", "", "test_bytes_that_do_not_hash_to_the_listed_sha256_are_never_uploaded"),
    ("return failures + check(", "return failures + 0 * check(", "test_bytes_on_the_release_that_do_not_match_their_digest_fail_the_final_check"),
    ("if asset_sha256(target.get(name)) == sums[name]:", "if name in target:", "test_a_target_file_with_other_bytes_is_deleted_and_uploaded_again"),
    ('if item.get("draft"):', "if False:", "test_a_missing_file_fails_by_name_and_a_draft_is_never_a_source"),
    ("if len(got) < PAGE:", "if True:", "test_listing_reads_every_page"),
    ("if status != 201 or asset_sha256(got) not in (None, sums[name]):", "if status != 201:", "test_an_upload_github_stores_as_other_bytes_is_reported"),
    ("if all(parts):", "if False:", "test_fill_copies_joins_and_splits_and_skips_what_the_release_already_holds"),
    ('if entry["name"] not in splits:', "if True:", "test_fill_copies_joins_and_splits_and_skips_what_the_release_already_holds"),
    ("if name not in fetched:", "if True:", "test_fill_copies_joins_and_splits_and_skips_what_the_release_already_holds"),
    ("if api is None and not token:", "if False:", "test_the_command_needs_a_token_and_exits_non_zero_on_any_failure"),
    ("if urllib.parse.urlsplit(url).hostname not in API_HOSTS:", "if False:", "test_the_api_client_sends_the_token_only_to_github_and_reads_refusals"),
)


class FillMutationTest(unittest.TestCase):
    def mutant(self, old, new):
        source = pathlib.Path(release.__file__).read_text()
        self.assertEqual(source.count(old), 1, old)
        module = types.ModuleType("release_mutant")
        module.__file__ = release.__file__
        exec(compile(source.replace(old, new, 1), release.__file__, "exec"), module.__dict__)
        return module

    def outcome(self, test, module):
        case = FillTest(test)
        case.module = module
        result = unittest.TestResult()
        case.run(result)
        return result

    def test_every_mutation_of_fill_is_caught_by_its_test(self):
        for old, new, test in MUTANTS:
            with self.subTest(mutation=old):
                self.assertTrue(self.outcome(test, self.mutant(old, old)).wasSuccessful(), test)
                self.assertFalse(self.outcome(test, self.mutant(old, new)).wasSuccessful(), f"{old!r} to {new!r} passes {test}")


class FillWorkflowTest(unittest.TestCase):
    WORKFLOW = release.REPO / ".github" / "workflows" / "release-fill.yml"

    def tag_step(self):
        lines = self.WORKFLOW.read_text().splitlines()
        start = lines.index("        id: tag")
        begin = next(i for i in range(start, len(lines)) if lines[i].strip() == "run: |") + 1
        body = []
        for line in lines[begin:]:
            if line.strip() and not line.startswith("          "):
                break
            body.append(line[10:])
        return "\n".join(body) + "\n"

    def test_the_tag_comes_from_an_rc_branch_with_single_digit_segments_only(self):
        script, out = self.tag_step(), pathlib.Path(tempfile.mkdtemp(prefix="inspire_fill_wf_"))
        self.addCleanup(shutil.rmtree, out, True)
        cases = {"rc/fill-v1.3.0": "v1.3.0", "rc/fill-v1.3.0-rc.1": "v1.3.0-rc.1", "rc/fill-v0.0.0-filltest.1": "v0.0.0-filltest.1",
                 "rc/fill-v1.3.10": None, "rc/fill-v1.3.0-rc.10": None, "rc/fill-main": None, "rc/v1.3.0-rc.1": None,
                 "rc/fill-v0.0.0-filltest.12": None, "rc/fill-v1.3.0-fill-test": None, "rc/fill-v1.3.0;id": None, "main": None}
        for branch, tag in cases.items():
            target = out / f"out{len(list(out.iterdir()))}"
            target.write_text("")
            run = subprocess.run(["bash", "-c", script], env={"BRANCH": branch, "GITHUB_OUTPUT": str(target), "PATH": os.environ["PATH"]},
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode == 0, tag is not None, branch)
            self.assertEqual(target.read_text(), f"tag={tag}\n" if tag else "", branch)

    def test_the_workflow_writes_only_release_files_from_the_pushed_commit_with_its_own_token(self):
        text = self.WORKFLOW.read_text()
        for line in ("      - 'rc/fill-**'", "  contents: write", "    timeout-minutes: 45", "          ref: ${{ github.sha }}",
                     "          python-version: '3.11'", "          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
                     '        run: python3 app/installer/release.py fill --repo "$GITHUB_REPOSITORY" --tag "$TAG"'):
            self.assertIn(line + "\n", text)
        self.assertEqual(text.count("permissions:"), 1)
        self.assertNotIn("pull_request", text)


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
