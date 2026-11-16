/**
 * The Python the shell runs, in isolated mode, to ask mypy what it WILL do before the check runs.
 *
 * It calls mypy's own `process_options` twice with the same arguments: once as given, once with no
 * configuration file. The difference is exactly what the project's configuration changed, so settings
 * mypy derives on its own (colour, interpreter, cache) cancel out.
 *
 * It lives here as a string because the published package ships compiled `.js`, not Python files.
 */
export const PROBE_SCRIPT = String.raw`
import contextlib, io, json, sys, traceback

def emit(value):
    sys.stdout.write(json.dumps(value, default=lambda o: sorted(map(str, o)) if isinstance(o, (set, frozenset)) else repr(o)))
    sys.stdout.flush()

try:
    import mypy.version
    from mypy.main import process_options
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
})
`;

/**
 * The second Python the shell runs, after the configuration was judged: it builds the program the way mypy will and
 * reports everything mypy LOADED (not only the files named), so what mypy checked can be compared with what the Gate
 * promised. For every loaded file that is not typeshed or an installed package it reads what no option shows:
 * `# mypy:` file comments, `# type: ignore` comments, and `@no_type_check` (mypy skips such a body silently).
 * It also walks the named paths on its own, without mypy's discovery rules, to list every Python file the Gate promised.
 */
export const CLOSURE_SCRIPT = String.raw`
import ast, contextlib, io, json, os, re, sys, tokenize

def emit(value):
    sys.stdout.write(json.dumps(value))
    sys.stdout.flush()

try:
    import mypy.version
    from mypy import build
    from mypy.errors import CompileError
    from mypy.main import process_options
    from mypy.util import get_mypy_comments
except BaseException as error:
    emit({"kind": "unavailable", "detail": repr(error)})
    sys.exit(0)

arguments = sys.argv[1:]
named = arguments[arguments.index("--") + 1:] if "--" in arguments else []
out, err = io.StringIO(), io.StringIO()
try:
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        sources, options = process_options(arguments, require_targets=True)
except SystemExit as stop:
    emit({"kind": "stopped", "code": stop.code, "stdout": out.getvalue(), "stderr": err.getvalue()})
    sys.exit(0)
options.preserve_asts = True
try:
    result = build.build(sources, options, stdout=io.StringIO(), stderr=io.StringIO())
except CompileError as error:
    emit({"kind": "blocked", "messages": [str(m) for m in list(error.messages)[:5]]})
    sys.exit(0)

TYPE_IGNORE = re.compile(r"#\s*type:\s*ignore\b(?:\[([^\]]*)\])?")
CODE = re.compile(r"^[a-z][a-z0-9-]*$")
def codes_of(found):
    # An empty or odd list ([], [ ], [,], [Bad Code]) is judged like a bare ignore: it must never read as "hides nothing".
    if found.group(1) is None:
        return None
    codes = [c.strip() for c in found.group(1).split(",")]
    return codes if codes and all(CODE.match(c) for c in codes) else None

NO_TYPE_CHECK = ("typing.no_type_check", "typing_extensions.no_type_check")

def resolved_no_type_check(tree):
    """Decorators mypy RESOLVED to typing.no_type_check, however they were imported or re-exported. Walks the
    statement containers by name because a compiled mypy's visitor classes cannot be subclassed from Python."""
    from mypy.nodes import Decorator, Node, RefExpr, CallExpr
    lines, seen = [], set()
    def refers(expr):
        if isinstance(expr, CallExpr):
            expr = expr.callee
        if not isinstance(expr, RefExpr):
            return False
        node = getattr(expr, "node", None)
        return getattr(expr, "fullname", None) in NO_TYPE_CHECK or getattr(node, "fullname", None) in NO_TYPE_CHECK
    def walk(node):
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, Node) or id(node) in seen:
            return
        seen.add(id(node))
        if isinstance(node, Decorator):
            decorators = getattr(node, "original_decorators", None) or node.decorators
            if any(refers(d) for d in decorators):
                lines.append(node.func.line)
        for name in ("defs", "body", "else_body", "finally_body", "handlers", "bodies", "items", "impl", "func"):
            child = getattr(node, name, None)
            if child is not None:
                walk(child)
    walk(tree)
    return lines

def no_type_check_names(tree):
    names = {"no_type_check"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name == "no_type_check" and alias.asname:
                    names.add(alias.asname)
    return names

def no_type_check_lines(text):
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return []
    names = no_type_check_names(tree)
    lines = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            for decorator in node.decorator_list:
                target = decorator.func if isinstance(decorator, ast.Call) else decorator
                name = target.id if isinstance(target, ast.Name) else target.attr if isinstance(target, ast.Attribute) else None
                if name in names:
                    lines.append(decorator.lineno)
    return lines

def scan(path, tree=None):
    try:
        with open(path, "rb") as handle:
            text = handle.read().decode("utf-8", errors="replace")
    except OSError as error:
        return {"unreadable": repr(error), "ignores": [], "inline": [], "noTypeCheck": []}
    ignores = []
    try:
        seen_code = False
        for token in tokenize.generate_tokens(io.StringIO(text).readline):
            if token.type == tokenize.COMMENT:
                found = TYPE_IGNORE.search(token.string)
                if found:
                    ignores.append({"line": token.start[0], "codes": codes_of(found), "top": not seen_code})
            elif token.type not in (tokenize.NL, tokenize.NEWLINE, tokenize.ENCODING, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER):
                seen_code = True
    except (tokenize.TokenError, IndentationError, SyntaxError):
        ignores = []
        for number, line in enumerate(text.split("\n"), 1):
            found = TYPE_IGNORE.search(line)
            if found:
                ignores.append({"line": number, "codes": codes_of(found), "top": False})
    return {
        "unreadable": None,
        "ignores": ignores,
        "inline": [{"line": number, "text": body} for number, body in get_mypy_comments(text)],
        "noTypeCheck": sorted(set(no_type_check_lines(text)) | set(resolved_no_type_check(tree) if tree is not None else [])),
    }

# What mypy reports errors for is mypy's own call (ignore_all is False), not a list of directory names kept here:
# installed packages, typeshed and silent imports are ignore_all; everything else, dist-packages included, is checked.
modules = []
for name, state in sorted(result.graph.items()):
    path = state.path
    if not path or state.ignore_all or not os.path.isfile(path):
        continue
    modules.append({"module": name, "path": os.path.abspath(path), "stub": bool(getattr(state.tree, "is_stub", False)), **scan(path, state.tree)})

# Every Python file under a named directory is promised: no skip list, so what mypy's own discovery leaves out is found, not assumed.
promised = []
for item in named:
    if os.path.isdir(item):
        for directory, children, files in os.walk(item):
            children.sort()
            for file in sorted(files):
                if file.endswith((".py", ".pyi")):
                    promised.append(os.path.abspath(os.path.join(directory, file)))
    elif os.path.isfile(item):
        promised.append(os.path.abspath(item))
emit({"kind": "closure", "mypyVersion": mypy.version.__version__, "modules": modules, "promised": promised})
`;
