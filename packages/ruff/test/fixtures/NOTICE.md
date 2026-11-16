# Fixture notice

`F401_0.py`, `F401_5.py`, `S101.py`, `SIM111.py`, `PYI001.pyi` and `B018.ipynb` are copied unchanged from
[astral-sh/ruff](https://github.com/astral-sh/ruff), `crates/ruff_linter/resources/test/fixtures/`, commit
`d3e454ea7c0ac0f51077b6f7b4e88e1bf35e40a1`, which is distributed under the MIT License
(Copyright (c) 2022 Charles Marsh). They are used only as test inputs.

The `*.report.json` files are real output of `ruff check --isolated --output-format json` (Ruff 0.17.5) on those
inputs, with the absolute directory replaced by `<ROOT>`. `F401_single.py` and `syntax_error.py` were written for these tests.
