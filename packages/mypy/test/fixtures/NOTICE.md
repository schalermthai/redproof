# Fixture notice

`cases.json` holds one minimal violating program and its fix per mypy error code. The programs were written for these
tests and were checked against mypy 2.4.1 and a 2.5 development build (`26-mypy/battle/corpus.py`).

`probe-*.json` and `run-*.json` are real output of the adapter's own probe and of `mypy --output json` (mypy 2.4.1,
Python 3.15, macOS) on the tiny projects listed in `26-mypy/battle/capture.ts`, with the absolute directory replaced by `<ROOT>`.
Both tools are released under the MIT License (mypy: Copyright (c) 2012-present Jukka Lehtosalo and contributors).
