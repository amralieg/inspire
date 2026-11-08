import re as _redact_re
import types as _redact_types
import dis as _redact_dis
import datetime as _redact_datetime

INSPIRE_SECRET_TOKEN_RE = _redact_re.compile(r"\bdapi[0-9a-f]{16,}\b|\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]+|(?<=Bearer )[\w.~+/=-]{8,}", _redact_re.IGNORECASE)
INSPIRE_SECRET_HOST_RE = _redact_re.compile(r"(https?://)[^\s/'\"<>]*[^\s/'\"<>.,;:!?)]", _redact_re.IGNORECASE)
INSPIRE_SECRET_EMAIL_RE = _redact_re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
INSPIRE_ANSI_RE = _redact_re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-Z\\-_]")


def inspire_strip_ansi(text) -> str:
    return INSPIRE_ANSI_RE.sub("", str(text or ""))


def inspire_redact_secrets(text, secrets=(), keep=(), marks=("<redacted>", "<host>", "<email>")) -> str:
    redacted, host, email = marks
    text = inspire_strip_ansi(text)
    for secret in sorted({str(s) for s in secrets if s and len(str(s)) >= 6}, key=len, reverse=True):
        text = text.replace(secret, redacted)
    text = INSPIRE_SECRET_HOST_RE.sub(lambda found: found.group(1) + host, INSPIRE_SECRET_TOKEN_RE.sub(redacted, text))
    return INSPIRE_SECRET_EMAIL_RE.sub(lambda found: found.group(0) if found.group(0) in keep else email, text)


_REDACT_DENIAL_RE = _redact_re.compile(
    r"(?:(?:Principal|User)\s+(?:'(?P<who>[^']+)'\s+)?)?does not have\s+(?:permission\s+)?(?P<what>[A-Z][A-Z_ ]*?)\s+(?:privilege\s+)?on\s+"
    r"(?P<kind>\w+)\s+(?:'(?P<quoted>[^']+)'|(?P<ticked>`[^`]+`(?:\.`[^`]+`)*)|(?P<plain>[\w.]+))", _redact_re.IGNORECASE)


INSPIRE_REDACTED_VALUE = "a data value"
_REDACT_SINGLE_QUOTED_RE = _redact_re.compile(r"(?<!\w)'((?:[^'\\\n]|\\.|(?<=\w)'(?=\w)){0,400})'(?!\w)")
_REDACT_DOUBLE_QUOTED_RE = _redact_re.compile(r"(?<!\w)\"([^\"\n]{0,400})\"(?!\w)")
_REDACT_SPARK_MESSAGE_RE = _redact_re.compile(r"\[[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)*\] [A-Z](?:(?!SQLSTATE: )[^\n])*(?:SQLSTATE: \w{5})?")
_REDACT_SPARK_NAME_RE = _redact_re.compile(r"\bSyntax error at or near '([^'\n]{1,80})'")
_REDACT_KEY_ERROR_RE = _redact_re.compile(r"\bKeyError: '([^'\n]{1,200})'")
_REDACT_SQL_TYPE_RE = _redact_re.compile(r"(?i)(tinyint|smallint|int|integer|bigint|long|short|byte|float|double|real|decimal|dec|numeric|"
                                 r"string|varchar|char|binary|boolean|date|timestamp|timestamp_ntz|timestamp_ltz|interval|void|"
                                 r"array|map|struct|variant)(\s*[(<][^\n]{0,80}[)>])?")
_REDACT_SPARK_SETTING_RE = _redact_re.compile(r"(?i)true|false|spark\.[\w.]+")
_REDACT_FRAME_RE = _redact_re.compile(r'^[ \t]*File "([^"\n]+)", line \d+[^\n]*(?:\n[ \t]+(?![ \t]*File ")([^\n]+))?', _redact_re.M)
_REDACT_NUMBERED_FRAME_RE = _redact_re.compile(r"^[ \t]*File [^\n]*?(?::\d+, in [^\n]*|, line \d+[^\n]*)\n((?:[ \t]*(?:-*>[ \t]*)?\d+ [^\n]*(?:\n|$))+)", _redact_re.M)
_REDACT_NAME_LIST = r"((?:'[^'\n]{1,200}'(?:, )?)+)"
_REDACT_NAME_POSITION_RE = _redact_re.compile(rf"\[{_REDACT_NAME_LIST}\] (?:not in index|not found in axis)|Column[(]s[)] \[{_REDACT_NAME_LIST}\] do not exist|"
                                      rf"None of \[Index\(\[{_REDACT_NAME_LIST}\], dtype='(\w+)'\)\] are in the \[columns\]|"
                                      r"\bcolumns? '([^'\n]{1,200})'|\bcolumns? \"([^\"\n]{1,200})\"|\bdtype='(\w+)'", _redact_re.IGNORECASE)
