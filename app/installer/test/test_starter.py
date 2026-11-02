import ast
import json
import os
import pathlib
import shutil
import socket
import subprocess
import tempfile
import types
import unittest
import urllib.error
import urllib.request
import zipfile

import support

LATEST = "https://github.com/amralieg/inspire/releases/latest/download"


class StarterCase(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="inspire_starter_"))
        self.ns = support.load_starter(self.tmp / "stage")
        self.folder = self.tmp / "Users" / "someone@example.com" / "inspire"
        self.folder.mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def release(self, name="release", **kwargs):
        return support.build_release(self.tmp, name, **kwargs)

    def copy(self, out, names):
        for name in names:
            shutil.copyfile(out / name, self.folder / name)

    def manifest(self, out):
        return json.loads((out / "manifest.json").read_text())

    def acquire(self, settings, opener):
        return self.ns["acquire"](str(self.folder), "/Users/someone@example.com/inspire/inspire_installer", settings, opener=opener,
                                  exporter=lambda stem, kind: None)


class TrustTest(StarterCase):
    def test_only_https_release_files_on_github_and_its_download_hosts_are_trusted(self):
        trusted = self.ns["trusted_url"]
        for url in (f"{LATEST}/manifest.json", "https://objects.githubusercontent.com/github-production-release-asset/1/x",
                    "https://release-assets.githubusercontent.com/github-production-release-asset/1/x?sig=1"):
            self.assertEqual(trusted(url, "amralieg/inspire"), url)
        for url in ("http://github.com/amralieg/inspire/releases/latest/download/manifest.json",
                    "https://evil.example.com/amralieg/inspire/releases/latest/download/manifest.json",
                    "https://github.com.evil.example.com/amralieg/inspire/releases/x",
                    "https://github.com/someone/else/releases/latest/download/manifest.json",
                    "https://github.com/mwissad/InspireAI/releases/latest/download/manifest.json",
                    "https://github.com/amralieg/inspire/archive/main.zip",
                    "https://user@github.com/amralieg/inspire/releases/latest/download/x",
                    "https://github.com:8443/amralieg/inspire/releases/latest/download/x",
                    "ftp://github.com/amralieg/inspire/releases/x"):
            with self.assertRaises(self.ns["InspireTrustError"], msg=url):
                trusted(url, "amralieg/inspire")

    def test_a_redirect_to_another_host_is_refused_and_one_to_the_download_host_is_followed(self):
        handler = self.ns["TrustedRedirects"]("amralieg/inspire")
        request = urllib.request.Request(f"{LATEST}/manifest.json")
        with self.assertRaises(self.ns["InspireTrustError"]):
            handler.redirect_request(request, None, 302, "Found", {}, "https://evil.example.com/manifest.json")
        with self.assertRaises(self.ns["InspireTrustError"]):
            handler.redirect_request(request, None, 302, "Found", {}, "http://objects.githubusercontent.com/x")
        followed = handler.redirect_request(request, None, 302, "Found", {}, "https://release-assets.githubusercontent.com/a/b?x=1")
        self.assertEqual(followed.full_url, "https://release-assets.githubusercontent.com/a/b?x=1")

    def test_a_download_whose_final_address_is_another_host_is_refused_and_leaves_no_file(self):
        def opener(url, repo, timeout):
            return support.FakeResponse(b"x", "https://evil.example.com/manifest.json")
        dest = self.tmp / "d" / "manifest.json"
        with self.assertRaises(self.ns["InspireTrustError"]):
            self.ns["download"](f"{LATEST}/manifest.json", str(dest), "amralieg/inspire", opener=opener)
        self.assertEqual(sorted(os.listdir(dest.parent)), [])

    def test_a_wrong_host_in_the_download_address_never_reaches_the_opener(self):
        seen = []
        with self.assertRaises(self.ns["InspireTrustError"]):
            self.ns["download"]("https://evil.example.com/x", str(self.tmp / "x"), "amralieg/inspire", opener=lambda *a: seen.append(a))
        self.assertEqual(seen, [])

    def test_a_bad_checksum_a_truncated_file_and_an_oversized_file_are_refused_and_leave_no_file(self):
        data = b"inspire" * 100
        opener = lambda url, repo, timeout: support.FakeResponse(data, url)
        download = self.ns["download"]
        cases = [(len(data), "0" * 64, "does not match its sha256"), (len(data) + 10, support.sha(data), "cut short"),
                 (len(data) - 10, support.sha(data), "larger than")]
        for size, digest, words in cases:
            dest = self.tmp / "dl" / "inspire-app.zip"
            with self.assertRaises(self.ns["InspireReleaseError"]) as caught:
                download(f"{LATEST}/inspire-app.zip", str(dest), "amralieg/inspire", size, digest, opener=opener)
            self.assertIn(words, str(caught.exception))
            self.assertEqual(os.listdir(dest.parent), [], words)
        dest = self.tmp / "dl" / "inspire-app.zip"
        download(f"{LATEST}/inspire-app.zip", str(dest), "amralieg/inspire", len(data), support.sha(data), opener=opener)
        self.assertEqual(dest.read_bytes(), data)

    def test_the_test_setting_points_only_at_a_release_of_the_fork(self):
        source = self.ns["release_source"]
        self.assertEqual(source({}), (LATEST, "amralieg/inspire"))
        self.assertEqual(source({"release": support.FORK_BASE + "/"}), (support.FORK_BASE, "amralieg/inspire"))
        for bad in ("https://github.com/someone/else/releases/download/v1", "https://evil.example.com/x",
                    "http://github.com/amralieg/inspire/releases/download/v1",
                    "https://github.com/amralieg/inspire/releases/download/v1/../../x"):
            with self.assertRaises(self.ns["InspireTrustError"], msg=bad):
                source({"release": bad})

    def test_settings_hold_only_the_known_keys(self):
        read = self.ns["read_settings"]
        self.assertEqual(read(str(self.folder)), {})
        (self.folder / "inspire_installer_test.json").write_text('{"release": "x", "app_name": "inspire-inst-test"}')
        self.assertEqual(read(str(self.folder))["app_name"], "inspire-inst-test")
        for text in ('{"release": "x", "proxy": "y"}', '{"internet": false}', '{"internet": "no"}', "[1]", '{"warehouse_id": 7}'):
            (self.folder / "inspire_installer_test.json").write_text(text)
            with self.assertRaises(self.ns["InspireReleaseError"], msg=text):
                read(str(self.folder))

    def test_no_link_in_the_starter_names_a_version_or_the_github_api(self):
        source = support.release.STARTER.read_text()
        self.assertEqual(self.ns["RELEASE_REPO"], "amralieg/inspire")
        self.assertEqual(self.ns["LATEST_BASE"], "https://github.com/amralieg/inspire/releases/latest/download")
        self.assertNotIn("api.github.com", source)
        self.assertIn('LATEST_BASE = f"https://github.com/{RELEASE_REPO}/releases/latest/download"', source)
        self.assertEqual([line for line in source.splitlines() if "releases/download/v" in line or "releases/tag/v" in line], [])


