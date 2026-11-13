"""REQ-147 item 4 (option C): the stored run summary states the as-of cut-off in words, because the run reads rows strictly
before as_of_date and leaves out the rows on that day, which may be incomplete. No counts are stated."""


def test_the_cut_off_sentence_names_the_as_of_day_and_the_day_before_it_is_read(agent_ns):
    assert agent_ns["inspire_cutoff_fact"]("2024-05-17") == (
        "Reads rows dated before 2024-05-17; rows on 2024-05-17 are left out because that day may be incomplete.")
    assert agent_ns["inspire_cutoff_fact"]("2024-05-17T00:00:00") == agent_ns["inspire_cutoff_fact"]("2024-05-17")


def test_an_unreadable_as_of_date_states_no_cut_off(agent_ns):
    assert agent_ns["inspire_cutoff_fact"]("") == ""
    assert agent_ns["inspire_cutoff_fact"]("latest") == ""
    assert agent_ns["inspire_cutoff_fact"](None) == ""
