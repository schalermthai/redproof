# Claude session-only loading

- Test date: 2026-09-30.
- Host: Claude Code 2.1.285.
- Bundle inventory SHA-256: `e5184374ba7d1bdce06d8c315b13b4a6c4cbc6c883cf3307bb5639374dccc01a`.
- Candidate: generated preview retaining version 0.1.0, not the published artifact.
- Setup: empty disposable project and isolated `CLAUDE_CONFIG_DIR`.

| Check | Result |
| --- | --- |
| Native strict manifest validation | PASS |
| Startup with `claude --plugin-dir <bundle>` | Loaded Redproof and all five skills |
| Control startup without the flag | Loaded zero plugin skills |
| Persistent plugin list before and after | Empty; no persistent installation |

Startup stopped at sign-in. No login, skill invocation or model prompt was
submitted. No credentials were copied or normal-profile settings changed.
The optional Python validator was unavailable because PyYAML was absent.

This verifies startup loading and non-persistence only. It does not establish
authenticated workflow behavior or refresh release readiness. The preview must
not replace the published 0.1.0 bundle.
