import ast
import re
import time
import types

import pytest

from _agentload import agent_source
from v120_metadata_only_guard_test import runtime_sources
from v169_one_redaction_test import pasted_sources

SINKS = {"inspire_redact_text", "redact_error", "inspire_redact_secrets", "_implement_redacted", "error_text"}
UPPER = re.compile(r"^[A-Z_][A-Z0-9_]*$")
BUILTIN_SAFE = {"len", "sorted", "list", "set", "tuple", "sum", "min", "max", "round", "abs", "int", "repr", "str", "join", "chr",
                "type", "bool", "float", "any", "all", "frozenset", "dict"}
WRAPPERS = {"inspire_plural", "inspire_rebuild_action", "implement_and_list"}
SENTINEL = "ZQV9101QZ"
TOKEN = "dapi" + "cd" * 16
HOST = "adb-zqv.example.net"
OUTSIDE = (f"[CAST_INVALID_INPUT] The value '{SENTINEL}' of the type \"STRING\" cannot be cast to \"INT\" because it is malformed. "
           f"SQLSTATE: 22018 at https://{HOST}/api with {TOKEN}")
ANCHOR = "def implement_image_source(url: str, shell_sql) -> tuple:\n"
CATEGORIES = {
    "count": "a count, size, limit, index, duration or version number Inspire computed",
    "type": "the class name of an object, never its value",
    "state": "a platform state or status code, an enum word and never free text",
    "config": "a key, value or choice of Inspire's own runtime, model or registry configuration",
    "person": "what the person typed in a widget, a strategy file, a KPI filter or an image link, shown back so they can fix it",
    "name": "a name, id, label, path, question or endpoint Inspire computed or read from Unity Catalog metadata",
    "composed": "text Inspire composed upstream, where any outside part already went through the one redaction",
    "genie": "a repair note Inspire sends back to Genie, quoting what Genie built; people see the other message of the raise",
}
REVIEWED = {
    'count': {
        ('_call_ai_query_impl', '_attempt_timeout'),
        ('_call_ai_query_impl', '_target_split_limit'),
        ('_call_ai_query_impl', 'best_limit'),
        ('_call_ai_query_impl', 'effective_limit'),
        ('_call_ai_query_impl', 'estimated_tokens'),
        ('_call_ai_query_impl', 'input_token_limit_val'),
        ('_call_ai_query_impl', 'len(model_cascade)'),
        ('_call_ai_query_impl', 'len(prompt)'),
        ('_call_ai_query_impl', 'prompt_len'),
        ('_implement_alert_check_run', 'timeout_s'),
        ('_implement_app_deployment', 'timeout_s'),
        ('_implement_app_settled', 'minutes'),
        ('_implement_deploy_app', 'timeout_s'),
        ('_implement_genie_loop', 'rounds'),
        ('_implement_genie_smoke', 'timeout_s'),
        ('_implement_one_locked', "previous['spec_version']"),
        ('_implement_refresh_run_controls', 'len(found)'),
        ('_migrate_tracking_table_schema', 'len(failed)'),
        ('_ensure_implement_table', 'len(refused)'),
        ('_parse_dedup_response', 'len(lost)'),
        ('_parse_translation_csv', 'len(missing_ids)'),
        ('_parse_translation_csv', 'missing_ids'),
        ('_parse_translation_rows', 'len(csv_response)'),
        ('_process_batch_with_retry', 'estimated_prompt_size'),
        ('_process_batch_with_retry', 'safe_limit'),
        ('_process_filter_batch_recursive', 'len(csv_rows)'),
        ('_read', 'self.budget_seconds'),
        ('_read', 'self.signal_budget_seconds'),
        ('_regenerate_genie_for_flagged_rows', 'total'),
        ('_run_tagged_spark_work', 'elapsed'),
        ('_run_tagged_spark_work', 'timeout_seconds'),
        ('_safe_future_result', 'timeout'),
        ('_validate_model_config', 'idx'),
        ('_validate_runtime_config', '_idx'),
        ('_validate_runtime_config', '_weight'),
        ('_validate_runtime_config', 'hi'),
        ('_validate_runtime_config', 'lo'),
        ('_validate_runtime_config', 'sum(_weights.values())'),
        ('_with_metadata_retries', 'attempts'),
        ('assert_no_blocking', 'len(blocking)'),
        ('build', 'len(rows)'),
        ('execute_with_timeout', 'timeout_seconds'),
        ('parse_strategic_context', 'depth'),
        ('parse_strategic_context', 'json_error.colno'),
        ('parse_strategic_context', 'json_error.lineno'),
        ('parse_strategic_context', 'len(levels)'),
        ('safe_as_completed', 'len(remaining)'),
        ('safe_as_completed', 'timeout'),
    },
    'type': {
        ('_validate_runtime_config', 'type(_entry).__name__'),
        ('_validate_runtime_config', 'type(_rt[key]).__name__'),
        ('_validate_runtime_config', 'type(val).__name__'),
    },
    'state': {
        ('_implement_alert_check_run', 'state'),
        ('_implement_alert_check_run', "waited.get('status')"),
        ('_implement_app_deployment', 'state'),
        ('_implement_app_health', 'active'),
        ('_implement_app_health', 'code'),
        ('_implement_app_health', 'state'),
        ('_implement_app_lakebase', 'state.lower()'),
        ('_implement_app_settled', 'state.lower()'),
        ('_implement_deploy_app', 'state'),
        ('_implement_genie_loop', "result.get('exit')"),
        ('_implement_genie_smoke', 'status'),
        ('_implement_lakebase_project', 'deleted'),
        ('_implement_lakebase_project', 'until'),
        ('_implement_lakebase_source', 'synced'),
        ('_implement_lakebase_synced', "copy['synced']"),
        ('_with_metadata_retries', 'kind'),
        ('build', 'kind'),
        ('online', 'state'),
    },
    'config': {
        ('_download_cli', 'version'),
        ('app_files', 'version'),
        ('entry', 'version'),
        ('python', 'version'),
        ('_gate_family_sets', 'stray'),
        ('_gate_family_sets', 'unknown'),
        ('_load_and_format_prompt', 'prompt_key'),
        ('_validate_model_config', 'model_size'),
        ('_validate_model_config', 'model_type'),
        ('_validate_model_config', "pm.get('prompt_name')"),
        ('_validate_model_config', 'sorted(valid_sizes)'),
        ('_validate_model_config', 'sorted(valid_types)'),
        ('_validate_runtime_config', '_dim'),
        ('_validate_runtime_config', '_tiers'),
        ('_validate_runtime_config', 'key'),
        ('_validate_runtime_config', 'sorted(_valid_sizes)'),
        ('_validate_runtime_config', 'sorted(_valid_types)'),
        ('_validate_runtime_config', 'val'),
        ('_validate_technique_registry', 'name'),
        ('_validate_technique_registry', 'prompt_only'),
        ('_validate_technique_registry', 'registry_only'),
        ('_validate_technique_registry', 'sorted(families)'),
        ('_validate_technique_registry', 'sorted(table)'),
        ('_validate_technique_registry', 'stray'),
        ('_validate_technique_registry', 'unknown'),
        ('_validate_technique_registry', 'unpinned'),
        ('load_and_format_prompt', 'prompt_key'),
        ('run_worker', 'worker_prompt_path'),
        ('run_worker_judge', 'step_name'),
    },
    'person': {
        ('__init__', '_raw_operation'),
        ('__init__', 'self.generation_path'),
        ('__init__', 'self.table_election_mode'),
        ('_entries', 'name'),
        ('_entries', 'parent_name'),
        ('_get_salesy_summary', 'language'),
        ('_implement_alert_subscribers', "', '.join(unknown)"),
        ('_implement_one_locked', "use_case['_implement_grouping']['problem']"),
        ('_implement_targets', 'version'),
        ('_kpi_aggregate', 'aggregate'),
        ('_kpi_aggregate', 'column'),
        ('_kpis', "spec.get('direction')"),
        ('_kpis', 'where'),
        ('_load_usecases_catalog_json', 'english_path'),
        ('_load_usecases_catalog_json', 'json_file_path'),
        ('_strategy_name', 'text[:60]'),
        ('_strategy_name', 'what'),
        ('canonical_aggregate', 'aggregate'),
        ('canonical_discovery_type', 'text'),
        ('canonical_use_cases_quality', 'text'),
        ('implement_alert_threshold', 'raw'),
        ('kpi_filter_clause', 'column'),
        ('kpi_filter_clause', 'kind'),
        ('kpi_filter_clause', 'op'),
        ('kpi_filter_clause', 'problem'),
        ('kpi_filter_clause', 'value'),
        ('main', '_b19_err'),
        ('main', 'generate_genie_code_for_raw'),
        ('main', 'inspire_database'),
        ('main', 'operation'),
        ('parse_best_of_best_count', 'text'),
        ('parse_strategic_context', 'str(raw).strip()'),
        ('parse_strategic_context', 'text'),
        ('parse_strategic_context', 'version'),
        ('read', "urls.get(picked, '')[:200]"),
        ('read_user_file_bytes', 'text_path'),
        ('resolve_technical_exclusion_strategy', 'text'),
    },
    'name': {
        ('_verify_file', 'file'),
        ('_download_cli', "entry.get('file')"),
        ('_download_cli', 'name'),
        ('_download_cli', 'self.machine'),
        ('_download_cli', 'self.root'),
        ('inspire_trusted_download_url', 'repo'),
        ('_require_asset_package', 'purpose'),
        ('app_files', 'dist'),
        ('app_files', "str(entry.get('file'))"),
        ('entry', 'name'),
        ('entry', "str(found[0].get('file'))"),
        ('python', 'dist'),
        ('python', 'top'),
        ('python', 'where'),
        ('_implement_genie_own_rebuild', 'first'),
        ('_implement_one_locked', "[swap['chosen'] for swap in plan['retable']]"),
        ('_implement_retable_notebook', "[s['chosen'] for s in swaps]"),
        ('_align_batch', 'batch_label'),
        ('_assign_batch', 'batch_label'),
        ('_call_ai_query_impl', "_smallest.get('name')"),
        ('_call_ai_query_impl', "_smallest['llm_endpoint_name']"),
        ('_call_ai_query_impl', "best_remaining.get('name')"),
        ('_call_ai_query_impl', "best_remaining['llm_endpoint_name']"),
        ('_call_ai_query_impl', 'cascade_names[-1]'),
        ('_call_ai_query_impl', 'failed_name'),
        ('_call_ai_query_impl', 'model_name'),
        ('_call_ai_query_impl', 'model_override'),
        ('_call_ai_query_impl', 'prompt_name'),
        ('_call_ai_query_impl', 'self.current_language'),
        ('_classify', 'batch_label'),
        ('_implement_alert_check_run', 'run_id'),
        ('_implement_app_before', 'app_name'),
        ('_implement_app_health', 'deployment_id'),
        ('_implement_app_health', 'path'),
        ('_implement_app_host', 'asked'),
        ('_implement_app_host', 'builder'),
        ('_implement_app_host', 'held'),
        ('_implement_app_host', "host['source']"),
        ('_implement_app_host', 'name'),
        ('_implement_app_hosted_host', "live['source']"),
        ('_implement_app_job_resources', 'app_name'),
        ('_implement_app_job_resources', 'warehouse'),
        ('_implement_app_job_resources', 'was'),
        ('_implement_app_scopes', "', '.join(held)"),
        ('_implement_app_scopes', "', '.join(scopes)"),
        ('_implement_app_scopes', 'app_name'),
        ('_implement_app_settled', 'app_name'),
        ('_implement_app_undo', "', '.join(before['scopes'])"),
        ('_implement_app_undo', "', '.join(held)"),
        ('_implement_app_undo', 'app_name'),
        ('_implement_dashboard_rewrite', 'doing'),
        ('_implement_dashboard_rewrite', 'target'),
        ('_implement_deploy_app', 'app_name'),
        ('_implement_deploy_app', "context['result_table']"),
        ('_implement_folder_access', 'path'),
        ('_implement_genie_loop', "', '.join(result['secret_files'])"),
        ('_implement_genie_loop', 'label'),
        ('_implement_genie_read', 'space_id'),
        ('_implement_genie_smoke', 'question'),
        ('_implement_holders_checked', 'IMPLEMENT_OUTPUT_LABELS[name]'),
        ('_implement_holders_checked', 'asset_id'),
        ('_implement_lakebase_open', "held.get('branch')"),
        ('_implement_lakebase_open', "held.get('postgres_database')"),
        ('_implement_lakebase_synced', "', '.join(sorted(others - {''} | {pipeline_id}))"),
        ('_implement_lakebase_synced', 'source'),
        ('_implement_lakebase_until', 'what'),
        ('_implement_merge_genie', "current['title']"),
        ('_implement_merge_target', 'label'),
        ('_implement_merge_target', 'target'),
        ('_implement_notebook_before', 'path'),
        ('_implement_one_locked', 'based_on'),
        ('_implement_one_locked', 'key[0]'),
        ('_implement_one_locked', 'key[2]'),
        ('_implement_one_locked', 'self._tracking_table_name'),
        ('_implement_one_locked', 'uc_id'),
        ('_implement_page_check', 'app_name'),
        ('_implement_page_check', 'label'),
        ('_implement_page_check', "page['id']"),
        ('_implement_page_file', 'label'),
        ('_implement_page_file', 'shell_sql.RECORDS_DATASET'),
        ('_implement_publish_barrier', "(context.get('candidate_artifacts') or {}).get(name)"),
        ('_implement_publish_barrier', 'artifact'),
        ('_implement_publish_barrier', 'name'),
        ('_implement_refresh_run_controls', 'instruction_title'),
        ('_implement_space_columns', 'table'),
        ('_implement_take_out_app', 'asset_id'),
        ('_implement_take_out_app', 'source'),
        ('_implement_undo_save', 'label'),
        ('_implement_uninstall', 'key[0]'),
        ('_implement_uninstall', 'self._tracking_table_name'),
        ('_implement_uninstall', 'uc_id'),
        ('_judge_batch', 'batch_label'),
        ('_judge_batch', 'label'),
        ('_migrate_tracking_table_schema', 'self._tracking_table_name'),
        ('_ensure_implement_table', 'self.implement_table'),
        ('add_missing_columns', 'owned_table'),
        ('_parse_dedup_response', 'context_label'),
        ('_run_generate_mode', 'self.business_name'),
        ('_run_implement_mode', 'self._implement_param(IMPLEMENT_USE_CASE_PARAM)'),
        ('_run_implement_mode', 'self._implement_table_sql()'),
        ('_run_implement_mode', 'self.session_id'),
        ('_run_tagged_spark_work', 'label'),
        ('_run_tagged_spark_work', 'tag'),
        ('_score_batch', 'batch_label'),
        ('_tracking_replace_session', 'self._tracking_table_name'),
        ('_tracking_replace_session', 'self.session_id'),
        ('_with_metadata_retries', 'context'),
        ('_writable_root', 'candidates'),
        ('assert_no_blocking', "', '.join((a['rule_id'] for a in blocking[:10]))"),
        ('deep_signal_measures', 'check'),
        ('deploy', "chart['id']"),
        ('deploy', 'name'),
        ('execute_with_timeout', 'context'),
        ('finalize_pipeline', 'self.session_id'),
        ('finalize_pipeline', 'self.session_table'),
        ('initialize_session', 'self.inspire_database'),
        ('initialize_session', 'self.session_id'),
        ('initialize_session', 'self.session_table'),
        ('main', "', '.join(sorted(_valid_operations))"),
        ('main', "', '.join(valid_table_elections)"),
        ('online', 'name'),
        ('parse_strategic_context', 'json_error.msg'),
        ('signal_sql', 'check'),
    },
    'composed': {
        ('_require_asset_package', 'error'),
        ('_download_cli', 'installed'),
        ('_download_cli', 'why'),
        ('main', '_environment_problem'),
        ('entry', 'wanted'),
        ('manifest', 'held'),
        ('_call_ai_query_impl', "'; '.join((f'{ep} ({why})' for ep, why in sorted(_unusable.items())))"),
        ('_call_ai_query_impl', '_override_unusable'),
        ('_implement_app_host', "'; '.join(problems[:10])"),
        ('_implement_app_job_resources', 'problem'),
        ('_implement_app_lakebase', "'; '.join(problems[:5])"),
        ('_implement_app_repoint', 'shown'),
        ('_implement_app_scopes', 'problem'),
        ('_implement_app_undo', 'problem'),
        ('_implement_claim_notebook', 'implement_notebook_edited_message(current or path, modified_at, agreed)'),
        ('_implement_dashboard_rewrite', "'; '.join(problems)"),
        ('_implement_dashboard_rewrite', 'refused'),
        ('_implement_dashboard_rewrite', 'shown'),
        ('_implement_deploy_app', "implement_app_access_message(context['result_table'], readable['gaps'], readable['me'])"),
        ('_implement_genie_loop', 'last_error'),
        ('_implement_genie_own_rebuild', "'; '.join(problems)"),
        ('_implement_genie_own_rebuild', 'implement_genie_unknown_part(unknown, shown)'),
        ('_implement_genie_own_rebuild', 'shown'),
        ('_implement_held_row', 'problem'),
        ('_implement_holders_checked', 'refused'),
        ('_implement_lakebase_ready', 'implement_lakebase_unavailable(error)'),
        ('_implement_lakebase_call', 'implement_lakebase_refused(call, self._implement_builder())'),
        ('_implement_lakebase_synced', "implement_lakebase_schema_denied(copy['synced'], self._implement_builder())"),
        ('_implement_lakebase_views', "'; '.join(problems)"),
        ('_implement_merge_genie', "'; '.join(problems)"),
        ('_implement_one_locked', "'; '.join(errors)"),
        ('_implement_source_checks', "'; '.join(misfits)"),
        ('_implement_one_locked', "'; '.join(removal)"),
        ('_implement_one_locked', "'; '.join(unbuilt)"),
        ('_implement_one_locked', "'; '.join(widget_problems)"),
        ('_implement_source_checks', 'implement_missing_tables_message(missing, self._implement_builder(), self._implement_builder_label())'),
        ('_implement_keep_untargeted', 'implement_untargeted_missed(name, blocked)'),
        ('_implement_retable_notebook', "'; '.join(problems)"),
        ('_implement_route_vibe', 'implement_not_decided_text(reason, key[2])'),
        ('_implement_settings_owner_check', 'refusal'),
        ('implement_vibe_routes', "'; '.join(problems)"),
        ('_implement_one_locked', 'implement_stop_message(outcome, spec, trains_model=self._implement_trains_model(use_case))'),
        ('_implement_output_vibes_gate', "implement_vibes_missed_text(found['resend'])"),
        ('_implement_output_vibes_gate', "implement_vibes_repair(found['resend'], IMPLEMENT_OUTPUT_VIBES_LEAD)"),
        ('_implement_page_check', '[page]'),
        ('_implement_page_check', 'pages'),
        ('_implement_page_check', 'problems'),
        ('_implement_page_file', "'; '.join(errors + drawn_errors)"),
        ('_implement_page_file', "'; '.join(problems)"),
        ('_implement_part_attempts', "implement_attempts_message([item['error'] for item in history])"),
        ('_implement_patch_asset', 'implement_locked_asset_message(self._implement_builder_label(), IMPLEMENT_MERGE_LABELS.get(name, name), asset_id, joined, leaving, self._implement_shared_with(name, asset_id, key))'),
        ('_implement_route_vibe', "'; '.join(problems)"),
        ('_implement_save_chosen_settings', "'; '.join(problems)"),
        ('_implement_take_out_app', "'; '.join(problems[:10])"),
        ('_implement_take_out_app', 'implement_holders_text(holders)'),
        ('_implement_take_out_app', "implement_joining_hint(holders, 'uninstall it')"),
        ('_implement_take_out_dashboard', 'shown'),
        ('_implement_take_out_genie', "'; '.join(problems + ([hint] if hint else []))"),
        ('_implement_take_out_genie', 'shown'),
        ('_implement_vibes_image', "'; '.join(failures)"),
        ('_implement_wait_lock', "busy.replace('{who}', who)"),
        ('_migrate_tracking_table_schema', 'failed'),
        ('_ensure_implement_table', 'refused'),
        ('_parse_translation_csv', 'detail'),
        ('_regenerate_genie_for_flagged_rows', 'write_error'),
        ('_run_implement_mode', "', '.join(failed)"),
        ('_run_implement_mode', 'implement_settled_message(ran)'),
        ('_run_route2_fallback', 'self._nothing_to_regenerate_message()'),
        ('acquire_lock', 'message'),
        ('build', "'; '.join(errors)"),
        ('build_output', 'runner_error'),
        ('canonical_use_cases_quality', 'legacy_text'),
        ('deploy', "'; '.join(errors)"),
        ('deploy', "'; '.join(problems)"),
        ('execute_parallel', 'msg'),
        ('implement_app_settings', "'; '.join(problems)"),
        ('read', 'problem'),
        ('run', 'self._nothing_to_discover_message()'),
    },
    'genie': {
        ('_implement_keep_untargeted', 'implement_untargeted_repair(name, blocked)'),
    },
}
HALF_REVIEWED = {
    ("_probe_llm_endpoint", "kind"): "the category word Inspire gave the error, never its text",
    ("_with_metadata_retries", "kind"): "the category word Inspire gave the error, never its text",
    ("smoke_render_all_prompts", "type(_re).__name__"): "the class name of the error, never its text",
    ("_score_with_split_retry", "type(exc).__name__"): "the class name of the error, never its text",
    ("_implement_alert_check_run", "waited.get('status')"): "the run's status code, a different field from the error it hides",
    ("_implement_lakebase_online", "state"): "the copy's state code, a different field from the message it hides",
    ("online", "state"): "the copy's state code, a different field from the message it hides",
    ("_implement_app_deployment", "state"): "the deployment's state code, a different field from the message it hides",
    ("_implement_app_health", "state or 'not reported'"): "the App's state code, a different field from the message it hides",
}


