import ast
import datetime
import json
import types

import pytest

from _agentload import agent_source
from v120_artifacts_support import FakeSpark
from v140_implement_test import _app_flow, _app_shell, _churn_page, _inspire
from v141_app_shell_test import FakeWorkspace

SHELL_LOADERS = ("_implement_app_shell", "implement_app_shell_modules")
SHELL_ENTRY_POINTS = {
    ("_implement_alert.build", "_implement_app_shell"),
    ("_implement_alert_subscribers", "_implement_app_shell"),
    ("_implement_alert_subscribers", "shell_alerts.workspace_user"),
    ("_implement_alert_upsert", "_implement_app_shell"),
    ("_implement_alert_upsert", "shell_alerts.alert_body"),
    ("_implement_app", "_implement_app_shell"),
    ("_implement_app_alerts_reread", "_implement_app_shell"),
    ("_implement_app_alerts_reread", "shell_alerts.read_meta"),
    ("_implement_app_alerts_reread", "shell_alerts.write_meta"),
    ("_implement_app_alerts_reread", "shell_sql.watch_query"),
    ("_implement_app_block_files", "_implement_app_shell"),
    ("_implement_app_block_files", "shell_sql.image_blocks"),
    ("_implement_app_block_images", "_implement_app_shell"),
    ("_implement_app_check", "shell_core.Shell"),
    ("_implement_app_check", "shell_core.HttpError"),
    ("_implement_app_check", "shell_core.Shell.checked"),
    ("_implement_app_check", "shell_core.Shell.close"),
    ("_implement_app_check", "shell_core.Shell.speed"),
    ("_implement_app_check", "shell_db.QueryError"),
    ("_implement_app_check", "shell_db.Workspace"),
    ("_implement_app_check", "shell_pg.Lakebase"),
    ("_implement_app_host", "shell_core.settings_problems"),
    ("_implement_app_lakebase", "shell_pg.Lakebase"),
    ("_implement_app_lakebase", "shell_pg.Lakebase.sync_now"),
    ("_implement_app_lakebase", "shell_pg.page_tables"),
    ("_implement_app_locked", "_implement_app_shell"),
    ("_implement_app_owner_record", "_implement_app_shell"),
    ("_implement_app_owner_record", "shell_core.settings_problems"),
    ("_implement_app_repoint_check", "shell_core.page_genie"),
    ("_implement_app_shell", "implement_app_shell_modules"),
    ("_implement_app_tour", "_implement_app_shell"),
    ("_implement_app_tour", "shell_core.fit_tour"),
    ("_implement_app_tour", "shell_core.tour_anchors"),
    ("_implement_app_tour", "shell_core.tour_registry"),
    ("_implement_dashboard", "_implement_app_shell"),
    ("_implement_dashboard.deploy", "shell_sql.chart_date_problems"),
    ("_implement_dashboard.deploy", "shell_sql.chart_query"),
    ("_implement_dashboard_block_images", "_implement_app_shell"),
    ("_implement_dashboard_block_images", "shell_sql.image_blocks"),
    ("_implement_digest", "_implement_app_shell"),
    ("_implement_digest", "shell_sql.change_fields"),
    ("_implement_digest", "shell_sql.digest_query"),
    ("_implement_digest", "shell_sql.impact_of"),
    ("_implement_digest", "shell_sql.money_model"),
    ("_implement_held_fact", "_implement_app_shell"),
    ("_implement_history_layout", "shell_sql.history_layout"),
    ("_implement_keep_untargeted", "_implement_app_shell"),
    ("_implement_lakebase_service", "_implement_app_shell"),
    ("_implement_lakebase_service", "shell_db.Workspace"),
    ("_implement_output_vibe_items", "_implement_app_shell"),
    ("_implement_page_images", "shell_sql.image_blocks"),
    ("_implement_page_spec", "_implement_app_shell"),
    ("_implement_runbook_guide", "_implement_app_shell"),
    ("_implement_runbook_guide", "shell_alerts.use_case_guide"),
    ("_implement_take_out_app", "_implement_app_shell"),
    ("_implement_take_out_app", "shell_core.settings_problems"),
    ("_implement_vibe_chart_types", "_implement_app_shell"),
    ("implement_alert_query", "shell_sql.alert_query"),
    ("implement_alert_query", "shell_sql.records_sql"),
    ("implement_alert_query", "shell_sql.scope_line_sql"),
    ("implement_alert_query", "shell_sql.threshold_setting_sql"),
    ("implement_alert_texts", "shell_alerts.cut_text"),
    ("implement_alert_texts", "shell_alerts.runbook"),
    ("implement_alert_texts", "shell_alerts.runbook_rows_step"),
    ("implement_alert_texts", "shell_alerts.use_case_guide"),
    ("implement_app_kept_backend", "shell_pg.page_tables"),
    ("implement_app_kept_backend", "shell_pg.uc_key"),
    ("implement_app_page_problems", "shell_sql.quality_problems"),
    ("implement_put_back_checked", "shell_sql.quality_problems"),
    ("implement_put_back_checked", "shell_sql.spec_problems"),
    ("implement_app_page_problems", "shell_sql.spec_problems"),
    ("_implement_dashboard_listed", "shell_sql.decision_problems"),
    ("implement_app_page_problems", "shell_sql.decision_problems"),
    ("implement_layout_brief", "shell_sql.layouts"),
    ("implement_layout_brief", "shell_sql.section_words"),
    ("implement_layout_brief", "shell_sql.layout_sections"),
    ("implement_unasked_part_problems", "shell_sql.asked_section_items"),
    ("implement_unasked_part_problems", "shell_sql.unasked_part_problem"),
    ("implement_drop_misfits", "shell_sql.asked_section_items"),
    ("implement_drop_misfits", "shell_sql.item_sections"),
    ("implement_drop_misfits", "shell_sql.page_layout"),
    ("implement_layout_brief", "shell_sql.layouts"),
    ("implement_layout_brief", "shell_sql.section_words"),
    ("implement_block_images", "shell_sql.image_blocks"),
    ("_implement_page_file", "shell_sql.shape_problems"),
    ("_implement_page_file.page_problems", "shell_sql.rule_problems"),
    ("_implement_page_file", "shell_sql.place_items"),
    ("_implement_page_file", "shell_sql.inspire_part_problems"),
    ("_implement_app_prompt", "shell_sql.layout_chart_least"),
    ("_implement_holder_filters", "shell_sql.list_column_filters"),
    ("_implement_holder_filters", "shell_sql.table_column_filters"),
    ("implement_column_filter_gate", "shell_sql.list_column_filters"),
    ("implement_column_filter_gate", "shell_sql.list_shown"),
    ("_implement_vibes_sort_text", "shell_sql.list_shown"),
    ("implement_column_filter_gate", "shell_sql.table_column_filters"),
    ("implement_column_filter_gate", "shell_sql.table_shown"),
    ("implement_dashboard_dataset_sql", "shell_sql.clean_sql"),
    ("implement_dashboard_dataset_sql", "shell_sql.quote"),
    ("implement_dashboard_part_sql", "shell_sql.quote"),
    ("implement_dashboard_filter_condition", "shell_sql.quote"),
    ("implement_dashboard_filter_targets", "shell_sql.filter_value_datasets"),
    ("implement_dashboard_from_page", "shell_sql.block_plan"),
    ("implement_dashboard_from_page", "shell_sql.change_text_sql"),
    ("implement_dashboard_from_page", "shell_sql.driver_charts"),
    ("implement_dashboard_from_page", "shell_sql.drivers_section"),
    ("implement_dashboard_from_page", "shell_sql.previous_run_measure"),
    ("implement_dashboard_from_page", "shell_sql.reading_guide"),
    ("implement_dashboard_from_page", "shell_sql.run_measure"),
    ("_implement_dashboard_trend", "shell_sql.quote"),
    ("_implement_dashboard_trend", "shell_sql.reading_guide"),
    ("implement_dashboard_history", "shell_sql.page_scopes"),
    ("implement_dashboard_history", "shell_sql.quote"),
    ("implement_dashboard_history", "shell_sql.reads_table"),
    ("implement_dashboard_history", "shell_sql.reasons_sql"),
    ("implement_dashboard_history", "shell_sql.runs_compare_sql"),
    ("implement_dashboard_history", "shell_sql.table_name"),
    ("implement_dashboard_history", "shell_sql.trend_sql"),
    ("implement_lakebase_choice_columns", "shell_sql.list_column_filters"),
    ("implement_lakebase_choice_columns", "shell_sql.table_column_filters"),
    ("implement_lakebase_copies", "shell_sql.previous_rows"),
    ("implement_dashboard_from_page", "shell_sql.run_status_query"),
    ("implement_dashboard_from_page", "shell_sql.page_scopes"),
    ("implement_dashboard_run_health_sql", "shell_sql.table_name"),
    ("implement_dashboard_run_health_sql", "shell_sql.versions_source"),
    ("implement_digest_body", "shell_alerts.alert_body"),
    ("implement_digest_body", "shell_alerts.alert_subscriptions"),
    ("implement_digest_body", "shell_sql.impact_of"),
    ("implement_digest_body", "shell_sql.stake_noun"),
    ("implement_digest_body", "shell_sql.stake_words"),
    ("implement_driver_problems", "shell_sql.driver_charts"),
    ("implement_layout_brief", "shell_sql.layout_decides"),
}
PURE_ENTRY_POINTS = {
    "shell_sql.impact_of": ("reads the impact kind, the unit and the currency the run's summary row names into one impact for the "
                            "weekly digest query and email; it reads no rows and builds no error text, so it needs no redaction"),
    "shell_sql.threshold_setting_sql": ("builds the alert's threshold SQL from the result table name, the use case id and the threshold "
                                        "the person chose; it reads no rows and builds no error text, so it needs no redaction"),
    "shell_sql.stake_words": ("turns that impact into the words '<unit> at stake' of the digest lines; it reads no rows and builds no "
                              "error text, so it needs no redaction"),
    "shell_sql.layout_decides": ("reads whether a layout of the kinds registry is informational, for the build brief; it reads no rows "
                                 "and builds no error text, so it needs no redaction"),
    "shell_sql.stake_noun": ("turns that impact into the unit word of the digest lines; it reads no rows and builds no error text, so "
                             "it needs no redaction"),
}
SHELL_READS = {"run_sql", "run", "execute", "cursor", "connect", "fetchall", "fetchone", "fetchmany", "Workspace", "Lakebase", "urlopen"}
FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)


