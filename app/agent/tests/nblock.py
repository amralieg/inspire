#!/usr/bin/env python3
"""Advisory lock for agent/dbx_inspire_ai_agent.ipynb in a shared working tree.

The filesystem does not enforce exclusivity between concurrent agent lanes, so this supplies
the primitive. Every path that takes the lock does so through `_create_exclusive`, so the
check and the write are one syscall and two lanes arriving together cannot both win.

Stale policy has two limbs and both must pass before a held lock is broken: the lock is older
than STALE_AGE_MIN, and the notebook md5 is unchanged across STALE_QUIET_MIN of observation.
The limbs are kept independent by construction -- `observe_stillness` takes no clock, so no
single clock fault can satisfy both. A lock whose age cannot be determined is never broken.

Breaking is the harder case, because the decision to break is made against a snapshot read up
to STALE_QUIET_MIN before the write. `_break_lock` therefore serialises breaks behind an
exclusive token and re-verifies that the lock still holds the bytes that were judged, so a
break can only ever remove the holder it evaluated and never a lane that arrived during the
probe.

The lock file is never committed.
"""
import calendar
import hashlib
import json
import os
import pathlib
import sys
import time

ISO = "%Y-%m-%dT%H:%M:%SZ"
STALE_AGE_MIN = 30
STALE_QUIET_MIN = 10
QUIET_SAMPLE_SECONDS = 30
QUIET_SAMPLES = (STALE_QUIET_MIN * 60) // QUIET_SAMPLE_SECONDS

FOREIGN_KEYS = {"holder": "agent_id", "since": "acquired_at"}


def repo_root(root=None):
    if root is not None:
        return pathlib.Path(root)
    return pathlib.Path(os.environ.get("INSPIRE_REPO")
                        or pathlib.Path(__file__).resolve().parents[1])


def lock_path(root=None):
    return repo_root(root) / ".inspire_notebook.lock"


def notebook_path(root=None):
    return repo_root(root) / "agent" / "dbx_inspire_ai_agent.ipynb"


def file_md5(path):
    return hashlib.md5(pathlib.Path(path).read_bytes()).hexdigest()


def epoch_from_iso(stamp):
    """UTC epoch for a `Z`-suffixed stamp.

    `time.mktime(...) - time.timezone` reads the struct as local time and corrects with the
    standard offset, so inside DST it lands one hour early and inflates every derived age by
    3600s. `calendar.timegm` has no local-time step and so no DST term.
    """
    return calendar.timegm(time.strptime(stamp, ISO))


def now_iso(now=time.time):
    return time.strftime(ISO, time.gmtime(now()))


def payload(agent_id, intent, root=None, now=time.time, md5_of=None):
    md5_of = md5_of or (lambda: file_md5(notebook_path(root)))
    return {
        "agent_id": agent_id,
        "pid": os.getpid(),
        "acquired_at": now_iso(now),
        "acquired_epoch": int(now()),
        "intent": intent,
        "notebook_md5_at_acquire": md5_of(),
    }


def break_token_path(root=None):
    return lock_path(root).parent / (lock_path(root).name + ".break")


def _create_exclusive(path, body):
    """Take `path` by creating it, or lose. The only way any path here takes the lock.

    O_CREAT|O_EXCL makes the existence check and the write a single syscall, so there is no
    seam for a second lane to occupy. A read-then-write shape has one, and two lanes landing
    inside it both believe they hold the lock.
    """
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except FileExistsError:
        return False
    with os.fdopen(fd, "w") as handle:
        handle.write(body)
    return True


def _token_owner_is_alive(token):
    """Whether the pid recorded in a break token still exists.

    Unreadable or unparseable content reads as alive, so a token of unknown provenance is
    never reclaimed: the cost of a false alive is a refused break, the cost of a false dead
    is two lanes breaking at once.
    """
    try:
        pid = int(token.read_text().strip())
    except Exception:
        return True
    if pid <= 0:
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return True
    return True


