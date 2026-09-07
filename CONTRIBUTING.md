# Contributing

Open an issue for a reproducible bug or a proposed change. Use synthetic chemical records and redact account/worksheet identifiers. Report vulnerabilities using [SECURITY.md](SECURITY.md), not public bug reports.

Use a branch and pull request. Explain the problem, resulting behavior and relevant checks. Do not change worksheet headings, stable record IDs, token handling, CAS selection or submission behavior without explaining compatibility with existing labs and pending saves. Do not add keys or lab-specific URLs to fixtures.

Run Android unit tests/lint and all four Sheets test suites as described in [README.md](README.md). Changes to storage, navigation, capture or asynchronous draft handling should also be tested on a disposable emulator. Do not run tests against a phone or worksheet holding real inventory.

Keep dependencies and GitHub Actions versions explicit. Use full commit SHAs for Actions, review Dependabot changes, and keep workflow permissions minimal. CI does not need Parley, Google, signing or production credentials. A successful CI check is evidence of those checks only; live recognition and Google deployment need their own verification.

Contributions are made under the repository's [MIT license](LICENSE). Preserve existing third-party notices and attribution. The project does not accept material that contributors are not authorized to share.