class ManifestTest(StarterCase):
    def test_a_manifest_this_installer_cannot_trust_is_refused(self):
        good = self.manifest(self.release())
        check = self.ns["check_manifest"]
        self.assertIs(check(good), good)
        broken = []
        for change in (lambda m: m.update(format=2), lambda m: m.update(version="v1.10.0"), lambda m: m.update(version="1.3.0"),
                       lambda m: m.pop("starter_min_version"), lambda m: m.update(files=[]),
                       lambda m: m["files"][0].update(name="../inspire-app.zip"), lambda m: m["files"][0].update(sha256="x"),
                       lambda m: m["files"][0]["parts"][0].update(name="inspire-app.part02"),
                       lambda m: m["files"][0]["parts"][0].update(size=m["files"][0]["parts"][0]["size"] + 1),
                       lambda m: m["files"][0]["contents"][0].update(path="/etc/passwd"),
                       lambda m: m["entry"].update(file="other.zip"), lambda m: m["entry"].update(module="../x.py"),
                       lambda m: m["files"][1].update(name="inspire-app.zip")):
            manifest = json.loads(json.dumps(good))
            change(manifest)
            with self.assertRaises(self.ns["InspireReleaseError"]):
                check(manifest)
            broken.append(1)
        self.assertEqual(len(broken), 13)

    def test_a_starter_older_than_the_release_needs_shows_the_latest_installer_link_and_stops(self):
        out = self.release()
        manifest = self.manifest(out)
        manifest["starter_min_version"] = 2
        (out / "manifest.json").write_text(json.dumps(manifest))
        github = support.FakeGitHub(LATEST, out)
        with self.assertRaises(self.ns["InspireNotInstalled"]) as caught:
            self.acquire({}, github)
        self.assertIn(f"{LATEST}/inspire_installer.py", str(caught.exception))
        self.assertEqual(github.requested, ["manifest.json"])
        self.assertIn("This installer is too old", self.ns["shown"][-1])