_REDACT_NAME_SHAPE_RE = _redact_re.compile(r"[A-Za-z_][\w.$#-]{0,199}")
_REDACT_EXCEPTION_LEAD_RE = _redact_re.compile(r"\b\w*(?:Error|Exception|Warning): $")
_REDACT_AT_FRAME_RE = _redact_re.compile(r"(?:\(at |; )[A-Za-z_]\w* line \d+: ((?:(?!; [A-Za-z_]\w* line \d+\b)[^\n|]){1,200}?)(?=; [A-Za-z_]\w* line \d+\b|\)(?:\s|$)|$)", _redact_re.M)
_REDACT_CODE_QUOTED_RE = _redact_re.compile(r"(?<!\w)'([^'\n]{1,80})'(?!\w)|(?<!\w)\"([^\"\n]{1,80})\"(?!\w)")
_REDACT_VALUE_CHAR_RE = _redact_re.compile(r"[^\W_]")
_REDACT_PY_NAME_RE = _redact_re.compile(r"'([\w.]+)' object\b|\battribute '(\w+)'|\bname '(\w+)' is not defined|"
                                r"\bNo module named '([\w.]+)'|type[(]s[)] for [^:\n]{1,8}: '(\w+)' and '(\w+)'|"
                                r"\[Errno \d+\] [^:'\n]{1,80}: '([^'\n]{1,400})'(?: -> '([^'\n]{1,400})')?|"
                                r"\bExpecting '([,:])' delimiter|\bargument '(\w+)'|\barguments?: '(\w+)'(?:,? and '(\w+)')?|"
                                r"\b(?:of|unhashable) type:? '(\w+)'|'([<>=!]{1,2})' not supported between instances of '(\w+)' and '(\w+)'|"
                                r", not '(\w+)'|\bdoes not match format '([^'\n]{1,80})'|'(\w+)' is an invalid keyword argument|"
                                r"\bimport name '(\w+)'|\bmodule '([\w.]+)'")