class _ShellFlow:
    def __init__(self, tree, modules, files):
        self.modules = tuple(modules)
        self.members, self.classes = {}, {}
        bodies = {module: ast.parse(files[f"{module}.py"]).body for module in self.modules}
        for module, body in bodies.items():
            self.members[module] = {n.name for n in body if isinstance(n, (*FUNCTIONS, ast.ClassDef))}
            self.classes[module] = {n.name for n in body if isinstance(n, ast.ClassDef)}
        for module, body in bodies.items():
            for node in body:
                if isinstance(node, ast.ImportFrom) and node.module in bodies:
                    for alias in node.names:
                        if alias.name in self.members[node.module]:
                            self.members[module].add(alias.asname or alias.name)
                        if alias.name in self.classes[node.module]:
                            self.classes[module].add(alias.asname or alias.name)
        self.parent = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
        self.functions = [n for n in ast.walk(tree) if isinstance(n, FUNCTIONS)]
        self.by_name = {}
        for function in self.functions:
            self.by_name.setdefault(function.name, []).append(function)
        self.nodes = {id(f): [] for f in self.functions}
        self.loose = []
        for node in ast.walk(tree):
            scope = self.scope(node)
            if scope is not None:
                self.nodes[id(scope)].append(node)
            elif self.shell_key(node):
                self.loose.append(("<module>", ast.unparse(node)[:80]))
        self.bound = {}
        self.flow()

    def scope(self, node):
        current = self.parent.get(node)
        while current is not None and not isinstance(current, FUNCTIONS):
            current = self.parent.get(current)
        return current

    def qualname(self, function):
        names, current = [function.name], self.scope(function)
        while current is not None:
            names.append(current.name)
            current = self.scope(current)
        return ".".join(reversed(names))

    def shell_key(self, node):
        if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant) and node.slice.value in self.modules:
            return node.slice.value
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get" and node.args \
                and isinstance(node.args[0], ast.Constant) and node.args[0].value in self.modules:
            return node.args[0].value
        return None

    def kind(self, node, scope):
        key = self.shell_key(node)
        if key:
            return ("module", key)
        if isinstance(node, ast.Name):
            while scope is not None:
                if (id(scope), node.id) in self.bound:
                    return self.bound[(id(scope), node.id)]
                scope = self.scope(scope)
            return None
        if isinstance(node, ast.Call):
            made = self.kind(node.func, scope)
            if made and made[0] == "member" and made[2] in self.classes[made[1]]:
                return ("object", made[1], made[2])
        if isinstance(node, ast.Attribute):
            base = self.kind(node.value, scope)
            if base and base[0] == "module":
                return ("member", base[1], node.attr)
            if base and base[0] == "object":
                return ("attribute", base[1], f"{base[2]}.{node.attr}")
        return None

    def bind(self, scope, name, found):
        if found and found[0] in ("module", "object") and self.bound.get((id(scope), name)) != found:
            self.bound[(id(scope), name)] = found
            return True
        return False

    def flow(self):
        changed = True
        while changed:
            changed = False
            for function in self.functions:
                for node in self.nodes[id(function)]:
                    if isinstance(node, ast.Assign):
                        for target in node.targets:
                            pairs = (zip(target.elts, node.value.elts) if isinstance(target, ast.Tuple)
                                     and isinstance(node.value, ast.Tuple) else [(target, node.value)])
                            for name, value in pairs:
                                if isinstance(name, ast.Name):
                                    changed |= self.bind(function, name.id, self.kind(value, function))
                    elif isinstance(node, ast.Call):
                        callee = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", None)
                        for target in self.by_name.get(callee, []):
                            params = [a.arg for a in target.args.args]
                            skip = 1 if params[:1] == ["self"] and isinstance(node.func, ast.Attribute) else 0
                            given = [(params[i + skip], a) for i, a in enumerate(node.args) if i + skip < len(params)]
                            given += [(k.arg, k.value) for k in node.keywords if k.arg in params]
                            for name, value in given:
                                changed |= self.bind(target, name, self.kind(value, function))

    def entries(self):
        found = set()
        for function in self.functions:
            name = self.qualname(function)
            for node in self.nodes[id(function)]:
                if isinstance(node, ast.Attribute):
                    reached = self.kind(node, function)
                    if reached and reached[0] == "member" and reached[2] in self.members[reached[1]]:
                        found.add((name, f"{reached[1]}.{reached[2]}"))
                    elif reached and reached[0] == "attribute":
                        found.add((name, f"{reached[1]}.{reached[2]}"))
                if isinstance(node, ast.Call):
                    callee = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", None)
                    if callee in SHELL_LOADERS:
                        found.add((name, callee))
        return found

    def unbound_parameters(self):
        return sorted((self.qualname(f), a.arg) for f in self.functions for a in f.args.args
                      if a.arg in self.modules and (id(f), a.arg) not in self.bound)

    def dynamic_access(self):
        return sorted(ast.unparse(n)[:100] for f in self.functions for n in self.nodes[id(f)]
                      if isinstance(n, ast.Call) and getattr(n.func, "id", None) in ("getattr", "vars") and n.args
                      and self.kind(n.args[0], f))


