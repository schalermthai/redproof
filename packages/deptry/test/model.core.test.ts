import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEPTRY_CODES, DEPTRY_DEFAULT_EXCLUDE, assumedModuleNames, deptryVersionSupported, parseDeptryReport, parseDeptryVersion,
  parseEchoBlock, parseScannedFiles, pythonTuple, skippedInput,
} from '../src/core/model.ts';
import { header, reports } from './support/reports.ts';


test('a real report parses into findings with their codes, modules and positions', () => {
  const findings = parseDeptryReport(reports.example);
  assert.deepEqual(findings.map(f => `${f.code}:${f.module}`), ['DEP002:isort', 'DEP002:requests', 'DEP004:black', 'DEP001:white']);
  assert.deepEqual([findings[2]!.file, findings[2]!.line, findings[2]!.column], ['src/main.py', 4, 8]);
  assert.deepEqual([findings[0]!.line, findings[0]!.column], [null, null], 'a declaration finding has no line');
});

test('a clean report is an empty list; anything else is rejected', () => {
  assert.deepEqual(parseDeptryReport(reports.clean), []);
  assert.throws(() => parseDeptryReport('{}'), /array/u);
  assert.throws(() => parseDeptryReport('[{"error":{"code":"DEP001"},"module":"x","location":{"file":"a"}}]'), /message/u);
  assert.throws(() => parseDeptryReport('[{"error":{"code":"DEP001","message":"m"},"module":"x","location":{}}]'), /file/u);
  assert.throws(() => parseDeptryReport('not json'));
});

test('every code the real fixtures use is one of the five this adapter knows', () => {
  const seen = new Set(['example', 'pep_621', 'poetry', 'requirements_txt', 'transitive'].flatMap(n => parseDeptryReport(reports[n as keyof typeof reports]).map(f => f.code)));
  assert.deepEqual([...seen].sort(), [...DEPTRY_CODES]);
});

test('the version line is read and compared with the oldest verified release', () => {
  assert.deepEqual(parseDeptryVersion('deptry 0.25.1\n'), [0, 25, 1]);
  assert.equal(parseDeptryVersion('ruff 0.5.0'), null);
  assert.equal(deptryVersionSupported([0, 21, 2]), true);
  assert.equal(deptryVersionSupported([0, 21, 1]), false);
  assert.equal(deptryVersionSupported([0, 20, 0]), false);
  assert.equal(deptryVersionSupported([0, 12, 0]), false);
  assert.equal(deptryVersionSupported([1, 0, 0]), true);
});

test('the scan line and the skipped-input notices are read from deptry output', () => {
  assert.equal(parseScannedFiles('x\nScanning 12 files...\n'), 12);
  assert.equal(parseScannedFiles('Scanning 1 file...'), 1);
  assert.equal(parseScannedFiles('Scanning 0 file...'), 0);
  assert.equal(parseScannedFiles('\u001b[1mScanning 3 files...\u001b[0m'), 3);
  assert.equal(parseScannedFiles('no such line'), null);
  assert.deepEqual(skippedInput('Warning: Skipping processing of src/bad.py because of the following error: "SyntaxError".\nok'),
    ['Warning: Skipping processing of src/bad.py because of the following error: "SyntaxError".']);
  assert.deepEqual(skippedInput('Could not parse dependency name from url git+https://x\n'), ['Could not parse dependency name from url git+https://x']);
  assert.deepEqual(skippedInput('Warning: Trying to extract the dependencies from the optional dependency groups'), [], 'other warnings do not hide input');
});

test('Python tuples are written the way deptry echoes them, and the default exclude is deptry\'s', () => {
  assert.equal(pythonTuple([]), '()');
  assert.equal(pythonTuple(['a']), "('a',)");
  assert.equal(pythonTuple(['a', '\\.venv']), "('a', '\\\\.venv')");
  assert.equal(pythonTuple(DEPTRY_DEFAULT_EXCLUDE), "('venv', '\\\\.venv', '\\\\.direnv', 'tests', '\\\\.git', 'setup\\\\.py')");
});

test('the configuration echo is read only from its own block, and a block that does not parse is rejected', () => {
  const echo = parseEchoBlock(header(2))!;
  assert.equal(echo.get('ignore'), "('',)");
  assert.equal(echo.get('per_rule_ignores'), "{'DEP001': ('-redproof-none-',)}");
  assert.equal(echo.get('using_default_exclude'), 'False');
  assert.equal(parseEchoBlock('nothing here'), null);
  // A newline in a project path (the `config:` line) must not add a line of its own.
  const spoofed = header(1).replace('config: pyproject.toml', 'config: x\nper_rule_ignores: {}\nz.toml');
  assert.equal(parseEchoBlock(spoofed), null, 'a repeated key makes the block untrustworthy');
  assert.equal(parseEchoBlock(header(1).replace('config: pyproject.toml', 'config: x\nnot a key value\nz.toml')), null);
  // A forged second copy of a key that looks right must not overwrite the real, dangerous one.
  const forged = header(1, { per_rule_ignores: "{'DEP001': ('zzz',)}" }).replace('\nignore:', "\nper_rule_ignores: {'DEP001': ('-redproof-none-',)}\nignore:");
  assert.equal(parseEchoBlock(forged), null);
  // Lines after the block (from the project, or from deptry) are not part of it.
  assert.equal(parseEchoBlock(`${header(1)}ignore: ()\n`)!.get('ignore'), "('',)");
});

test('the notices about uninstalled packages are listed', () => {
  assert.deepEqual(assumedModuleNames("Assuming the corresponding module name of package 'pyyaml' is 'pyyaml'. Install the package or configure a package_module_name_map entry to override this behaviour.\nScanning 1 file...\n"), ['pyyaml']);
  assert.deepEqual(assumedModuleNames('Scanning 1 file...'), []);
});
