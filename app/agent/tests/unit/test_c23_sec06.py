"""SEC-06 (App shell): a person never gets rows or columns their own row filters / column masks hide. When the App declares protected
tables, a read that would run as the service principal is refused; the person's own token is the only identity that reads them."""
import os
import sys
import threading

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402

SOURCE = "main.s.orders_v2"
PROTECTED = {SOURCE: "a row filter"}


class SpUsed(Exception):
    pass


def _shell(settings, inside=False):
    shell = shell_core.Shell.__new__(shell_core.Shell)
    shell.settings, shell.inside = dict(settings), inside
    shell.env, shell._sp, shell._writer, shell.writer_factory = {"DATABRICKS_HOST": "h"}, None, None, None
    shell.viewers_lock = threading.Lock()

    def sp():
        raise SpUsed("the service principal was used")

    shell.sp_factory = sp
    shell.user_factory = lambda host, token: type("W", (), {})()
    return shell


@pytest.mark.parametrize("settings,inside", [({"auth": "sp", "protected": PROTECTED}, False),
                                             ({"auth": "user", "protected": PROTECTED}, True),
                                             ({"auth": "sp", "protected": PROTECTED}, True)])
def test_a_read_that_would_run_as_the_service_principal_is_refused_when_tables_are_protected(settings, inside):
    shell = _shell(settings, inside)
    with pytest.raises(shell_core.HttpError) as refused:
        shell.workspace({"x-forwarded-access-token": "t", "x-forwarded-email": "a@b.c"})
    assert refused.value.status == 403 and SOURCE in str(refused.value.message)


def test_the_overlay_read_of_a_protected_table_is_refused_without_the_service_principal():
    shell = _shell({"auth": "user", "protected": PROTECTED})
    with pytest.raises(shell_core.HttpError) as refused:
        shell.overlay_rows(SOURCE, ["a"], "a", [1])
    assert refused.value.status == 403


def test_unprotected_apps_and_per_user_reads_are_unchanged():
    assert _shell({"auth": "user", "protected": PROTECTED}).workspace({"x-forwarded-access-token": "t"})[1].startswith("user:")
    with pytest.raises(SpUsed):
        _shell({"auth": "sp", "protected": {}}).workspace({})
    with pytest.raises(SpUsed):
        _shell({"auth": "user"}, inside=True).workspace({})