def _flow(agent_ns, source):
    payload = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))
    return _ShellFlow(ast.parse(source), agent_ns["IMPLEMENT_APP_SHELL_MODULES"], payload["files"])


@pytest.fixture(scope="module")
def shell_flow(agent_ns):
    return _flow(agent_ns, agent_source())


def test_every_place_agent_code_calls_into_the_app_shell_is_on_the_list(shell_flow):
    found = shell_flow.entries()
    assert found - SHELL_ENTRY_POINTS == set(), f"new App shell call sites to review: {sorted(found - SHELL_ENTRY_POINTS)}"
    assert SHELL_ENTRY_POINTS - found == set(), f"listed App shell call sites that no longer exist: {sorted(SHELL_ENTRY_POINTS - found)}"
    assert shell_flow.loose == [], "agent code reaches the App shell outside any function"
    assert shell_flow.unbound_parameters() == [], "a parameter is named after an App shell module but no agent call passes one"
    assert shell_flow.dynamic_access() == [], "agent code reaches into an App shell module by a computed name"


@pytest.mark.parametrize("line,entry", [
    ('        self._implement_app_shell()[1]["shell_db"].Workspace(catalog, None).run_sql("w", "SELECT 1")\n',
     ("_describe_table_columns", "shell_db.Workspace")),
    ('        core = self._implement_app_shell()[1]["shell_core"]\n        core.Shell(schema).check({})\n',
     ("_describe_table_columns", "shell_core.Shell.check")),
    ('        _describe_with_shell(self._implement_app_shell()[1]["shell_sql"])\n',
     ("_describe_with_shell", "shell_sql.spec_problems")),
    ('        self._implement_app_shell()[1]["shell_sql"].quote(table)\n',
     ("_describe_table_columns", "shell_sql.quote")),
])
def test_a_new_call_into_the_app_shell_is_caught(agent_ns, line, entry):
    anchor = "    def _describe_table_columns(self, catalog, schema, table):\n"
    source = agent_source()
    assert source.count(anchor) == 1
    helper = "def _describe_with_shell(shell_sql):\n    return shell_sql.spec_problems({})\n\n\n"
    injected = source.replace(anchor, anchor + line)
    if "_describe_with_shell" in line:
        injected = helper + injected
    found = _flow(agent_ns, injected).entries()
    assert entry in found - SHELL_ENTRY_POINTS, sorted(found - SHELL_ENTRY_POINTS)