INSPIRE_REDACT_ERROR_CHARS = 100000
INSPIRE_SPARK_VALUE_TEMPLATES = (
    ("AI_FUNCTION_HTTP_PARSE_CAST_ERROR", "response JSON was: <r>. Please update the returnType"),
    ("AI_INVALID_ARGUMENT_VALUE_ERROR, METRIC_STORE_INVALID_ARGUMENT_VALUE_ERROR", "Provided value <v> is not supported by argument"),
    ("BINARY_ARITHMETIC_OVERFLOW", "<w> <t> <w> caused overflow"),
    ("CANNOT_DECODE_URL", "The provided URL cannot be decoded: <v>."),
    ("CANNOT_PARSE_INTERVAL", "Unable to parse <v>. Please ensure"),
    ("CANNOT_PARSE_JSON_FIELD", "Cannot parse the field name <v> and the value <v> of the JSON token type "),
    ("CANNOT_PARSE_TIME", "The input string <v> cannot be parsed to a TIME value"),
    ("CAST_INVALID_INPUT, CAST_OVERFLOW", "The value <v> of the type "),
    ("COMPARATOR_RETURNS_NULL", "for a comparison between <v> and <v>. It should return"),
    ("CONVERSION_INVALID_INPUT", "The value <v> (<_>) cannot be converted to "),
    ("DELTA_EXCEED_CHAR_VARCHAR_LIMIT", "Value <v> exceeds char/varchar type length limitation"),
    ("FAILED_PARSE_STRUCT_TYPE", "Failed parsing struct: <v>."),
    ("FAILED_ROW_TO_JSON", "Failed to convert the row value <v> of the class "),
    ("ILLEGAL_DAY_OF_WEEK", "Illegal input for day of week: <v>."),
    ("INVALID_ARRAY_INDEX, INVALID_ARRAY_INDEX_IN_ELEMENT_AT", "The index <v> is out of bounds"),
    ("INVALID_BOUNDARY", "The boundary <_> is invalid: <v>."),
    ("INVALID_FRACTION_OF_SECOND", "but the provided value is <v>. To avoid this error"),
    ("INVALID_INTERVAL_FORMAT", "Error parsing '<v>' to interval"),
    ("INVALID_INTERVAL_FORMAT.ARITHMETIC_EXCEPTION", "Uncaught arithmetic exception while parsing '<v>'"),
    ("INVALID_INTERVAL_FORMAT.INVALID_PRECISION", "Interval can only support nanosecond precision, <v> is out of range"),
    ("INVALID_INTERVAL_FORMAT.INVALID_VALUE", "for the correct format. Invalid value <v>."),
    ("INVALID_INTERVAL_FORMAT.UNMATCHED_FORMAT_STRING", "format of <_> when cast to <_>: <v>."),
    ("INVALID_INTERVAL_FORMAT.UNSUPPORTED_FROM_TO_EXPRESSION", "Cannot support (interval '<v>' "),
    ("INVALID_JSON_FORMAT_JSON_VALUE", "must contain exactly one well-formed JSON value, but got <v>."),
    ("INVALID_PARAMETER_VALUE.BIT_POSITION_RANGE", "expects an integer value in [0, <_>), but got <v>."),
    ("INVALID_PARAMETER_VALUE.BOOLEAN", "expects a boolean literal, but got <v>."),
    ("INVALID_PARAMETER_VALUE.DATETIME_UNIT", "but got the string literal <v>."),
    ("INVALID_PARAMETER_VALUE.DOUBLE", "expects an double literal, but got <v>."),
    ("INVALID_PARAMETER_VALUE.DTYPE", "Unsupported dtype: <v>. Valid values"),
    ("INVALID_PARAMETER_VALUE.EXTENSION", "Invalid extension: <v>. Extension must"),
    ("INVALID_PARAMETER_VALUE.INTEGER", "expects an integer literal, but got <v>."),
    ("INVALID_PARAMETER_VALUE.LONG", "expects a long literal, but got <v>."),
    ("INVALID_PARAMETER_VALUE.STRING", "expects a string literal, but got <v>."),
    ("INVALID_PARAMETER_VALUE.TIME_UNIT", "but got '<v>'."),
    ("INVALID_REGEXP_REPLACE", "Could not perform regexp_replace for source = \"<v>\", pattern = \"<_>\", replacement = \"<v>\" and position = "),
    ("INVALID_TIMESTAMP_LITERAL_PRECISION", "The timestamp literal <v> has more than 9 fractional-second digits"),
    ("INVALID_TIME_LITERAL_PRECISION", "The time literal <v> has more than 9 fractional-second digits"),
    ("INVALID_TIMEZONE", "The timezone: <v> is invalid"),
    ("INVALID_TIME_TRAVEL_TIMESTAMP_FORMAT", "The provided timestamp <v> doesn't match the expected syntax"),
    ("INVALID_URL", "The url is invalid: <v>. Use "),
    ("INVALID_UTF8_STRING", "Invalid UTF8 byte sequence found in string: <v>."),
    ("INVALID_VARIANT_CAST", "The variant value `<v>` cannot be cast into `"),
    ("MALFORMED_RECORD_IN_PARSING", "Malformed records are detected in record parsing: <v>. Parse Mode: "),
    ("MALFORMED_RECORD_IN_PARSING.CANNOT_PARSE_STRING_AS_DATATYPE", "Cannot parse the value <v> of the field <v> as target spark data type "),
    ("NUMERIC_OUT_OF_SUPPORTED_RANGE", "The value <v> cannot be interpreted as a numeric"),
    ("NUMERIC_VALUE_OUT_OF_RANGE.WITHOUT_SUGGESTION", "The <w> rounded half up from <w> cannot be represented as Decimal("),
    ("NUMERIC_VALUE_OUT_OF_RANGE.WITH_SUGGESTION", "<w> cannot be represented as Decimal("),
)


