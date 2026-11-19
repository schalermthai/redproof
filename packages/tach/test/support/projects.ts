/** Tiny tach projects, one per behaviour. The same files built `22-tach/battle/make-cases.sh`, whose output the fixtures hold. */
export type Files = Readonly<Record<string, string>>;

const OK_SRC: Files = {
  'src/a/__init__.py': 'from b import thing\n',
  'src/b/__init__.py': 'thing = 1\n',
};
const toml = (body: string): string => `source_roots = ["src"]\n${body}`;
const mods = (a: string, b: string, extra = ''): string => toml(`${extra}[[modules]]\npath = "a"\n${a}\n[[modules]]\npath = "b"\n${b}\n`);

export const projects = {
  ok: { ...OK_SRC, 'tach.toml': mods('depends_on = ["b"]', 'depends_on = []') },
  undeclared: { ...OK_SRC, 'tach.toml': mods('depends_on = []', 'depends_on = []') },
  forbidden: { ...OK_SRC, 'tach.toml': mods('depends_on = ["b"]\ncannot_depend_on = ["b"]', 'depends_on = []') },
  deprecated: { ...OK_SRC, 'tach.toml': mods('depends_on = [{ path = "b", deprecated = true }]', 'depends_on = []') },
  layer: { ...OK_SRC, 'tach.toml': mods('layer = "low"', 'layer = "high"', 'layers = ["high", "low"]\n') },
  'closed-layer': {
    'tach.toml': toml('layers = ["top", { name = "mid", closed = true }, "bottom"]\n[[modules]]\npath = "a"\nlayer = "top"\n[[modules]]\npath = "m"\nlayer = "mid"\n[[modules]]\npath = "b"\nlayer = "bottom"\n'),
    ...OK_SRC, 'src/m/__init__.py': 'x = 1\n',
  },
  interface: {
    ...OK_SRC, 'src/b/__init__.py': 'def public_fn(): ...\nthing = 1\n',
    'tach.toml': `${mods('depends_on = ["b"]', 'depends_on = []')}[[interfaces]]\nexpose = ["public_fn"]\nfrom = ["b"]\n`,
  },
  'data-type': {
    ...OK_SRC, 'src/b/__init__.py': 'def thing(x: dict) -> object: ...\n',
    'tach.toml': `${mods('depends_on = ["b"]', 'depends_on = []')}[[interfaces]]\nexpose = ["thing"]\nfrom = ["b"]\ndata_types = "primitive"\n`,
  },
  'unnecessary-ignore': { ...OK_SRC, 'src/a/__init__.py': '# tach-ignore\nfrom b import thing\n', 'tach.toml': mods('depends_on = ["b"]', 'depends_on = []') },
  'missing-reason': {
    ...OK_SRC, 'src/a/__init__.py': 'from b import thing  # tach-ignore\n',
    'tach.toml': mods('depends_on = []', 'depends_on = []', '[rules]\nrequire_ignore_directive_reasons = "error"\n'),
  },
  cycle: {
    ...OK_SRC, 'tach.toml': `${toml('forbid_circular_dependencies = true\n')}[[modules]]\npath = "a"\ndepends_on = ["b"]\n[[modules]]\npath = "b"\ndepends_on = ["a"]\n`,
  },
  visibility: { ...OK_SRC, 'tach.toml': mods('depends_on = ["b"]', 'depends_on = []\nvisibility = ["c"]') },
  'syntax-error': { ...OK_SRC, 'tach.toml': mods('depends_on = ["b"]', 'depends_on = []'), 'src/a/bad.py': 'def broken(:\n' },
  'no-python': { 'tach.toml': toml('[[modules]]\npath = "a"\n'), 'src/.keep': '' },
  'bad-toml': { 'tach.toml': '[[modules\n', 'src/.keep': '' },
} as const satisfies Record<string, Files>;

export type ProjectName = keyof typeof projects;