def test_a_shell_module_reached_by_a_computed_name_is_caught(agent_ns):
    anchor = "    def _describe_table_columns(self, catalog, schema, table):\n"
    injected = agent_source().replace(anchor, anchor + '        getattr(self._implement_app_shell()[1]["shell_db"], table)\n')
    assert _flow(agent_ns, injected).dynamic_access() == ['getattr(self._implement_app_shell()[1][\'shell_db\'], table)']


def _shell_readers(source):
    defs = {n.name: n for n in ast.parse(source).body if isinstance(n, FUNCTIONS)}
    graph = {name: {c.func.attr if isinstance(c.func, ast.Attribute) else c.func.id if isinstance(c.func, ast.Name) else ""
                    for c in ast.walk(fn) if isinstance(c, ast.Call)} for name, fn in defs.items()}
    readers = {name for name, called in graph.items() if called & SHELL_READS}
    while True:
        more = {name for name, called in graph.items() if name not in readers and called & readers}
        if not more:
            return readers, defs
        readers |= more


def _shell_sql(agent_ns):
    return agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))["files"]["shell_sql.py"]


def test_the_shell_calls_reviewed_as_pure_read_no_rows_and_build_no_error_text(agent_ns):
    readers, defs = _shell_readers(_shell_sql(agent_ns))
    listed = {target for _caller, target in SHELL_ENTRY_POINTS}
    for entry, reason in PURE_ENTRY_POINTS.items():
        name = entry.split(".", 1)[1]
        assert entry in listed and reason, entry
        assert name not in readers, f"{entry} now reads rows, so this no longer holds: {reason}"
        assert not [n for n in ast.walk(defs[name]) if isinstance(n, (ast.Try, ast.Raise))], f"{entry} now builds error text"