def _redact_spark_value_re(fragment: str):
    tokens, pattern = _redact_re.split(r"(<[vwrt_]>)", fragment), ""
    for index, token in enumerate(tokens):
        lead = r"(?:(?<=\] )|(?<=: )|^)" if not "".join(tokens[:index]) else ""
        if token == "<v>":
            pattern += lead + r"([^;\n]{1,300}?)"
        elif token == "<r>":
            pattern += lead + r"([^\n]{1,4000})"
        elif token == "<w>":
            pattern += lead + r"(\S+)"
        elif token == "<t>":
            pattern += r"\S+"
        elif token == "<_>":
            pattern += r"[^;\n]{0,300}?"
        elif token == "." and index == len(tokens) - 1:
            pattern += r"(?=\.(?:\s|$))"
        else:
            pattern += _redact_re.escape(token)
    return _redact_re.compile(pattern)


_REDACT_SPARK_VALUE_RES = tuple(_redact_spark_value_re(fragment) for _classes, fragment in INSPIRE_SPARK_VALUE_TEMPLATES)


def _redact_in_text(value: str, text: str) -> bool:
    return bool(_redact_re.search(rf"(?<!\w){_redact_re.escape(value)}(?!\w)", text))


_REDACT_CODE_WORDS = {}


def _redact_strings(value, depth: int = 2) -> list:
    if isinstance(value, str):
        return [value]
    if depth <= 0:
        return []
    if isinstance(value, dict):
        return [s for k, v in value.items() for s in _redact_strings(k, depth - 1) + _redact_strings(v, depth - 1)]
    if isinstance(value, (tuple, list, set, frozenset)):
        return [s for item in value for s in _redact_strings(item, depth - 1)]
    return []


def _redact_code_words() -> frozenset:
    scope = globals()
    if _REDACT_CODE_WORDS.get("size") != len(scope):
        words, codes, seen = set(), [], set()
        for value in list(scope.values()):
            words.update(_redact_strings(value))
            for member in (list(vars(value).values()) if isinstance(value, type) else [value]):
                member = member.__func__ if isinstance(member, (staticmethod, classmethod)) else (
                    member.fget if isinstance(member, property) else member)
                if isinstance(member, _redact_types.FunctionType):
                    codes.append(member.__code__)
        while codes:
            code = codes.pop()
            if id(code) not in seen:
                seen.add(id(code))
                words.update(const for const in code.co_consts if isinstance(const, str))
                codes.extend(const for const in code.co_consts if hasattr(const, "co_consts"))
        quoted = {part for word in words if "'" in word or '"' in word
                  for found in _REDACT_CODE_QUOTED_RE.finditer(word) for part in found.groups() if part}
        _REDACT_CODE_WORDS.update(size=len(scope), words=frozenset(words), quoted=frozenset(quoted))
    return _REDACT_CODE_WORDS["words"]


def _redact_code_value(value: str) -> bool:
    if not _REDACT_VALUE_CHAR_RE.search(value) or value in inspire_redact_secrets.__defaults__[-1]:
        return True
    _redact_code_words()
    return value in _REDACT_CODE_WORDS["quoted"]


INSPIRE_ISO_TIME_RE = _redact_re.compile(r"(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?"
                                         r"\s*(?:([Zz])|([+-])(\d{2})(?::?(\d{2}))?)?")


def inspire_parse_time(value):
    match = INSPIRE_ISO_TIME_RE.fullmatch(str(value if value is not None else "").strip())
    if not match:
        raise ValueError("not an ISO 8601 date or time")
    year, month, day, hour, minute, second, fraction, _utc, sign, zone_hours, zone_minutes = match.groups()
    offset = _redact_datetime.timedelta(hours=int(zone_hours or 0), minutes=int(zone_minutes or 0))
    zone = _redact_datetime.timezone(-offset if sign == "-" else offset) if sign else _redact_datetime.timezone.utc
    return _redact_datetime.datetime(int(year), int(month), int(day), int(hour or 0), int(minute or 0), int(second or 0),
                                     int((fraction or "0")[:6].ljust(6, "0")), tzinfo=zone)


