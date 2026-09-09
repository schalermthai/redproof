import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseJsonDocument,
  parseJsonPath,
  queryJsonDocument,
  type JsonPathToken,
} from '../../packages/redproof/src/inspect/core/json.ts';

const property = (key: string): JsonPathToken => ({ kind: 'property', key });
const index = (value: number): JsonPathToken => ({ kind: 'index', index: value });
const wildcard: JsonPathToken = { kind: 'wildcard' };

test('the root path selects the document itself', () => {
  assert.deepEqual(parseJsonPath('$'), []);
});

test('dotted, quoted, indexed, and wildcard steps parse in order', () => {
  assert.deepEqual(parseJsonPath('$.scripts.test'), [property('scripts'), property('test')]);
  assert.deepEqual(parseJsonPath('$.scripts["lint:fix"]'), [property('scripts'), property('lint:fix')]);
  assert.deepEqual(parseJsonPath("$['a b']"), [property('a b')]);
  assert.deepEqual(parseJsonPath('$.items[0].name'), [property('items'), index(0), property('name')]);
  assert.deepEqual(parseJsonPath('$.items[*].name'), [property('items'), wildcard, property('name')]);
  assert.deepEqual(parseJsonPath('$.scripts.*'), [property('scripts'), wildcard]);
  assert.deepEqual(parseJsonPath('$.a[12]'), [property('a'), index(12)]);
});

test('a quoted key keeps escaped characters and tolerates spaces inside the brackets', () => {
  assert.deepEqual(parseJsonPath('$["say \\"hi\\""]'), [property('say "hi"')]);
  assert.deepEqual(parseJsonPath('$[ "k" ][ 3 ][ * ]'), [property('k'), index(3), wildcard]);
});

test('a path that is not in the supported subset is rejected with a reason', () => {
  assert.throws(() => parseJsonPath('scripts.test'), /^Error: JSONPath must start with \$\.$/);
  assert.throws(() => parseJsonPath('$..name'), /^Error: Recursive descent \(\.\.\) is not supported by Redproof JSONPath\.$/);
  assert.throws(() => parseJsonPath('$.'), /^Error: Invalid JSONPath near position 2\.$/);
  assert.throws(() => parseJsonPath('$.a.[0]'), /^Error: Invalid JSONPath near position 4\.$/);
  assert.throws(() => parseJsonPath('$[abc]'), /^Error: Invalid JSONPath array index near position 2\.$/);
  assert.throws(() => parseJsonPath('$[-1]'), /^Error: Invalid JSONPath array index near position 2\.$/);
  assert.throws(() => parseJsonPath('$[1'), /^Error: Invalid JSONPath array index near position 2\.$/);
  assert.throws(() => parseJsonPath('$["open'), /^Error: Unterminated quoted JSONPath property\.$/);
  assert.throws(() => parseJsonPath('$["k"x]'), /^Error: Expected \] near position 5\.$/);
  assert.throws(() => parseJsonPath('$["k\\'), /^Error: Invalid JSONPath escape\.$/);
  assert.throws(() => parseJsonPath('$[*x]'), /^Error: Invalid JSONPath wildcard near position 3\.$/);
  assert.throws(() => parseJsonPath('$a'), /^Error: Unsupported JSONPath syntax near position 1: "a"\.$/);
});

test('a property step selects only an existing member of an object', () => {
  const document = { scripts: { test: 'node --test' }, list: [1] };

  assert.deepEqual(queryJsonDocument(document, [property('scripts'), property('test')]).map(match => match.value), ['node --test']);
  assert.deepEqual(queryJsonDocument(document, [property('missing')]), []);
  assert.deepEqual(queryJsonDocument(document, [property('list'), property('0')]), []);
  assert.deepEqual(queryJsonDocument(document, [property('scripts'), property('test'), property('length')]), []);
  assert.deepEqual(queryJsonDocument(null, [property('x')]), []);
});

test('an index step selects only an element inside the array', () => {
  const document = { list: ['a', 'b'], object: { 0: 'zero' } };

  assert.deepEqual(queryJsonDocument(document, [property('list'), index(1)]).map(match => match.value), ['b']);
  assert.deepEqual(queryJsonDocument(document, [property('list'), index(2)]), []);
  assert.deepEqual(queryJsonDocument(document, [property('object'), index(0)]), []);
});

test('a wildcard step fans out over array items and object members in order, and over nothing else', () => {
  const document = { list: ['a', 'b'], object: { x: 1, y: 2 }, scalar: 3 };

  assert.deepEqual(queryJsonDocument(document, [property('list'), wildcard]).map(match => [match.key, match.value]), [[0, 'a'], [1, 'b']]);
  assert.deepEqual(queryJsonDocument(document, [property('object'), wildcard]).map(match => [match.key, match.value]), [['x', 1], ['y', 2]]);
  assert.deepEqual(queryJsonDocument(document, [property('scalar'), wildcard]), []);
  assert.deepEqual(
    queryJsonDocument({ list: [{ name: 'p' }, { other: 1 }, { name: 'q' }] }, [property('list'), wildcard, property('name')]).map(match => match.value),
    ['p', 'q'],
  );
});

test('every selected node reports a canonical path that parses back to the same node', () => {
  const document = { scripts: { 'lint:fix': 'eslint', test: 'node' }, list: [{ name: 'p' }] };
  const paths = queryJsonDocument(document, [property('scripts'), wildcard]).map(match => match.path);

  assert.deepEqual(paths, ['$.scripts["lint:fix"]', '$.scripts.test']);
  assert.deepEqual(queryJsonDocument(document, [property('list'), wildcard, property('name')]).map(match => match.path), ['$.list[0].name']);
  assert.deepEqual(queryJsonDocument(document, []).map(match => match.path), ['$']);

  for (const path of paths) {
    assert.equal(queryJsonDocument(document, parseJsonPath(path)).length, 1, path);
  }
});

test('every selected node carries the parent and key that hold it, and the root has neither', () => {
  const document = { list: ['a'], object: { x: 1 } };

  const [item] = queryJsonDocument(document, [property('list'), index(0)]);
  assert.equal(item?.parent, document.list);
  assert.equal(item?.key, 0);

  const [member] = queryJsonDocument(document, [property('object'), property('x')]);
  assert.equal(member?.parent, document.object);
  assert.equal(member?.key, 'x');

  assert.deepEqual(queryJsonDocument(document, []), [{ value: document, parent: null, key: null, path: '$' }]);
});

test('a JSON document is parsed, and a parse failure names the file', () => {
  assert.deepEqual(parseJsonDocument('a.json', '{"a":[1]}'), { a: [1] });
  assert.throws(() => parseJsonDocument('config/a.json', '{ nope'), /^Error: Could not parse JSON file config\/a\.json: .+/);
});