def test_a_reviewed_pure_call_that_starts_reading_rows_is_caught(agent_ns):
    source = _shell_sql(agent_ns)
    anchor = "def stake_label(impact) -> str:\n"
    assert source.count(anchor) == 1
    readers, _defs = _shell_readers(source.replace(anchor, anchor + "    Workspace(None, None).run_sql('w', 'SELECT 1', [])\n"))
    assert "stake_label" in readers


class _Sentinels:
    def __init__(self):
        self.tokens, self.count = [], 0

    def next(self, value):
        self.count += 1
        if isinstance(value, bool) or value is None:
            return value
        if isinstance(value, int):
            made = 900000 + self.count
        elif isinstance(value, float):
            made = 70000.125 + self.count
        elif isinstance(value, str) and len(value) >= 10 and value[4] == "-" and value[7] == "-":
            made = (datetime.date(1911, 1, 1) + datetime.timedelta(days=self.count)).isoformat()
        else:
            made = f"ZQV{self.count:05d}QZ"
        self.tokens.append(str(made))
        return made

    def found_in(self, texts):
        joined = "\n".join(texts)
        return sorted({token for token in self.tokens if token in joined})


class _SentinelWorkspace(FakeWorkspace):
    def __init__(self, sentinels, query_error):
        super().__init__()
        self.sentinels, self.query_error, self.paths, self.start = sentinels, query_error, set(), len(sentinels.tokens)

    def _rows(self, result):
        rows = [{name: (value if name == "period" else self.sentinels.next(value)) for name, value in row.items()}
                for row in result.get("rows") or []]
        return dict(result, rows=rows)

    def run_sql(self, warehouse, sql, params, limit=5000):
        if "CAST(`region` AS STRING) AS v" in sql and sql.startswith("SELECT v FROM"):
            self.paths.add("single option")
            return self._rows({"columns": [], "rows": [{"v": "Books"}], "truncated": False})
        if "GROUP BY `category` ORDER BY 2 DESC" in sql:
            self.paths.add("flat measure")
            value = self.sentinels.next(5.5)
            return {"columns": [], "rows": [{"x": self.sentinels.next("a"), "y0": value}, {"x": self.sentinels.next("b"), "y0": value}],
                    "truncated": False}
        if "SUM(y0) OVER ()" in sql:
            self.paths.add("failing chart")
            raise self.query_error(f"[CAST_INVALID_INPUT] The value '{self.sentinels.next('x')}' of the type \"STRING\" cannot be cast to "
                                   "\"DOUBLE\" because it is malformed. SQLSTATE: 22018")
        if "NULLIF(SUM(revenue), 0) * 100 AS value" in sql:
            self.paths.add("KPI query error")
            raise self.query_error(f"[DIVIDE_BY_ZERO] Division by zero for revenue '{self.sentinels.next('x')}'. SQLSTATE: 22012")
        if "COUNT(*) AS value" in sql and "'now' AS period" in sql:
            self.paths.add("KPI value error")
            raise ValueError(f"could not convert string to float: '{self.sentinels.next('x')}'")
        if "CAST(`channel` AS STRING) AS s" in sql:
            self.paths.add("error naming a value already read")
            seen = next(t for t in self.sentinels.tokens[self.start:] if t.startswith("ZQV"))
            raise self.query_error(f"[INVALID_PARAMETER_VALUE] the series value {seen} is not allowed here")
        return self._rows(super().run_sql(warehouse, sql, params, limit))


