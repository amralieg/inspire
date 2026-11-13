from v231_app_access_test import TABLE, Rights, access, access_shell

VIEWER = "ana@example.com"
USER = {"auth": "user"}
RECORDED = [f"GRANT SELECT ON TABLE `main`.`pricing`.`items` TO `{VIEWER}`"]


class Viewer(Rights):
    def call(self, method, path, body=None):
        return {"userName": VIEWER}


def test_a_user_app_names_the_signed_in_viewer_in_the_grant_it_shows(tmp_path):
    s, _sp, person, _made = access_shell(tmp_path, settings=dict(USER, unread={TABLE: RECORDED}), person=Viewer(can_grant=True))
    status, out = access(s, "diagnose")
    assert status == 200, out
    assert out["tables"] and out["tables"][0]["table"] == TABLE
    grants = out["tables"][0]["grants"]
    assert grants and all(f"TO `{VIEWER}`" in g for g in grants), grants
    assert person.grants() == [], "diagnosing never grants"


def test_a_user_app_viewer_name_must_be_a_plain_principal(tmp_path):
    class Odd(Rights):
        def call(self, method, path, body=None):
            return {"userName": "x' OR '1'='1"}

    s, _sp, _person, _made = access_shell(tmp_path, settings=dict(USER, unread={TABLE: RECORDED}), person=Odd(can_grant=True))
    status, out = access(s, "diagnose")
    assert status == 200, out
    assert all("OR" not in g for t in out["tables"] for g in t["grants"]), out
    assert out["can_grant"] is False, out


def test_viewer_name_is_empty_when_the_identity_call_fails(tmp_path):
    class Broken(Rights):
        def call(self, method, path, body=None):
            raise ValueError("no identity")

    s, _sp, person, _made = access_shell(tmp_path, settings=dict(USER, unread={TABLE: RECORDED}), person=Broken(can_grant=True))
    assert s.viewer_name(person) == ""
    assert s.viewer_name(Viewer(can_grant=True)) == VIEWER