class OnlineTest(StarterCase):
    def test_online_the_latest_set_is_downloaded_and_checked_and_a_matching_file_next_to_the_installer_is_not_downloaded(self):
        out = self.release()
        self.copy(out, ["inspire-assets.tar"])
        github = support.FakeGitHub(LATEST, out)
        got = self.acquire({}, github)
        self.assertEqual(github.requested, ["manifest.json", "inspire-app.zip"])
        self.assertEqual(got["source"], "online")
        self.assertEqual(got["files"]["inspire-assets.tar"], str(self.folder / "inspire-assets.tar"))
        self.assertEqual(pathlib.Path(got["files"]["inspire-app.zip"]).read_bytes(), (out / "inspire-app.zip").read_bytes())
        again = support.FakeGitHub(LATEST, out)
        self.acquire({}, again)
        self.assertEqual(again.requested, ["manifest.json"], "a file downloaded and checked before is not downloaded again")

    def test_online_a_changed_file_on_github_is_refused_never_installed_and_the_page_says_why(self):
        out = self.release()
        github = support.FakeGitHub(LATEST, out)
        github.files["inspire-app.zip"] = b"changed" + github.files["inspire-app.zip"][7:]
        loaded = []
        self.ns["load_entry"] = loaded.append
        with self.assertRaises(self.ns["InspireNotInstalled"]):
            self.acquire({}, github)
        self.assertIn("inspire-app.zip does not match its sha256 in manifest.json", self.ns["shown"][-1])
        self.assertFalse((self.tmp / "stage" / "v1.3.0" / "inspire-app.zip").exists())
        self.assertEqual(loaded, [])

    def test_online_a_stale_file_next_to_the_installer_is_not_used_and_the_release_file_is_downloaded(self):
        old = self.release("old", assets={"fonts/inter-400.ttf": b"old font"})
        new = self.release("new")
        shutil.copyfile(old / "inspire-assets.tar", self.folder / "inspire-assets.tar")
        github = support.FakeGitHub(LATEST, new)
        got = self.acquire({}, github)
        self.assertIn("inspire-assets.tar", github.requested)
        self.assertEqual(pathlib.Path(got["files"]["inspire-assets.tar"]).read_bytes(), (new / "inspire-assets.tar").read_bytes())

    def test_the_test_setting_points_the_download_at_the_fork_pre_release(self):
        out = self.release()
        github = support.FakeGitHub(support.FORK_BASE, out)
        got = self.acquire({"release": support.FORK_BASE}, github)
        self.assertEqual(got["source"], "online")
        self.assertEqual(github.requested, ["manifest.json", "inspire-app.zip", "inspire-assets.tar"])