PATHS = {"single option", "flat measure", "failing chart", "KPI query error", "KPI value error", "error naming a value already read"}


def _app_files(agent_ns, tmp_path):
    payload, modules = _app_shell(agent_ns, tmp_path)
    core = modules["shell_core"]
    page = agent_ns["implement_app_page"](_churn_page(agent_ns), "N01-U01", {})
    settings = agent_ns["implement_app_settings"](core.SETTINGS_VERSION, "N01-U01 Predict churn", [page["id"]], None, "off", "t",
                                                  {"app_access": "sp"})
    return payload, modules, agent_ns["implement_app_source"](payload["files"], core.SETTINGS_FILE, core.PAGES_DIR, settings, [page])


def _sentinel_db(modules, sentinels, made):
    error = modules["shell_db"].QueryError
    return types.SimpleNamespace(Workspace=lambda host, auth: made.append(_SentinelWorkspace(sentinels, error)) or made[-1],
                                 QueryError=error)


def _with_workspace(inst):
    inst.w_client = types.SimpleNamespace(config=types.SimpleNamespace(host="https://h/", authenticate=lambda: {"Authorization": "x"}))
    return inst


def test_no_row_value_leaves_the_app_check_in_its_problems(agent_ns, tmp_path):
    _payload, modules, files = _app_files(agent_ns, tmp_path)
    sentinels, made = _Sentinels(), []
    inst = _with_workspace(_inspire(agent_ns, FakeSpark()))
    work = tmp_path / "work"
    work.mkdir()
    problems = inst._implement_app_check(str(work), files, dict(modules, shell_db=_sentinel_db(modules, sentinels, made)), "wh1")
    assert made and made[0].paths == PATHS, made[0].paths if made else "the check never asked for a workspace"
    joined = "\n".join(problems)
    for needle in ("filter", "offer one", "chart by_category gives every group the same Loss", "pareto failed: [CAST_INVALID_INPUT]",
                   "loss_rate failed: [DIVIDE_BY_ZERO]", "items failed: could not convert string to float",
                   "channel_mix failed: [INVALID_PARAMETER_VALUE] the series value"):
        assert needle in joined, (needle, problems)
    assert len(sentinels.tokens) > 20, "the shell read rows on every path"
    assert sentinels.found_in(problems) == [], problems