def _break_lock(lock, observed, body, root=None):
    """Replace a lock still holding the exact bytes that were judged stale, or refuse.

    Two properties, both required, neither supplied by a plain write:

    The break token serialises breakers. Verify-then-unlink-then-create has a window between
    the unlink and the create, and a second breaker inside it removes the winner's fresh lock
    rather than the stale one. Only one lane may hold the token, so that interleaving cannot
    occur. It is held for the duration of three syscalls, not the duration of the probe.

    The content re-check closes the probe-length gap. `observed` was read up to STALE_QUIET_MIN
    earlier; if the holder released and another lane acquired since, the bytes differ and the
    break is refused, so a break can only remove the holder it actually evaluated.
    """
    token = break_token_path(root)
    if not _create_exclusive(token, "%d\n" % os.getpid()):
        if not _token_owner_is_alive(token):
            # A lane that died between creating the token and its `finally` would otherwise
            # block every future break in this tree permanently. Liveness is decided by
            # signal 0 against the recorded pid, so this reclaim depends on no clock and
            # cannot be triggered by the age-limb fault class.
            try:
                os.unlink(token)
            except FileNotFoundError:
                pass
        if not _create_exclusive(token, "%d\n" % os.getpid()):
            return {"ok": False, "reason": "another lane is breaking this lock right now"}
    try:
        try:
            current = lock.read_text()
        except FileNotFoundError:
            current = None
        if current is not None and current != observed:
            return {"ok": False,
                    "reason": "refusing to break: the lock changed hands during the quiet "
                              "probe, so the holder judged stale is no longer the holder"}
        if current is not None:
            try:
                os.unlink(lock)
            except FileNotFoundError:
                pass
        if not _create_exclusive(lock, body):
            return {"ok": False, "reason": "refusing to break: another lane took the lock "
                                           "between the probe and the write"}
        return {"ok": True}
    finally:
        try:
            os.unlink(token)
        except FileNotFoundError:
            pass


def read_held(root=None, raw=None):
    """Parse a lock written by ANY lane, not just this one.

    Three encodings have appeared in this tree: this module's JSON, another lane's
    `holder=... pid=... since=...` line, and shapes matching neither (truncated, empty, or
    a scheme not yet seen). A reader that raises on a foreign shape goes blind on exactly the
    contention it exists to detect, so an unknown shape is reported rather than thrown.

    `raw` lets a caller parse bytes it has already read, so the decision to break and the
    verification before writing can be made against one snapshot rather than two reads.
    """
    raw = lock_path(root).read_text() if raw is None else raw
    try:
        held = json.loads(raw)
        if isinstance(held, dict):
            held.setdefault("_format", "json")
            return held
    except Exception:
        pass
    held = {"_format": "keyvalue", "_raw": raw.strip()}
    for tok in raw.split():
        if "=" in tok:
            key, value = tok.split("=", 1)
            held[FOREIGN_KEYS.get(key, key)] = value
    if len(held) == 2:
        held["_format"] = "opaque"
        return held
    if "acquired_at" in held and "acquired_epoch" not in held:
        try:
            held["acquired_epoch"] = epoch_from_iso(held["acquired_at"])
        except Exception:
            pass
    return held


def held_epoch(held):
    raw = held.get("acquired_epoch")
    if isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    try:
        return float(str(raw).strip())
    except Exception:
        return None


def observe_stillness(md5_of, samples=QUIET_SAMPLES, sample_seconds=QUIET_SAMPLE_SECONDS,
                      sleep=time.sleep):
    """Whether the notebook changed across `samples` observations, decided by md5 alone.

    Deliberately admits no clock: the verdict is md5 equality across successive reads and the
    spacing comes from `sleep`, a duration. This is what keeps the stillness limb independent
    of the age limb, which is the only clock-dependent one. Returns as soon as a change is
    seen rather than always burning the full window.
    """
    first = md5_of()
    taken = 1
    for _ in range(samples):
        sleep(sample_seconds)
        current = md5_of()
        taken += 1
        if current != first:
            return {"still": False, "first": first, "changed_to": current,
                    "samples_taken": taken, "observed_seconds": (taken - 1) * sample_seconds}
    return {"still": True, "first": first, "changed_to": None, "samples_taken": taken,
            "observed_seconds": samples * sample_seconds}