def _sink(node):
    return isinstance(node, ast.Call) and getattr(node.func, "id", getattr(node.func, "attr", "")) in SINKS


def _messages(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call):
            yield node, list(node.exc.args) + [k.value for k in node.exc.keywords]
        elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "append"
              and isinstance(node.func.value, ast.Name) and node.func.value.id == "validation_errors"):
            yield node, list(node.args)


def _is_constant(expr, constants, bound=frozenset()):
    if isinstance(expr, ast.Constant):
        return True
    if isinstance(expr, ast.Name):
        return expr.id in constants or expr.id in bound
    if isinstance(expr, ast.JoinedStr):
        return all(_is_constant(v.value, constants, bound) for v in expr.values if isinstance(v, ast.FormattedValue))
    if isinstance(expr, ast.BinOp):
        return _is_constant(expr.left, constants, bound) and _is_constant(expr.right, constants, bound)
    if isinstance(expr, ast.UnaryOp):
        return _is_constant(expr.operand, constants, bound)
    if isinstance(expr, (ast.Tuple, ast.List, ast.Set)):
        return all(_is_constant(e, constants, bound) for e in expr.elts)
    if isinstance(expr, ast.Dict):
        return all(k is None or _is_constant(k, constants, bound) for k in expr.keys) and \
            all(_is_constant(v, constants, bound) for v in expr.values)
    if isinstance(expr, ast.Subscript):
        return _is_constant(expr.value, constants, bound) and _is_constant(expr.slice, constants, bound)
    if isinstance(expr, ast.Slice):
        return all(part is None or _is_constant(part, constants, bound) for part in (expr.lower, expr.upper, expr.step))
    if isinstance(expr, (ast.GeneratorExp, ast.ListComp, ast.SetComp)):
        names = set(bound)
        for generator in expr.generators:
            if not _is_constant(generator.iter, constants, frozenset(names)):
                return False
            names |= {n.id for n in ast.walk(generator.target) if isinstance(n, ast.Name)}
            if not all(_is_constant(test, constants, frozenset(names)) for test in generator.ifs):
                return False
        return _is_constant(expr.elt, constants, frozenset(names))
    if isinstance(expr, ast.Call):
        func = expr.func
        named = isinstance(func, ast.Name) and func.id in BUILTIN_SAFE | WRAPPERS
        method = isinstance(func, ast.Attribute) and func.attr in ("join", "format") and _is_constant(func.value, constants, bound)
        return (named or method) and all(_is_constant(arg, constants, bound) for arg in expr.args) and \
            all(_is_constant(k.value, constants, bound) for k in expr.keywords)
    return False