class LocalTest(StarterCase):
    def unreachable(self):
        return support.FakeGitHub(LATEST, fail=urllib.error.URLError("[Errno 8] nodename nor servname provided"))

    def test_without_github_the_complete_whole_files_next_to_the_installer_are_used(self):
        out = self.release()
        self.copy(out, ["manifest.json", "inspire-app.zip", "inspire-assets.tar"])
        got = self.acquire({}, self.unreachable())
        self.assertEqual(got["source"], "local")
        self.assertEqual(got["files"], {"inspire-app.zip": str(self.folder / "inspire-app.zip"),
                                        "inspire-assets.tar": str(self.folder / "inspire-assets.tar")})

    def test_internet_blocked_ships_false_next_to_the_release_repo(self):
        lines = support.release.STARTER.read_text().splitlines()
        self.assertIs(self.ns["INTERNET_BLOCKED"], False)
        self.assertEqual([line for line in lines if line.startswith("INTERNET_BLOCKED")], ["INTERNET_BLOCKED = False"])
        self.assertEqual(lines[lines.index("INTERNET_BLOCKED = False") - 1], 'RELEASE_REPO = "amralieg/inspire"')

    def test_only_the_reachability_check_reads_internet_blocked(self):
        tree = ast.parse(support.release.STARTER.read_text())
        readers = sorted({node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
                          for name in ast.walk(node) if isinstance(name, ast.Name) and name.id == "INTERNET_BLOCKED"})
        self.assertEqual(readers, ["github_reachable"])
        top = [node for node in tree.body if any(isinstance(name, ast.Name) and name.id == "INTERNET_BLOCKED" for name in ast.walk(node))]
        self.assertEqual([type(node).__name__ for node in top], ["Assign", "FunctionDef"])

    def test_the_reachability_check_says_false_when_blocked_before_any_call(self):
        github = support.FakeGitHub(LATEST, self.release())
        self.ns["INTERNET_BLOCKED"] = True
        self.assertIs(self.ns["github_reachable"](LATEST, "amralieg/inspire", str(self.tmp / "m.json"), github), False)
        self.assertEqual(github.requested, [])
        self.ns["INTERNET_BLOCKED"] = False
        self.assertIs(self.ns["github_reachable"](LATEST, "amralieg/inspire", str(self.tmp / "m.json"), github), True)
        self.assertEqual(github.requested, ["manifest.json"])

    def test_internet_blocked_takes_the_complete_local_set_without_asking_github(self):
        out = self.release()
        self.copy(out, ["manifest.json", "inspire-app.zip", "inspire-assets.tar"])
        github = support.FakeGitHub(LATEST, out)
        self.ns["INTERNET_BLOCKED"] = True
        got = self.acquire({}, github)
        self.assertEqual((got["source"], github.requested), ("local", []))

    def test_internet_blocked_without_a_local_set_shows_the_download_page(self):
        github = support.FakeGitHub(LATEST, self.release())
        self.ns["INTERNET_BLOCKED"] = True
        with self.assertRaises(self.ns["InspireNotInstalled"]):
            self.acquire({}, github)
        self.assertEqual(github.requested, [])
        self.assertIn(self.ns["NOT_REACHED"], self.ns["shown"][-1])
        self.assertIn("INTERNET_BLOCKED", self.ns["shown"][-1])

    def test_internet_blocked_makes_no_outbound_call(self):
        calls = []

        def refuse(*args, **kwargs):
            calls.append(args[:2])
            raise OSError("socket guard refused")

        guarded = (socket.getaddrinfo, socket.socket.connect, socket.socket.connect_ex, socket.create_connection)
        socket.getaddrinfo = refuse
        socket.socket.connect = socket.socket.connect_ex = lambda self, address: refuse(address)
        socket.create_connection = refuse
        try:
            self.ns["INTERNET_BLOCKED"] = True
            with self.assertRaises(self.ns["InspireNotInstalled"]):
                self.ns["acquire"](str(self.folder), "/n", {}, exporter=lambda stem, kind: None)
            self.assertEqual(calls, [])
            self.ns["INTERNET_BLOCKED"] = False
            with self.assertRaises(self.ns["InspireNotInstalled"]):
                self.ns["acquire"](str(self.folder), "/n", {}, exporter=lambda stem, kind: None)
            self.assertGreater(len(calls), 0, "the guard sees the real opener, so the blocked case above is a real zero")
        finally:
            socket.getaddrinfo, socket.socket.connect, socket.socket.connect_ex, socket.create_connection = guarded

    def test_parts_alone_are_joined_in_order_and_checked(self):
        out = self.release()
        manifest = self.manifest(out)
        names = [part["name"] for entry in manifest["files"] for part in entry["parts"]]
        self.assertGreater(len(names), 4)
        self.copy(out, ["manifest.json"] + list(reversed(names)))
        got = self.acquire({}, self.unreachable())
        for entry in manifest["files"]:
            self.assertEqual(pathlib.Path(got["files"][entry["name"]]).read_bytes(), (out / entry["name"]).read_bytes())

    def test_two_parts_swapped_are_refused_as_not_one_release(self):
        out = self.release()
        parts = self.manifest(out)["files"][1]["parts"]
        self.copy(out, ["manifest.json", "inspire-app.zip"])
        for index, part in enumerate(parts):
            source = parts[1 - index]["name"] if index < 2 else part["name"]
            shutil.copyfile(out / source, self.folder / part["name"])
        with self.assertRaises(self.ns["InspireNotInstalled"]) as caught:
            self.acquire({}, self.unreachable())
        self.assertIn("not one Inspire release", str(caught.exception))

    def test_a_set_mixed_across_two_releases_is_refused_with_a_plain_message(self):
        old = self.release("old", assets={"fonts/inter-400.ttf": b"old font"})
        new = self.release("new")
        shutil.copyfile(new / "manifest.json", self.folder / "manifest.json")
        shutil.copyfile(new / "inspire-app.zip", self.folder / "inspire-app.zip")
        shutil.copyfile(old / "inspire-assets.tar", self.folder / "inspire-assets.tar")
        with self.assertRaises(self.ns["InspireNotInstalled"]) as caught:
            self.acquire({}, self.unreachable())
        message = str(caught.exception)
        self.assertIn("are not one Inspire release: inspire-assets.tar does not match manifest.json of Inspire v1.3.0", message)
        self.assertIn("Download every file of one release again", message)
        self.assertIn("not one Inspire release", self.ns["shown"][-1])

    def test_a_missing_part_is_never_used_and_the_page_names_it(self):
        out = self.release()
        manifest = self.manifest(out)
        parts = [part["name"] for part in manifest["files"][1]["parts"]]
        self.copy(out, ["manifest.json", "inspire-app.zip"] + parts[:-1])
        with self.assertRaises(self.ns["InspireNotInstalled"]):
            self.acquire({}, self.unreachable())
        page = self.ns["shown"][-1]
        self.assertIn(f"{parts[-1]} is missing", page)
        self.assertIn(f"{parts[0]}</a>", page)
        self.assertIn(f"{manifest['files'][1]['parts'][0]['size']} bytes", page, "with a local manifest the links carry exact sizes")

    def unzip(self, out, into):
        with zipfile.ZipFile(out / "inspire-app.zip") as archive:
            archive.extractall(into)
            notebooks = {"dbx_inspire_ai_agent": archive.read("dbx_inspire_ai_agent.ipynb"),
                         "dbx_generate_demo_data": archive.read("dbx_generate_demo_data.py")}
            plain = {name: archive.read(name) for name in archive.namelist() if not name.startswith("dbx_")}
        for name in ("dbx_inspire_ai_agent.ipynb", "dbx_generate_demo_data.py"):
            (into / name).unlink()
        return notebooks, plain

    def test_a_folder_the_workspace_unzipped_is_checked_file_by_file_and_repacked_for_the_install(self):
        for into in ("inspire-app", ""):
            out = self.release(f"r{len(into)}")
            for path in self.folder.iterdir():
                shutil.rmtree(path) if path.is_dir() else path.unlink()
            self.copy(out, ["manifest.json", "inspire-assets.tar"])
            notebooks, plain = self.unzip(out, self.folder / into)
            exported = lambda stem, kind: notebooks.get(os.path.basename(stem))
            got = self.ns["acquire"](str(self.folder), "/n", {}, opener=self.unreachable(), exporter=exported)
            repacked = got["files"]["inspire-app.zip"]
            self.assertTrue(repacked.endswith("/unzipped/inspire-app.zip"), into)
            with zipfile.ZipFile(repacked) as archive:
                self.assertEqual({name: archive.read(name) for name in plain}, plain, into)
                self.assertEqual(archive.read("dbx_inspire_ai_agent.ipynb"), notebooks["dbx_inspire_ai_agent"], into)
            self.assertEqual(got["files"]["inspire-assets.tar"], str(self.folder / "inspire-assets.tar"))
            self.assertEqual(self.ns["load_entry"](got)({"displayHTML": lambda h: None, "files": got["files"], "source": "local",
                                                         "manifest": got["manifest"], "settings": {}})["source"], "local")
            changed = lambda stem, kind: notebooks.get(os.path.basename(stem)).replace(b"print(1)", b"print(2)")
            with self.assertRaises(self.ns["InspireNotInstalled"], msg=into):
                self.ns["acquire"](str(self.folder), "/n", {}, opener=self.unreachable(), exporter=changed)

    def test_a_readme_of_your_own_next_to_the_installer_is_not_taken_for_the_unzipped_app(self):
        out = self.release()
        self.copy(out, ["manifest.json", "inspire-assets.tar"])
        (self.folder / "README.md").write_text("my notes")
        with self.assertRaises(self.ns["InspireNotInstalled"]):
            self.acquire({}, self.unreachable())
        self.assertIn("inspire-app.zip is missing", self.ns["shown"][-1])

    def test_a_folder_the_workspace_unzipped_without_its_plain_files_is_refused_and_the_parts_are_asked_for(self):
        out = self.release()
        self.copy(out, ["manifest.json", "inspire-assets.tar"])
        unzipped = self.folder / "inspire-app"
        unzipped.mkdir()
        with self.assertRaises(self.ns["InspireNotInstalled"]):
            self.ns["acquire"](str(self.folder), "/n", {}, opener=self.unreachable(), exporter=lambda stem, kind: None)
        self.assertIn("kept 0 of 5 files", self.ns["shown"][-1])
        self.assertIn("import the inspire-app.partNN files instead", self.ns["shown"][-1])