def acquire(agent_id, intent, allow_break=True, root=None, now=time.time, sleep=time.sleep,
            md5_of=None, samples=QUIET_SAMPLES, sample_seconds=QUIET_SAMPLE_SECONDS):
    md5_of = md5_of or (lambda: file_md5(notebook_path(root)))
    lock = lock_path(root)
    body = json.dumps(payload(agent_id, intent, root=root, now=now, md5_of=md5_of),
                      indent=1) + "\n"
    observed = None
    for attempt in (1, 2):
        if _create_exclusive(lock, body):
            return {"result": "ACQUIRED", "lock": json.loads(body)}
        try:
            observed = lock.read_text()
            break
        except FileNotFoundError:
            # Released between the create attempt and the read. One retry takes it cleanly;
            # a second miss means a lane is cycling the lock, which is not ours to resolve.
            if attempt == 2:
                return {"result": "BLOCKED",
                        "reason": "lock appeared and vanished across two attempts -- another "
                                  "lane is cycling it"}

    try:
        held = read_held(root, raw=observed)
    except Exception as exc:
        return {"result": "BLOCKED", "reason": "lock unreadable: %s" % exc}

    if not allow_break:
        return {"result": "BLOCKED", "reason": "breaking not permitted by caller", "held": held}

    epoch = held_epoch(held)
    if epoch is None:
        return {
            "result": "BLOCKED",
            "reason": "age undeterminable from a %s lock -- an unreadable timestamp is not "
                      "evidence of staleness" % held.get("_format", "unknown"),
            "held": held,
        }

    age_min = (now() - epoch) / 60.0
    if age_min < STALE_AGE_MIN:
        return {
            "result": "BLOCKED",
            "reason": "held by %s for %.1f min (< %d min stale threshold)"
                      % (held.get("agent_id"), age_min, STALE_AGE_MIN),
            "held": held,
        }

    quiet = observe_stillness(md5_of, samples=samples, sample_seconds=sample_seconds, sleep=sleep)
    if not quiet["still"]:
        return {
            "result": "BLOCKED",
            "reason": "lock is %.1f min old but notebook mutated after %d s of the %d s quiet "
                      "probe -- refusing to break an active writer"
                      % (age_min, quiet["observed_seconds"], samples * sample_seconds),
            "held": held,
            "quiet": quiet,
        }

    fresh = json.dumps(payload(agent_id, intent, root=root, now=now, md5_of=md5_of),
                       indent=1) + "\n"
    broke = _break_lock(lock, observed, fresh, root=root)
    if not broke["ok"]:
        return {"result": "BLOCKED", "reason": broke["reason"], "held": held, "quiet": quiet}

    reason = ("broke stale lock: age %.1f min >= %d, notebook md5 unchanged (%s) across %d "
              "observations spanning %d s"
              % (age_min, STALE_AGE_MIN, quiet["first"], quiet["samples_taken"],
                 quiet["observed_seconds"]))
    return {"result": "BROKEN_THEN_ACQUIRED", "reason": reason, "prior_holder": held,
            "quiet": quiet}


def release(agent_id, root=None):
    """Give up this lane's lock. Never removes another lane's, and never raises on a race.

    `exists()` then `read_text()` is the same check-then-act shape as the acquire race: the
    lock can vanish in between, so the read is the check.
    """
    lock = lock_path(root)
    try:
        held = read_held(root)
    except FileNotFoundError:
        return {"result": "NOOP", "reason": "no lock present"}
    if held.get("agent_id") != agent_id:
        return {"result": "REFUSED", "reason": "lock held by another agent", "held": held}
    try:
        lock.unlink()
    except FileNotFoundError:
        return {"result": "NOOP", "reason": "lock already gone"}
    return {"result": "RELEASED", "was": held}


def status(root=None):
    md5 = file_md5(notebook_path(root))
    try:
        held = read_held(root)
    except FileNotFoundError:
        return {"result": "FREE", "notebook_md5": md5}
    return {"result": "HELD", "held": held, "notebook_md5": md5}


OK_RESULTS = ("ACQUIRED", "BROKEN_THEN_ACQUIRED", "RELEASED", "FREE", "HELD", "NOOP")


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "status"
    if cmd == "acquire":
        out = acquire(argv[2], argv[3])
    elif cmd == "release":
        out = release(argv[2])
    else:
        out = status()
    print(json.dumps(out, indent=1))
    return 0 if out["result"] in OK_RESULTS else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