def _constants(tree):
    assigned = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            assigned.setdefault(node.targets[0].id, []).append(node.value)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.value is not None:
            assigned.setdefault(node.target.id, []).append(node.value)
    constants = set()
    while True:
        more = {name for name, values in assigned.items() if UPPER.match(name) and name not in constants
                and all(_is_constant(value, constants) for value in values)}
        if not more:
            return constants
        constants |= more


def _parts(expr, constants=frozenset()):
    if isinstance(expr, ast.JoinedStr):
        return [v.value for v in expr.values if isinstance(v, ast.FormattedValue)]
    if isinstance(expr, ast.Call) and isinstance(expr.func, ast.Attribute) and expr.func.attr == "format" and (
            (isinstance(expr.func.value, ast.Constant) and isinstance(expr.func.value.value, str))
            or (isinstance(expr.func.value, ast.Name) and expr.func.value.id in constants)):
        return list(expr.args) + [k.value for k in expr.keywords]
    if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Mod) and isinstance(expr.left, ast.Constant) \
            and isinstance(expr.left.value, str):
        return list(expr.right.elts) if isinstance(expr.right, ast.Tuple) else [expr.right]
    if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Add):
        return [side for side in (expr.left, expr.right) if not isinstance(side, ast.Constant)]
    return [] if isinstance(expr, ast.Constant) else [expr]