class OfflinePageTest(StarterCase):
    def test_with_nothing_local_the_page_shows_the_commands_the_folder_the_rerun_step_and_the_links(self):
        printed = []
        self.ns["print"] = lambda *a, **k: printed.append(" ".join(str(x) for x in a))
        with self.assertRaises(self.ns["InspireNotInstalled"]):
            self.ns["acquire"](str(self.folder), "/Users/someone@example.com/inspire/inspire_installer", {},
                               opener=support.FakeGitHub(LATEST, fail=TimeoutError("timed out")))
        page, text = self.ns["shown"][-1], printed[-1]
        for body in (page, text):
            for words in ("I am not able to connect to GitHub to download the Inspire code", "curl -fL --retry 3",
                          "shasum -a 256 -c SHA256SUMS", "sha256sum -c SHA256SUMS", "Invoke-WebRequest", "Get-FileHash",
                          "Windows PowerShell", "refuses files over 10 MB", "part[0-9]", str(self.folder), "run this installer again",
                          f"{LATEST}/inspire-app.zip", f"{LATEST}/inspire-assets.tar", f"{LATEST}/SHA256SUMS",
                          "no answer in 10 seconds", "No manifest.json is next to this installer"):
                self.assertIn(words.replace('"', "&quot;") if body is page else words, body)
        self.assertIn("https://github.com/amralieg/inspire/releases/latest", page)
        order = [page.index(words) for words in ("curl -fL", "refuses files over 10 MB", "<h3>2. Import the files into this workspace folder",
                                                 "<h3>3. Then run this installer again", "If the commands fail")]
        self.assertEqual(order, sorted(order), "whole files, then the parts, then the folder, then run again, then the links")
        self.assertIn(f">{self.folder}</pre>", page)
        self.assertNotIn("<script", page)

    def test_the_unix_commands_parse_in_bash(self):
        for system, whole, split in self.ns["download_commands"](LATEST):
            if system == "Windows PowerShell":
                continue
            for lines in (whole, split):
                run = subprocess.run(["bash", "-n", "-c", "\n".join(lines)], capture_output=True, text=True)
                self.assertEqual(run.returncode, 0, run.stderr)

    def test_the_page_escapes_what_it_shows(self):
        page, _ = self.ns["offline_page"](LATEST, "/Workspace/Users/a<b>/x", "/n", ["<script>alert(1)</script>"])
        self.assertNotIn("<script>", page)
        self.assertIn("&lt;script&gt;", page)


