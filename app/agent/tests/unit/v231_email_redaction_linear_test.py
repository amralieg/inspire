"""Finding an email address takes time in proportion to the text, so a Genie run that writes a long unbroken line to its error
output (300,000 characters in the noisy-Genie test) is redacted in well under a second instead of hanging for minutes, and every
email is still found exactly as before."""
import importlib
import os
import re
import sys
import time

import pytest

from _nbload import ROOT

SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

OLD_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
LONG = "e" * 200000
CORPUS = [s.replace(" AT ", "@") for s in (
    "write to pat.lee+test AT example.co.uk now", "a.b AT c.d", "x AT y.z and p.q AT r-s.com", "no address here", " AT example.com alone",
    "dots...a AT b.co", "tok-123 someone AT example.com, other AT host.example.org;", "mail:first.last AT sub.domain.example",
    "a AT b", "a AT b.", "\u00e9mile AT exemple.fr", "user_name AT host_name.io", "+tag AT x.io", LONG[:50] + " AT example.com")]


def _shell(name):
    return importlib.import_module(name)


def _patterns(agent_ns):
    return {"notebook INSPIRE_SECRET_EMAIL_RE": agent_ns["INSPIRE_SECRET_EMAIL_RE"],
            "shell_redact INSPIRE_SECRET_EMAIL_RE": _shell("shell_redact").INSPIRE_SECRET_EMAIL_RE,
            "shell_agent DRAFT_LINK": _shell("shell_agent").DRAFT_LINK}


@pytest.mark.parametrize("which", ["notebook INSPIRE_SECRET_EMAIL_RE", "shell_redact INSPIRE_SECRET_EMAIL_RE", "shell_agent DRAFT_LINK"])
def test_a_long_unbroken_line_is_searched_for_emails_in_well_under_a_second(agent_ns, which):
    pattern = _patterns(agent_ns)[which]
    started = time.monotonic()
    assert pattern.findall(LONG) == []
    assert time.monotonic() - started < 1.0, which


@pytest.mark.parametrize("which", ["notebook INSPIRE_SECRET_EMAIL_RE", "shell_redact INSPIRE_SECRET_EMAIL_RE"])
def test_every_email_is_still_found_exactly_as_before(agent_ns, which):
    pattern = _patterns(agent_ns)[which]
    for text in CORPUS:
        assert pattern.findall(text) == OLD_EMAIL.findall(text), text


def test_the_draft_link_check_still_finds_the_same_emails_and_links():
    old = re.compile(r"https?://\S+|www\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+", re.I)
    pattern = _shell("shell_agent").DRAFT_LINK
    for text in CORPUS + ["see https://example.com/a?b=c or www.example.org", "mail a AT b.co or http://x.y".replace(" AT ", "@")]:
        assert pattern.findall(text) == old.findall(text), text


def test_redacting_a_long_genie_error_output_is_fast_and_still_redacts_the_token_and_email(agent_ns):
    email = "ops" + "@" + "example.com"
    text = LONG + " tok-123 " + email
    started = time.monotonic()
    said = agent_ns["inspire_redact_text"](text, set(), "", ("tok-123",))
    assert time.monotonic() - started < 3.0
    assert "tok-123" not in said and email not in said and said.endswith("<email>")