def _wrapped(expr):
    return isinstance(expr, ast.Call) and isinstance(expr.func, ast.Name) and expr.func.id in WRAPPERS


def _settled(expr, constants=frozenset()):
    while isinstance(expr, ast.Subscript) and isinstance(expr.slice, ast.Slice):
        expr = expr.value
    if isinstance(expr, ast.Call) and getattr(expr.func, "id", None) == "str" and expr.args:
        return _settled(expr.args[0], constants)
    if _sink(expr) or _is_constant(expr, constants):
        return True
    if isinstance(expr, ast.JoinedStr) or (isinstance(expr, ast.Call) and _parts(expr, constants) != [expr]):
        return all(_settled(part, constants) for part in _parts(expr, constants))
    if _wrapped(expr):
        return all(_settled(arg, constants) for arg in list(expr.args) + [k.value for k in expr.keywords])
    if isinstance(expr, ast.IfExp):
        return _settled(expr.body, constants) and _settled(expr.orelse, constants)
    if isinstance(expr, ast.BoolOp):
        return all(_settled(value, constants) for value in expr.values)
    if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Add):
        return _settled(expr.left, constants) and _settled(expr.right, constants)
    return False


def _leaves(expr, constants=frozenset()):
    if _settled(expr, constants):
        return []
    if isinstance(expr, ast.IfExp):
        return _leaves(expr.body, constants) + _leaves(expr.orelse, constants)
    if isinstance(expr, ast.BoolOp):
        return [leaf for value in expr.values for leaf in _leaves(value, constants)]
    if isinstance(expr, ast.JoinedStr) or (isinstance(expr, ast.Call) and _parts(expr, constants) != [expr]):
        return [leaf for part in _parts(expr, constants) for leaf in _leaves(part, constants)]
    if _wrapped(expr):
        return [leaf for arg in list(expr.args) + [k.value for k in expr.keywords] for leaf in _leaves(arg, constants)]
    if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Add):
        return _leaves(expr.left, constants) + _leaves(expr.right, constants)
    return [expr]