def inspire_raised_by(error, files, modules=()) -> bool:
    if type(error).__module__ in modules:
        return True
    trace = getattr(error, "__traceback__", None)
    while trace is not None and trace.tb_next is not None:
        trace = trace.tb_next
    if trace is None or trace.tb_frame.f_code.co_filename not in files:
        return False
    return any(step.offset == trace.tb_lasti and step.opname == "RAISE_VARARGS"
               for step in _redact_dis.get_instructions(trace.tb_frame.f_code))


def inspire_redact_text(text, seen, known: str, secrets=()) -> str:
    text = str(text or "")
    named = [found.group(name) for found in _REDACT_DENIAL_RE.finditer(text) for name in ("who", "quoted") if found.group(name)]
    text = inspire_redact_secrets(text, secrets, named)
    positioned = [name for found in _REDACT_NAME_POSITION_RE.finditer(text) for part in found.groups() if part
                  for name in (_redact_re.findall(r"'([^'\n]*)'", part) if part.startswith("'") else [part])
                  if _REDACT_NAME_SHAPE_RE.fullmatch(name)]
    known = "\n".join([str(known or ""), *named, *positioned,
                       *(part for pattern in (_REDACT_FRAME_RE, _REDACT_NUMBERED_FRAME_RE, _REDACT_AT_FRAME_RE, _REDACT_PY_NAME_RE, _REDACT_SPARK_NAME_RE)
                         for found in pattern.finditer(text) for part in found.groups() if part),
                       *(found.group(1) for found in _REDACT_KEY_ERROR_RE.finditer(text) if found.group(1) in _redact_code_words())])

    def spark(match):
        out, last = [], match.start()
        for group in range(1, match.re.groups + 1):
            start, end = match.span(group)
            value = match.group(group)
            mark = value[0] if len(value) > 1 and value[0] == value[-1] and value[0] in "'\"" else ""
            bare = value.strip("'\"`")
            out += [match.string[last:start], value if _redact_in_text(bare, known) or _redact_code_value(bare)
                    else f"{mark}{INSPIRE_REDACTED_VALUE}{mark}"]
            last = end
        return "".join(out) + match.string[last:match.end()]

    for pattern in _REDACT_SPARK_VALUE_RES:
        text = pattern.sub(spark, text)

    def quoted(match):
        mark, inner = match.group(0)[0], match.group(1)
        if mark == '"' and _REDACT_SINGLE_QUOTED_RE.search(inner) and _REDACT_EXCEPTION_LEAD_RE.search(match.string[max(0, match.start() - 80):match.start()]):
            return match.group(0)
        if not inner.strip() or _redact_in_text(inner, known) or (mark == '"' and (
                _REDACT_SQL_TYPE_RE.fullmatch(inner.strip()) or _REDACT_SPARK_SETTING_RE.fullmatch(inner.strip())
                or any(start <= match.start() < end for start, end in messages))) or _redact_code_value(inner):
            return match.group(0)
        return f"{mark}{INSPIRE_REDACTED_VALUE}{mark}"

    text = _REDACT_SINGLE_QUOTED_RE.sub(quoted, text)
    messages = [found.span() for found in _REDACT_SPARK_MESSAGE_RE.finditer(text)]
    text = _REDACT_DOUBLE_QUOTED_RE.sub(quoted, text)
    hidden = [v for v in set(seen) if v in text and not _redact_in_text(v, known) and not _redact_in_text(v, INSPIRE_REDACTED_VALUE)
              and not _redact_code_value(v)]
    for value in sorted(hidden, key=len, reverse=True):
        if len(value) >= 4 or (len(value) >= 2 and not value.replace(".", "").replace("-", "").isdigit()):
            text = _redact_re.sub(rf"(?<!\w){_redact_re.escape(value)}(?!\w)", INSPIRE_REDACTED_VALUE, text)
        text = text.replace(f"({value})", f"({INSPIRE_REDACTED_VALUE})")
    return text