def test_a_check_that_stops_on_a_row_value_raises_without_it(agent_ns, tmp_path):
    _payload, modules, files = _app_files(agent_ns, tmp_path)
    sentinels, made = _Sentinels(), []
    db = _sentinel_db(modules, sentinels, made)

    class Stops(_SentinelWorkspace):
        def run_sql(self, warehouse, sql, params, limit=5000):
            if "SUM(y0) OVER ()" in sql:
                raise TypeError(f"unsupported operand type for '{self.sentinels.next('x')}'")
            return super().run_sql(warehouse, sql, params, limit)

    db.Workspace = lambda host, auth: made.append(Stops(sentinels, db.QueryError)) or made[-1]
    inst = _with_workspace(_inspire(agent_ns, FakeSpark()))
    work = tmp_path / "work"
    work.mkdir()
    with pytest.raises(RuntimeError) as raised:
        inst._implement_app_check(str(work), files, dict(modules, shell_db=db), "wh1")
    text = str(raised.value)
    assert text.startswith("the App check stopped: ") and "unsupported operand type for 'a data value'" in text, text
    assert raised.value.__cause__ is None and raised.value.__suppress_context__, "the original error, which names the value, is not chained"
    assert sentinels.found_in([text]) == [], text


@pytest.mark.parametrize("stage,kind", [("start", "ValueError"), ("start", "QueryError"), ("check", "HttpError"),
                                        ("check", "QueryError")])
def test_an_error_the_shell_raises_after_reading_a_row_comes_back_without_the_row(agent_ns, tmp_path, stage, kind):
    _payload, modules, files = _app_files(agent_ns, tmp_path)
    db, secret, literal = modules["shell_db"], "ZQV88888QZ", "ZQV99999QZ"
    made = {"ValueError": ValueError, "QueryError": db.QueryError, "HttpError": lambda text: db.HttpError(500, text)}[kind]

    def stop(factory):
        factory().run_sql("wh1", "SELECT v FROM t", [], 1)
        raise made(f"the read stopped at {secret}: [CAST_INVALID_INPUT] The value '{literal}' of the type \"STRING\" cannot be cast to "
                   "\"INT\" because it is malformed. SQLSTATE: 22018")

    class Shell:
        def __init__(self, root, **kwargs):
            self.factory = kwargs["sp_factory"]
            if stage == "start":
                stop(self.factory)

        def close(self):
            return None

        def speed(self, headers):
            return {}

        def checked(self, headers):
            stop(self.factory)

    class Workspace:
        def __init__(self, host, auth):
            self.host = host

        def run_sql(self, warehouse, sql, params, limit=5000):
            return {"columns": [], "rows": [{"v": secret}]}

    core = types.SimpleNamespace(**{k: getattr(modules["shell_core"], k) for k in ("SETTINGS_FILE", "PAGES_DIR", "HttpError", "CHECK_FAILED", "CHECK_DESIGN",
                                                                                         "CHECK_SLOW", "CHECK_NOTE")}, Shell=Shell)
    inst = _with_workspace(_inspire(agent_ns, FakeSpark()))
    work = tmp_path / "work"
    work.mkdir()
    problems = inst._implement_app_check(str(work), files, dict(modules, shell_core=core,
                                                                 shell_db=types.SimpleNamespace(Workspace=Workspace, QueryError=db.QueryError)),
                                         "wh1")
    assert problems == ["the read stopped at a data value: [CAST_INVALID_INPUT] The value 'a data value' of the type \"STRING\" cannot "
                        "be cast to \"INT\" because it is malformed. SQLSTATE: 22018"], problems


class _Runner:
    def __init__(self, page):
        self.page, self.prompts = page, []

    def run(self, prompt, work, schema, label=None):
        self.prompts.append(prompt)
        with open(f"{work}/page.json", "w", encoding="utf-8") as handle:
            handle.write(json.dumps(self.page))
        return {}