class EntryTest(StarterCase):
    def test_main_installs_from_the_module_inside_the_release_with_the_checked_files(self):
        out = self.release()
        self.ns["open_trusted"] = support.FakeGitHub(LATEST, out)
        path = "/Users/someone@example.com/inspire/inspire_installer"
        context = types.SimpleNamespace(notebookPath=lambda: types.SimpleNamespace(get=lambda: path))
        notebook = types.SimpleNamespace(getContext=lambda: context)
        self.ns["dbutils"] = types.SimpleNamespace(notebook=types.SimpleNamespace(entry_point=types.SimpleNamespace(
            getDbutils=lambda: types.SimpleNamespace(notebook=lambda: notebook))))
        self.ns["installer_folder"] = lambda: (str(self.folder), path)
        installed, failure = self.ns["inspire_install_main"]()
        self.assertIsNone(failure)
        self.assertEqual(installed, {"ran": ["inspire-app.zip", "inspire-assets.tar"], "source": "online", "version": "v1.3.0", "settings": {}})
        self.assertEqual(self.ns["shown"][-1], "<p>installed</p>")

    def test_a_failing_install_step_comes_back_after_its_banner_instead_of_ending_the_cell(self):
        out = self.release()
        self.ns["open_trusted"] = support.FakeGitHub(LATEST, out)
        self.ns["installer_folder"] = lambda: (str(self.folder), "/n")
        self.ns["dbutils"] = types.SimpleNamespace()
        broken = RuntimeError("the warehouse refused SELECT 1")

        def run(env):
            env["displayHTML"]("<p>banner</p>")
            raise broken

        self.ns["load_entry"] = lambda release: run
        installed, failure = self.ns["inspire_install_main"]()
        self.assertIsNone(installed)
        self.assertIs(failure, broken)
        self.assertEqual(self.ns["shown"][-1], "<p>banner</p>")

    def test_scan_catalogs_sits_next_to_internet_blocked_and_reaches_the_install_steps(self):
        lines = support.release.STARTER.read_text().splitlines()
        self.assertEqual(lines[lines.index("INTERNET_BLOCKED = False") + 1], 'SCAN_CATALOGS = "all"')
        self.assertEqual([line for line in lines if line.startswith("SCAN_CATALOGS")], ['SCAN_CATALOGS = "all"'])
        out = self.release()
        self.ns["open_trusted"] = support.FakeGitHub(LATEST, out)
        self.ns["installer_folder"] = lambda: (str(self.folder), "/n")
        self.ns["dbutils"] = types.SimpleNamespace()
        seen = []
        self.ns["load_entry"] = lambda release: seen.append
        for value in ("all", ["sales", "finance"]):
            self.ns["SCAN_CATALOGS"] = value
            installed, failure = self.ns["inspire_install_main"]()
            self.assertIsNone(failure)
        self.assertEqual([env["scan_catalogs"] for env in seen], ["all", ["sales", "finance"]])

    def test_the_module_must_match_its_line_in_the_manifest(self):
        out = self.release()
        got = self.acquire({}, support.FakeGitHub(LATEST, out))
        tampered = self.tmp / "tampered.zip"
        support.make_app_zip(tampered, module="def run(env):\n    return 'evil'\n")
        got["files"]["inspire-app.zip"] = str(tampered)
        with self.assertRaises(self.ns["InspireMixedRelease"]):
            self.ns["load_entry"](got)

    def test_a_failed_download_never_loads_the_install_steps(self):
        loaded = []
        self.ns["load_entry"] = lambda release: loaded.append(release)
        self.ns["installer_folder"] = lambda: (str(self.folder), "/n")
        self.ns["open_trusted"] = support.FakeGitHub(LATEST, fail=urllib.error.URLError("refused"))
        installed, failure = self.ns["inspire_install_main"]()
        self.assertIsNone(installed)
        self.assertIsInstance(failure, self.ns["InspireNotInstalled"])
        self.assertEqual(loaded, [])
        self.assertIn(self.ns["NOT_REACHED"], self.ns["shown"][-1], "the page is shown by the cell that ends normally")

    def test_the_installer_shows_its_page_in_one_cell_and_fails_the_run_in_the_next(self):
        source = support.release.STARTER.read_text()
        self.assertTrue(source.startswith("# Databricks notebook source\n"))
        cells = [cell.strip() for cell in source.split("# COMMAND ----------")]
        self.assertEqual(cells[-2], "installed, failure = inspire_install_main()",
                         "an assignment, so the notebook never prints the install context")
        self.assertEqual(cells[-1], "if failure is not None:\n    raise failure")
        self.assertNotIn("%pip", source)
        self.assertNotIn("import requests", source)

    def test_the_last_cell_fails_the_run_only_when_the_install_failed(self):
        source = support.release.STARTER.read_text()
        last = compile(source.split("# COMMAND ----------")[-1], "last cell", "exec")
        refused = self.ns["InspireNotInstalled"]("no release")
        with self.assertRaises(self.ns["InspireNotInstalled"]):
            exec(last, {"installed": None, "failure": refused})
        exec(last, {"installed": {"done": True}, "failure": None})


if __name__ == "__main__":
    unittest.main()
