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
 * file-level options, `# type: ignore` comments, and `@no_type_check` (mypy skips such a body silently), all taken from mypy's
 * own parse of the file, never from a second lexer.
 * It also walks the named paths on its own, without mypy's discovery rules, to list every Python file the Gate promised.
 */
export const CLOSURE_SCRIPT = String.raw`
import contextlib, io, json, os, sys

def emit(value):
    sys.stdout.write(json.dumps(value))
    sys.stdout.flush()

try:
    import mypy.version
    from mypy import build
    from mypy.errors import CompileError
    from mypy.main import process_options
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

NO_TYPE_CHECK = ("typing.no_type_check", "typing_extensions.no_type_check")

def resolved_no_type_check(tree):
    """Decorators mypy RESOLVED to typing.no_type_check, however they were imported or re-exported. Walks the
    statement containers by name because a compiled mypy's visitor classes cannot be subclassed from Python."""
    from mypy.nodes import CallExpr, ClassDef, Decorator, Node, RefExpr
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
        if isinstance(node, ClassDef) and any(refers(d) for d in node.decorators):
            lines.append(node.line)
        for name in ("defs", "body", "else_body", "finally_body", "handlers", "bodies", "items", "impl", "func"):
            child = getattr(node, name, None)
            if child is not None:
                walk(child)
    walk(tree)
    return sorted(set(lines))

def has_code_lines(path):
    """True when some line holds anything but whitespace or a comment. Only used to tell a module mypy emptied from one that was
    empty to begin with, and only ever in the direction of refusing: any doubt (another encoding, odd bytes) reads as code."""
    try:
        with open(path, "rb") as handle:
            data = handle.read()
    except OSError:
        return True
    for line in data.replace(b"\r", b"\n").split(b"\n"):
        stripped = line.strip()
        if stripped and not stripped.startswith(b"#"):
            return True
    return False

def whole_file_ignored(tree, path):
    """A type: ignore before the first statement skips the whole module. mypy 1.11 keeps the body as an unreachable block; mypy 2.x
    keeps no body at all, so a module with no statements whose file still holds code is the same thing."""
    from mypy.nodes import Block
    body = tree.defs
    if len(body) == 1 and isinstance(body[0], Block) and bool(getattr(body[0], "is_unreachable", False)):
        return True
    return len(body) == 0 and has_code_lines(path)

def judge(state):
    """Everything the adapter knows about one loaded file comes from mypy's own parse of it: no second lexer, no second decoder."""
    tree = state.tree
    if tree is None:
        return {"unjudgeable": "mypy did not keep the parsed tree of this file", "ignores": [], "wholeFile": False, "inlineOptions": [], "noTypeCheck": []}
    try:
        recorded = dict(tree.ignored_lines)
    except AttributeError:
        return {"unjudgeable": "this mypy does not record ignored_lines on its parsed tree", "ignores": [], "wholeFile": False, "inlineOptions": [], "noTypeCheck": []}
    ignores = []
    for line, codes in sorted(recorded.items()):
        kept = [c for c in codes if c]
        # No codes, or only empty ones: mypy treats the comment as a bare ignore.
        ignores.append({"line": line, "codes": kept if kept else None})
    reference = options.clone_for_module(state.id)
    inline = [name for name in sorted(dir(state.options))
              if not name.startswith("_") and not callable(getattr(state.options, name))
              and getattr(state.options, name) != getattr(reference, name, None)]
    return {"unjudgeable": None, "ignores": ignores, "wholeFile": whole_file_ignored(tree, state.path), "inlineOptions": inline, "noTypeCheck": resolved_no_type_check(tree)}

# What mypy reports errors for is mypy's own call (ignore_all is False), not a list of directory names kept here:
# installed packages, typeshed and silent imports are ignore_all; everything else, dist-packages included, is checked.
modules = []
for name, state in sorted(result.graph.items()):
    path = state.path
    if not path or state.ignore_all or not os.path.isfile(path):
        continue
    modules.append({"module": name, "path": os.path.abspath(path), "stub": bool(getattr(state.tree, "is_stub", False)), **judge(state)})

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