def test_no_row_value_reaches_the_genie_repair_round_the_run_log_or_the_steps(agent_ns, tmp_path):
    inst, context, seen = _app_flow(agent_ns, tmp_path)
    del inst._implement_genie_loop
    del inst._implement_app_check
    payload, modules, _files = _app_files(agent_ns, tmp_path / "shell")
    sentinels, made = _Sentinels(), []
    inst._implement_app_shell = lambda: (payload, dict(modules, shell_db=_sentinel_db(modules, sentinels, made)))
    _with_workspace(inst)
    runner = _Runner(_churn_page(agent_ns))
    with pytest.raises(RuntimeError) as raised:
        inst._implement_app(context, runner)
    assert len(runner.prompts) == agent_ns["IMPLEMENT_MAX_GENIE_ROUNDS"] and made and made[0].paths == PATHS
    assert "Inspire tried to use what you wrote and it failed" in runner.prompts[1]
    assert "region (a data value) offer one" in runner.prompts[1], runner.prompts[1][-1500:]
    texts = (runner.prompts + [str(raised.value)] + [message for _level, message in inst.logger.records]
             + [json.dumps(e, default=str) for e in inst.emitted] + [repr(inst.spark.__dict__)])
    assert sentinels.found_in(texts) == []


def test_the_check_reads_lakebase_rows_through_the_same_watch(agent_ns, tmp_path):
    _payload, modules, files = _app_files(agent_ns, tmp_path)
    caught = {}

    class Shell:
        def __init__(self, root, **kwargs):
            caught.update(kwargs)

        def close(self):
            return None

        def speed(self, headers):
            return {}

        def checked(self, headers):
            reader = caught["lakebase_factory"]({"kind": "lakebase"}, {}, None)
            reader.run("SELECT 1", [], 1)
            return [(core.CHECK_FAILED, f"page n01_u01: a Lakebase read named {secret}")]

    secret = "ZQV77777QZ"

    class Lakebase:
        def __init__(self, backend, env, service):
            self.made = (backend, env, service)

        def run(self, sql, params, limit, queued=False, viewer=""):
            return {"columns": [], "rows": [{"v": secret}, {"v": "n01_u01"}]}

    core = types.SimpleNamespace(**{k: getattr(modules["shell_core"], k) for k in ("SETTINGS_FILE", "PAGES_DIR", "HttpError", "CHECK_FAILED", "CHECK_DESIGN",
                                                                                         "CHECK_SLOW", "CHECK_NOTE")}, Shell=Shell)
    inst = _with_workspace(_inspire(agent_ns, FakeSpark()))
    work = tmp_path / "work"
    work.mkdir()
    problems = inst._implement_app_check(str(work), files, dict(modules, shell_core=core, shell_pg=types.SimpleNamespace(Lakebase=Lakebase)),
                                         "wh1")
    assert problems == ["page n01_u01: a Lakebase read named a data value"]
    assert {"sp_factory", "user_factory", "lakebase_factory", "strict"} <= set(caught)


@pytest.mark.parametrize("text,seen,known,expected", [
    ("chart c gives every group the same Loss (70001.125) at the default filters", {"70001.125"}, "",
     "chart c gives every group the same Loss (a data value) at the default filters"),
    ("region (EU) offer one", {"EU"}, "", "region (a data value) offer one"),
    ("region (7) offer one", {"7"}, "", "region (a data value) offer one"),
    ("The value 'Acme Corp' of the type \"STRING\" cannot be cast to \"DECIMAL(10,2)\"", set(), "",
     "The value 'a data value' of the type \"STRING\" cannot be cast to \"DECIMAL(10,2)\""),
    ("Syntax error at or near 'FROM' in category", set(), "SELECT category FROM t",
     "Syntax error at or near 'FROM' in category"),
    ("the series value ZQV00002QZ is not allowed", {"ZQV00002QZ"}, "", "the series value a data value is not allowed"),
    ("2 segment filters offer 2 or more values", {"2"}, "", "2 segment filters offer 2 or more values"),
    ("Books failed at the default filters", {"Books"}, "Books are a title", "Books failed at the default filters"),
    ("no data here", {"data"}, "", "no data here"),
])
def test_the_watch_hides_what_came_from_the_rows_and_keeps_the_rest(agent_ns, text, seen, known, expected):
    assert agent_ns["inspire_redact_text"](text, seen, known) == expected


def test_the_watch_records_every_cell_of_every_shape(agent_ns):
    seen = set()
    result = {"columns": [], "rows": [{"a": 5.0, "b": "x y", "c": None, "d": True, "e": [1, {"f": "deep"}]}, ["tuple cell"]]}
    assert agent_ns["implement_note_rows"](result, seen) is result
    assert seen == {"5.0", "5", "x y", "1", "deep", "tuple cell"}
