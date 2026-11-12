import pathlib
import tempfile
import unittest

import support

ROOT_INSTALLER = pathlib.Path(support.INSTALLER_DIR).parent.parent / "inspire_installer.py"


def load_root_installer():
    """The root inspire_installer.py without its last cell, which installs when run."""
    source = ROOT_INSTALLER.read_text(encoding="utf-8")
    body = source.split("installed, failure = inspire_install_main()")[0]
    namespace = {"__name__": "inspire_installer_under_test"}
    exec(compile(body, str(ROOT_INSTALLER), "exec"), namespace)
    return namespace


class LocalFilesTest(unittest.TestCase):
    def setUp(self):
        self.ns = load_root_installer()
        self.folder = tempfile.mkdtemp(prefix="inspire_local_")

    def test_local_files_setting_never_asks_github(self):
        asked = []

        def opener(*args, **kwargs):
            asked.append(args)
            raise AssertionError("GitHub was asked")
        with self.assertRaises(self.ns["InspireNotInstalled"]) as raised:
            self.ns["acquire"](self.folder, "nb", {"local_files": "1"}, opener=opener, exporter=None)
        self.assertEqual(asked, [])
        self.assertIn("no complete release is next to this installer", str(raised.exception))

    def test_without_the_setting_the_installer_tries_github_first(self):
        asked = []

        def opener(*args, **kwargs):
            asked.append(args)
            raise OSError("no network in this test")
        with self.assertRaises(self.ns["InspireNotInstalled"]):
            self.ns["acquire"](self.folder, "nb", {}, opener=opener, exporter=None)
        self.assertEqual(len(asked), 1)

    def test_local_files_setting_must_be_one_to_skip_github(self):
        asked = []

        def opener(*args, **kwargs):
            asked.append(args)
            raise OSError("no network in this test")
        with self.assertRaises(self.ns["InspireNotInstalled"]):
            self.ns["acquire"](self.folder, "nb", {"local_files": "0"}, opener=opener, exporter=None)
        self.assertEqual(len(asked), 1)