def _owners(tree):
    owner = {}
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for inner in ast.walk(fn):
                owner[id(inner)] = fn.name
    return owner


def interpolations(source):
    tree = ast.parse(source)
    owner, found, constants = _owners(tree), set(), _constants(tree)
    for node, args in _messages(tree):
        for arg in args:
            for part in _parts(arg, constants) if isinstance(arg, (ast.JoinedStr, ast.BinOp, ast.Call)) else [arg]:
                found.update((owner.get(id(node), "<module>"), ast.unparse(leaf)) for leaf in _leaves(part, constants))
    return found


def _names(node):
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name)} - {"set", "str", "len", "self", "error"}


def half_redactions(source):
    found = set()
    for fn in ast.walk(ast.parse(source)):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        derived = {}
        for node in ast.walk(fn):
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and not _sink(node.value):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        derived.setdefault(target.id, set()).update(_names(node.value))
        for text in ast.walk(fn):
            if not isinstance(text, ast.JoinedStr):
                continue
            fields = [v.value for v in text.values if isinstance(v, ast.FormattedValue)]
            hidden = {name for field in fields for call in ast.walk(field) if _sink(call) and call.args
                      for name in _names(call.args[0])}
            for field in fields:
                if hidden and not any(_sink(call) for call in ast.walk(field)):
                    shown = _names(field)
                    if shown & hidden or any(derived.get(name, set()) & hidden for name in shown):
                        found.add((fn.name, ast.unparse(field)))
    return found


