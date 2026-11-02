import logging


def _no_information_schema(*a, **kw):
    raise RuntimeError("no information_schema offline")


def test_two_pass_empty_schema_is_not_reported_as_failed(fresh_ns):
    fresh_ns["_metadata_rows"] = _no_information_schema
    dl = fresh_ns["DataLoader"]("", "", "", logging.getLogger("v161_empty_schema"), enable_two_pass=True,
                                enable_column_sampling=False, max_parallelism=4)
    tables = {("cat", "empty"): [], ("cat", "full"): ["t1", "t2"]}
    dl.database_queue = sorted(tables)
    dl.explicit_schemas_set = set(tables)
    dl._fetch_tables_for_schema = lambda cat, sch, limit=None, offset=0: [f"{cat}.{sch}.`{t}`" for t in tables[(cat, sch)]]
    info = fresh_ns["TableSizeInfo"]
    dl.size_analyzer.analyze_table_sizes_batch = lambda chunk, caps, max_parallelism=20: [
        info(c, s, t, num_columns=5, size_category="small") for c, s, t in chunk]
    dl._initialize_all_tables()
    assert dl.metadata_unavailable == {}
    assert dl.all_table_tuples == [("cat", "full", "t1"), ("cat", "full", "t2")]
