# Fixtures

`*.report.json` and `bad-toml.report.txt` are the real, unedited stdout of `tach check --output json`
(tach 0.35.3, Python 3.15.2) on the tiny projects built by `22-tach/battle/make-cases.sh`, whose files are the
same ones `test/support/projects.ts` writes. `many-features.report.json` is tach's own
`python/tests/example/many_features` project (commit 7c27c81, gauge-sh/tach). That file is a copy of tach's output on tach's own test project. tach is MIT licensed (`pyproject.toml`: `License :: OSI Approved :: MIT License`); its `LICENSE` file, which names no copyright holder, reads verbatim:

```
Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```
