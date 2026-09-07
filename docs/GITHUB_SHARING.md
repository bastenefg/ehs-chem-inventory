# Sharing and releases

The project repository is [bastenefg/ehs-chem-inventory](https://github.com/bastenefg/ehs-chem-inventory). Source is shared under the [MIT open-source license](../LICENSE), with the maintainer's authorization. The license name does not imply institutional approval. Third-party components retain their own licenses.

## What belongs in the repository

Commit the Android source, Gradle wrapper/build files, Apps Script connector/tests, documentation and synthetic screenshots. Keep `.idea`, local SDK paths, build outputs, logs, old distribution archives, signing keys, device records and lab settings outside Git. The supplied `.gitignore` excludes them; ignoring a file does not remove it from existing Git history.

Before each publication, inspect the exact staged files and run a secret scanner with redacted output. Review findings rather than ignoring whole test/source directories. Do not copy a lab's live Script properties into the repository. This repository does not contain an installer's live Google or Parley authorization.

## Repository controls

GitHub private vulnerability reporting, secret scanning, push protection and dependency alerts were enabled and verified when the source was published. Keep them enabled. These account/repository controls are distinct from the files committed here; a `SECURITY.md` or Dependabot config does not enable them automatically. See [GitHub's private-reporting instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

Use reviewed pull requests for changes to `main`. Require the workflow's Sheets and Android checks once they have run successfully in GitHub. Do not claim a CI badge or dependency alert is an independent safety certification. Keep the maintainer's GitHub account protected and review access when collaborators leave.

## Downloadable Android releases

Version [2.2.2](https://github.com/bastenefg/ehs-chem-inventory/releases/tag/v2.2.2) is the first downloadable, non-debug APK signed with the maintainer's dedicated release key. It is a lab pilot. Users follow the [Android installation guide](ANDROID_INSTALL.md), with no app build required. CI compiles an unsigned release and deliberately does not receive signing material or publish APKs. Earlier debug APKs remain local evaluation artifacts.

To publish an installable release:

1. Build and test the reviewed source commit. Include live setup/scan/save/retry checks using a test lab account and disposable worksheet when those accounts are available. Document precisely which checks were performed and any remaining live checks; offline tests cannot stand in for service access. The first public APK's limits are recorded in [validation notes](VALIDATION.md).
2. Use the established release keystore in Android Studio's **Build → Generate Signed App Bundle / APK → APK**, or the local [signing helper and backup procedure](MAINTAINER_SIGNING.md). Back up the key and passwords through a maintainer-controlled secure process. Never add them to Git or a public workflow.
3. Verify the resulting APK with `apksigner verify --print-certs`. Confirm the intended version/application ID and that its manifest is not debuggable. Record the signing certificate's SHA-256 and the APK's SHA-256 in release notes alongside the source commit.
4. Publish the APK as an explicitly versioned GitHub Release asset. Include installation instructions, known limitations and the commit used to build it. Keep the same private signing key for subsequent updates.
5. Preserve and refresh the [third-party notices](../THIRD_PARTY_NOTICES.md) and license assets whenever runtime dependencies change. The project's MIT license does not replace upstream terms.

A release signed with a different key cannot simply replace the previous debug-signed pilot. Reconcile saved and pending records and follow the [migration instructions](ANDROID_INSTALL.md#already-have-a-pilot-copy-installed) before changing signing identities. Keep the dedicated release key for later compatible APK updates. [Android signing documentation](https://developer.android.com/studio/publish/app-signing).

## Trust for lab users

Give users the source version, maintainer contact, clear permission/data explanations and a reproducible setup guide. Be explicit that photos go to MIT Parley and chemical names can go to public PubChem. A lab chooses its own Google ownership and sharing. Human chemical review and MIT reporting remain separate obligations; the app does not certify compliance or submit reports automatically.
