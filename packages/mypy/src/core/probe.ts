/**
 * The Python the shell runs, in isolated mode, to ask mypy what it WILL do before the check runs.
 *
 * It calls mypy's own `process_options` twice with the same arguments: once as given, once with no
 * configuration file. The difference is exactly what the project's configuration changed, so settings
 * mypy derives on its own (colour, interpreter, cache) cancel out. It also reads the files mypy will
 * check for the two things no option shows: `# mypy:` file comments and `# type: ignore` comments.
 *
 * It lives here as a string because the published package ships compiled `.js`, not Python files.
 */
export const PROBE_SCRIPT = String.raw`
import contextlib, io, json, os, re, sys, tokenize, traceback

def emit(value):
    sys.stdout.write(json.dumps(value, default=lambda o: sorted(map(str, o)) if isinstance(o, (set, frozenset)) else repr(o)))
    sys.stdout.flush()

try:
    import mypy.version
    from mypy.main import process_options
    from mypy.util import get_mypy_comments
except BaseException as error:
    emit({"kind": "unavailable", "detail": repr(error)})
    sys.exit(0)

def jsonable(value):
    if isinstance(value, (bool, int, float, str, type(None))):
        return value
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    if isinstance(value, (set, frozenset)):
        return sorted(str(item) for item in value)
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    return repr(value)

def resolve(arguments):
    out, err = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            sources, options = process_options(arguments, require_targets=True)
        return {"sources": sources, "options": options, "stdout": out.getvalue(), "stderr": err.getvalue()}
    except SystemExit as stop:
        return {"stop": stop.code, "stdout": out.getvalue(), "stderr": err.getvalue()}
    except BaseException:
        return {"crash": traceback.format_exc(limit=-3), "stdout": out.getvalue(), "stderr": err.getvalue()}

TYPE_IGNORE = re.compile(r"#\s*type:\s*ignore\b(?:\[([^\]]*)\])?")

def scan(path):
    try:
        with open(path, "rb") as handle:
            data = handle.read()
        text = data.decode("utf-8", errors="replace")
    except OSError as error:
        return {"path": path, "unreadable": repr(error), "ignores": [], "inline": []}
    ignores = []
    try:
        seen_code = False
        for token in tokenize.generate_tokens(io.StringIO(text).readline):
            kind = token.type
            if kind == tokenize.COMMENT:
                found = TYPE_IGNORE.search(token.string)
                if found:
                    codes = None if found.group(1) is None else [c.strip() for c in found.group(1).split(",") if c.strip()]
                    ignores.append({"line": token.start[0], "codes": codes, "top": not seen_code})
            elif kind not in (tokenize.NL, tokenize.NEWLINE, tokenize.ENCODING, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER):
                seen_code = True
    except (tokenize.TokenError, IndentationError, SyntaxError):
        # Unparseable source: fall back to a line scan, which can only over-report.
        ignores = []
        for number, line in enumerate(text.split("\n"), 1):
            found = TYPE_IGNORE.search(line)
            if found:
                codes = None if found.group(1) is None else [c.strip() for c in found.group(1).split(",") if c.strip()]
                ignores.append({"line": number, "codes": codes, "top": False})
    inline = [{"line": number, "text": body} for number, body in get_mypy_comments(text)]
    return {"path": path, "unreadable": None, "ignores": ignores, "inline": inline}

arguments = sys.argv[1:]
# The no-configuration baseline: the same arguments with the configuration file replaced by none.
baseline = []
skip = False
for position, argument in enumerate(arguments):
    if skip:
        skip = False
        continue
    if argument == "--config-file":
        skip = True
        continue
    if argument.startswith("--config-file="):
        continue
    baseline.append(argument)
# Insert the empty config file before the paths, which follow a "--" separator.
separator = baseline.index("--") if "--" in baseline else len(baseline)
baseline = baseline[:separator] + ["--config-file="] + baseline[separator:]

real = resolve(arguments)
if "sources" not in real:
    emit({"kind": "stopped", "code": real.get("stop"), "crash": real.get("crash"), "stdout": real["stdout"], "stderr": real["stderr"],
          "mypyVersion": mypy.version.__version__})
    sys.exit(0)
base = resolve(baseline)
if "sources" not in base:
    emit({"kind": "stopped", "code": base.get("stop"), "crash": base.get("crash"), "stdout": base["stdout"], "stderr": base["stderr"],
          "mypyVersion": mypy.version.__version__})
    sys.exit(0)

options, reference = real["options"], base["options"]
changed = {}
# dir(), not vars(): a compiled mypy's Options has no __dict__.
for name in sorted(dir(options)):
    if name.startswith("_") or name == "per_module_options":
        continue
    value = getattr(options, name)
    if callable(value):
        continue
    if value != getattr(reference, name, None):
        changed[name] = jsonable(value)
sections = {pattern: jsonable(values) for pattern, values in options.per_module_options.items()}
files = [scan(source.path) for source in real["sources"] if source.path]
emit({
    "kind": "facts",
    "mypyVersion": mypy.version.__version__,
    "hostVersion": [sys.version_info[0], sys.version_info[1]],
    "hostPlatform": sys.platform,
    "configFile": options.config_file,
    "stdout": real["stdout"],
    "stderr": real["stderr"],
    "sources": [{"path": source.path, "module": source.module} for source in real["sources"]],
    "changed": changed,
    "sections": sections,
    "files": files,
})
`;