def _reviewed():
    return {entry for entries in REVIEWED.values() for entry in entries}


def test_every_value_a_message_for_people_interpolates_is_redacted_or_on_the_reviewed_list():
    found = interpolations(agent_source())
    assert set(REVIEWED) == set(CATEGORIES) and all(CATEGORIES.values())
    assert sorted(found - _reviewed()) == []
    assert sorted(_reviewed() - found) == [], "a reviewed entry no longer exists; take it off the list"


def test_the_implement_redaction_is_the_one_redaction_with_the_workspace_secrets():
    from _agentload import method_node
    body = method_node("DatabricksInspire", "_implement_redacted").body
    call = body[-1].value
    assert isinstance(body[-1], ast.Return) and isinstance(call, ast.Call) and getattr(call.func, "id", None) == "inspire_redact_text"
    assert [ast.unparse(arg) for arg in call.args[:3]] == ["text", "set()", "known"]


def test_inspire_s_own_constants_and_wrappers_are_reviewed_by_rule_and_an_outside_value_inside_them_is_not():
    constants = _constants(ast.parse(agent_source()))
    assert {"IMPLEMENT_SUBMIT_AGAIN", "IMPLEMENT_REBUILD_ACTION", "IMPLEMENT_RETABLE_MISSED", "ULTRA_HIGH_DIMENSIONS"} <= constants
    probe = "PROBE_NAME = 'x'\nPROBE_READ = open('f').read()\nPROBE_JOINED = f'{PROBE_NAME} and {PROBE_READ}'\n"
    assert _constants(ast.parse(probe)) == {"PROBE_NAME"}


def _cut_before_redaction(source):
    found = []
    for node in ast.walk(ast.parse(source)):
        if _sink(node) and node.args:
            text = node.args[0]
            while isinstance(text, ast.Call) and getattr(text.func, "id", None) == "str" and text.args:
                text = text.args[0]
            if isinstance(text, ast.Subscript) and isinstance(text.slice, ast.Slice):
                found.append(ast.unparse(node))
    return found


def test_the_one_redaction_reads_the_whole_text_before_a_message_cuts_it():
    source = agent_source()
    texts = [source] + [text for text, _space in runtime_sources(source)[0].values()] + list(pasted_sources(source).values())
    assert [found for text in texts for found in _cut_before_redaction(text)] == []
    probe = "def implement_probe_cut(failure):\n    raise ValueError(f\"failed: {inspire_redact_text(failure[:800], set(), '')}\")\n\n\n"
    assert _cut_before_redaction(source.replace(ANCHOR, probe + ANCHOR)) == ["inspire_redact_text(failure[:800], set(), '')"]


def test_the_app_shell_redacts_the_whole_text_before_it_cuts_it():
    from v169_one_redaction_test import shell_library
    library, _spans = shell_library()
    assert "inspire_redact_text(message, set(), '', self.secrets)[:400]" in ast.unparse(ast.parse(library))
    assert _cut_before_redaction(library) == []
    probe = "def shell_probe(response):\n    return error_text(response.text[:400])\n"
    assert _cut_before_redaction(library + probe) == ["error_text(response.text[:400])"]


def test_the_implement_redaction_keeps_the_words_inspire_wrote_and_hides_a_value_beside_them(agent_ns):
    inspire = agent_ns["DatabricksInspire"]
    fake = _fake(w_client=types.SimpleNamespace(config=types.SimpleNamespace(token=TOKEN, host=f"https://{HOST}")))
    text = inspire._implement_redacted(fake, f"no row of run r-9 reached 'Act now' or 'Review', near '{SENTINEL}' at https://{HOST}/x")
    assert "'Act now' or 'Review'" in _hidden(text) and "'a data value'" in text


