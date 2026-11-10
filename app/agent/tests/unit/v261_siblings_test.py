"""The Use cases dropdown's siblings: the generator lists the other use cases of the business that have a published App, and never its own."""


def test_the_siblings_are_the_other_published_apps_of_the_business_and_never_this_use_case(agent_ns):
    rows = [
        {"use_case_id": "N05-U02", "app_name": "second-desk", "app_url": "https://second.example.com/"},
        {"use_case_id": "N04-U05", "app_name": "this-desk", "app_url": "https://this.example.com/"},
        {"use_case_id": "N06-U01", "app_name": "third-desk", "app_url": "http://insecure.example.com/"},
        {"use_case_id": "N07-U03", "app_name": "", "app_url": "https://seventh.example.com/"},
        {"use_case_id": "N05-U02", "app_name": "second-desk", "app_url": "https://second.example.com/"},
        "not a row",
    ]
    out = agent_ns["implement_siblings"](rows, "N04-U05")
    assert out == [
        {"use_case_id": "N05-U02", "name": "second-desk", "url": "https://second.example.com/"},
        {"use_case_id": "N07-U03", "name": "N07-U03", "url": "https://seventh.example.com/"},
    ]


def test_no_published_sibling_gives_an_empty_list(agent_ns):
    assert agent_ns["implement_siblings"]([], "N04-U05") == []
    assert agent_ns["implement_siblings"](None, "N04-U05") == []
