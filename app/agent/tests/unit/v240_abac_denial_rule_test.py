import pytest

APP_PRINCIPAL = "builder@example.com"
READ_METADATA_DENIED = (f"PERMISSION_DENIED: Principal '{APP_PRINCIPAL}' does not have READ METADATA on Table "
                        "'inspire_kinds.airline_e2e_rc4.pax_profile'.")
SCOPE_DENIED = "PERMISSION_DENIED: Request is missing the required OAuth scope."
UNAUTHORIZED = "Unauthorized: the token is expired"


@pytest.mark.parametrize("error, denied", [
    (READ_METADATA_DENIED, True),
    (SCOPE_DENIED, False),
    (UNAUTHORIZED, False),
    ("NOT AUTHORIZED: upstream gateway refused the call", False),
])
def test_only_a_privilege_denial_is_a_policy_denial(agent_ns, error, denied):
    assert agent_ns["implement_abac_denied"](RuntimeError(error)) is denied