def test_a_retable_run_error_reaches_people_redacted_before_it_is_cut(agent_ns):
    from _agentload import method_node
    method = method_node("DatabricksInspire", "_implement_one_locked")
    blocks = [node for node in ast.walk(method) if isinstance(node, ast.If) and ast.unparse(node.test) == "outcome.get('status') != 'written'"
              and any(isinstance(n, ast.Raise) and "ImplementRetableMissed" in ast.unparse(n) for n in ast.walk(node))]
    assert len(blocks) == 1
    block = blocks[0]
    probe = ast.Module(body=[ast.FunctionDef(
        name="probe", args=ast.arguments(posonlyargs=[], args=[ast.arg(arg=a) for a in ("self", "outcome", "plan", "use_case", "spec")],
                                         kwonlyargs=[], kw_defaults=[], defaults=[]),
        body=[ast.parse("run_known = self._implement_run_known(use_case, spec)").body[0], block], decorator_list=[], returns=None,
        type_params=[])], type_ignores=[])
    space = dict(agent_ns)
    exec(compile(ast.fix_missing_locations(probe), "retable_block", "exec"), space)
    inspire = agent_ns["DatabricksInspire"]
    fake = _fake(w_client=types.SimpleNamespace(config=types.SimpleNamespace(token=TOKEN, host=f"https://{HOST}")))
    fake._implement_redacted = types.MethodType(inspire._implement_redacted, fake)
    fake._implement_run_known = types.MethodType(inspire._implement_run_known, fake)
    failure = (f"[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name `churn_score` cannot be "
               f"resolved near '{SENTINEL}' at https://{HOST}/sql ").ljust(789, "x") + " " + TOKEN
    plan = {"retable": [{"chosen": "main.sales.orders_v2", "replaced": "main.sales.orders"}]}
    error = _raised(space["probe"], fake, {"status": "failed", "error": failure}, plan, {"result_table": "main.sales.scores"},
                    {"data": {"tables": {}}})
    assert type(error).__name__ == "ImplementRetableMissed"
    text = _hidden(str(error))
    assert text.startswith("Inspire pointed the notebook at main.sales.orders_v2 with no rebuild") and "`churn_score`" in text
    assert "dapi" not in text and "cdcdcd" not in text
    assert agent_ns["inspire_redact_text"](failure[:800], set(), "").endswith(" dapicdcdcd")


@pytest.mark.parametrize("probe,expected", [
    ("def implement_probe_reply(reply):\n    raise ValueError(f\"the model replied {reply.text}\")\n\n\n",
     {("implement_probe_reply", "reply.text")}),
    ("def implement_probe_platform(status):\n    raise RuntimeError(f\"the App failed: {status.get('message')}\")\n\n\n",
     {("implement_probe_platform", "status.get('message')")}),
    ("def implement_probe_format(reply):\n    raise ValueError(\"the model replied {}\".format(reply))\n\n\n",
     {("implement_probe_format", "reply")}),
    ("def implement_probe_join(reply):\n    raise ValueError(\"the model replied \" + reply)\n\n\n", {("implement_probe_join", "reply")}),
    ("def implement_probe_routed(reply, status):\n    raise ValueError(f\"the model replied {inspire_redact_text(reply.text, set(), '')} \"\n"
     "                     f\"{redact_error(status)[:80]}\")\n\n\n", set()),
    ("def implement_probe_retable(self, outcome, plan):\n    failure = str(outcome.get('error') or '')\n"
     "    raise ImplementRetableMissed(IMPLEMENT_RETABLE_MISSED.format(\n"
     "        tables=implement_and_list([swap['chosen'] for swap in plan['retable']]), error=failure[:800]))\n\n\n",
     {("implement_probe_retable", "failure[:800]"), ("implement_probe_retable", "[swap['chosen'] for swap in plan['retable']]")}),
    ("def implement_probe_retable_routed(self, outcome, plan, run_known):\n    failure = str(outcome.get('error') or '')\n"
     "    raise ImplementRetableMissed(IMPLEMENT_RETABLE_MISSED.format(\n"
     "        tables=implement_and_list([swap['chosen'] for swap in plan['retable']]),\n"
     "        error=self._implement_redacted(failure, run_known)[:800]))\n\n\n",
     {("implement_probe_retable_routed", "[swap['chosen'] for swap in plan['retable']]")}),
    ("IMPLEMENT_PROBE_ENV = os.environ.get('PROBE', '')\n\n\ndef implement_probe_env():\n"
     "    raise ValueError(f\"set {IMPLEMENT_PROBE_ENV}\")\n\n\n", {("implement_probe_env", "IMPLEMENT_PROBE_ENV")}),
    ("def implement_probe_wrapped(reply):\n    raise ValueError(f\"the model kept {inspire_plural(reply.count, 'row')}: \"\n"
     "                     f\"{inspire_rebuild_action(reply.text)}\")\n\n\n",
     {("implement_probe_wrapped", "reply.count"), ("implement_probe_wrapped", "reply.text")}),
    ("def implement_probe_constants(n):\n    raise ValueError(f\"{IMPLEMENT_SUBMIT_AGAIN}: {inspire_rebuild_action('the App')}, \"\n"
     "                     f\"{inspire_plural(n, 'row')}\")\n\n\n", {("implement_probe_constants", "n")}),
])
def test_a_probe_raise_that_quotes_a_model_reply_or_a_platform_message_fails_the_gate(probe, expected):
    source = agent_source()
    assert source.count(ANCHOR) == 1
    assert interpolations(source.replace(ANCHOR, probe + ANCHOR)) - _reviewed() == expected


def test_no_message_shows_an_outside_value_both_hidden_and_in_clear():
    source = agent_source()
    assert sorted(half_redactions(source) - set(HALF_REVIEWED)) == []
    assert sorted(set(HALF_REVIEWED) - half_redactions(source)) == []
    probe = "def implement_probe_half(url):\n    raise ValueError(f\"it redirects to {inspire_redact_text(url, set(), '')} at {url}\")\n\n\n"
    assert half_redactions(source.replace(ANCHOR, probe + ANCHOR)) - set(HALF_REVIEWED) == {("implement_probe_half", "url")}


def _hidden(text):
    assert SENTINEL not in text and HOST not in text and TOKEN not in text, text
    return text


def _raised(call, *args, **kwargs):
    try:
        call(*args, **kwargs)
    except Exception as error:
        return error
    raise AssertionError("nothing was raised")


def _fake(**attrs):
    return types.SimpleNamespace(logger=types.SimpleNamespace(info=lambda *a, **k: None, warning=lambda *a, **k: None,
                                                              error=lambda *a, **k: None), **attrs)


def _own(agent_ns, error, words):
    text = str(error)
    assert all(word in text for word in words), text
    assert agent_ns["raised_by_inspire"](error) and agent_ns["redact_error"](error) == agent_ns["get_clean_error_message"](error)
    return _hidden(text)


@pytest.mark.parametrize("lead,words", [
    ("DESCRIBE TABLE EXTENDED t WHERE", "Phase C1: query violates metadata-only contract (banned): DESCRIBE TABLE EXTENDED t WHERE"),
    ("WITH t AS (SELECT 1) SELECT * FROM t WHERE", "Phase C1: query not on allowlist: WITH t AS (SELECT 1) SELECT * FROM t WHERE"),
])
def test_the_metadata_guard_hides_a_value_in_the_query_it_refuses(agent_ns, lead, words):
    error = _raised(agent_ns["inspire_sql"], f"{lead} '{SENTINEL}' = 'https://{HOST}/{TOKEN}'")
    _own(agent_ns, error, (words,))


def test_a_translation_reply_without_a_header_is_quoted_without_its_values(agent_ns):
    owner = next(v for v in agent_ns.values() if isinstance(v, type) and "_parse_translation_rows" in vars(v))
    reply = f"Sorry, I cannot translate '{SENTINEL}' from https://{HOST}/x {TOKEN}. " * 3
    _own(agent_ns, _raised(owner._parse_translation_rows, _fake(), reply, [], 1, "Arabic"),
         ("Could not find CSV header. First line was: ",))


def test_a_vision_reply_without_a_verdict_is_quoted_without_its_values(agent_ns):
    reply = {"choices": [{"message": {"content": f"The picture shows '{SENTINEL}' at https://{HOST}/x {TOKEN}"}}]}
    _own(agent_ns, _raised(agent_ns["implement_vision_verdict"], reply), ("it gave no verdict: The picture shows",))


def test_a_model_reply_without_json_is_quoted_without_its_values(agent_ns):
    reply = f"[\"I think '{SENTINEL}' at https://{HOST}/x {TOKEN}\"]"
    fake = _fake(ai_agent=types.SimpleNamespace(_call_ai_query=lambda **_k: reply))
    error = _raised(agent_ns["DatabricksInspire"]._implement_llm_object, fake, "P", "p", "prompt", {})
    _own(agent_ns, error, ("the model replied with no JSON object: [",))


def test_a_genie_agent_failure_keeps_the_question_and_hides_the_values_of_its_error(agent_ns):
    answers = iter([{"conversation_id": "c1", "message_id": "m1"}, {"status": "FAILED", "error": {"error": OUTSIDE}}])
    fake = _fake(_implement_api=lambda *_a, **_k: next(answers))
    error = _raised(agent_ns["DatabricksInspire"]._implement_genie_smoke, fake, "s1", "Which customers act now?", 5, 0)
    _own(agent_ns, error, ("the Genie Agent could not answer 'Which customers act now?': [CAST_INVALID_INPUT]",))


def test_a_failed_app_deployment_and_a_crashed_app_hide_the_values_of_the_platform_message(agent_ns):
    inspire = agent_ns["DatabricksInspire"]
    deploy = _fake(_implement_api=lambda *_a, **_k: {"deployment_id": "d1", "status": {"state": "FAILED", "message": OUTSIDE}})
    _own(agent_ns, _raised(inspire._implement_app_deployment, deploy, "churn-desk", "/W/app", time.time() + 60, 60, 0),
         ("the App deployment FAILED: [CAST_INVALID_INPUT]",))
    crashed = _fake(_implement_api=lambda *_a, **_k: {"app_status": {"state": "CRASHED", "message": OUTSIDE}})
    _own(agent_ns, _raised(inspire._implement_app_health, crashed, "churn-desk", "d1", "https://app", "/", time.time() + 60, 0),
         ("the App crashed after deployment d1: [CAST_INVALID_INPUT]",))
    slow = _fake(_implement_api=lambda *_a, **_k: {"app_status": {"state": "DEPLOYING", "message": OUTSIDE}})
    _own(agent_ns, _raised(inspire._implement_app_health, slow, "churn-desk", "d1", "https://app", "/", time.time() - 1, 0),
         ("the App is DEPLOYING, not RUNNING on deployment d1 (active deployment none): [CAST_INVALID_INPUT]",))


def test_a_failed_alert_check_and_a_failed_lakebase_copy_hide_the_values_of_the_platform_message(agent_ns):
    inspire = agent_ns["DatabricksInspire"]

    class Launcher:
        def __init__(self, *_args):
            pass

        def wait_for_run(self, *_args, **_kwargs):
            return {"status": "FAILED", "error": OUTSIDE}

    def api(method, *_args, **_kwargs):
        if method == "POST":
            return {"run_id": 7}
        raise RuntimeError("the run is unreadable")

    error = _raised(inspire._implement_alert_check_run, _fake(_job_launcher_cls=Launcher, _implement_api=api), "N01-U01", "a1", "w1")
    _own(agent_ns, error, ("the one-time alert check run 7 ended FAILED with alert state UNKNOWN: [CAST_INVALID_INPUT]",))
    copy = _fake(_implement_lakebase_find=lambda _path: {"status": {"detailed_state": "SYNCED_TABLE_FAILED", "message": OUTSIDE}})
    error = _raised(inspire._implement_lakebase_online, copy, ["main.sales.orders"], time.time() + 60, wait=False)
    _own(agent_ns, error, ("Lakebase could not copy main.sales.orders (SYNCED_TABLE_FAILED): [CAST_INVALID_INPUT]",))
