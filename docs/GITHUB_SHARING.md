# Sharing and releases

The project repository is [bastenefg/ehs-chem-inventory](https://github.com/bastenefg/ehs-chem-inventory). Source is shared under the [MIT open-source license](../LICENSE), with the maintainer's authorization. The license name does not imply institutional approval. Third-party components retain their own licenses.

## What belongs in the repository

Commit the Android source, Gradle wrapper/build files, Apps Script connector/tests, documentation and synthetic screenshots. Keep `.idea`, local SDK paths, build outputs, logs, old distribution archives, signing keys, device records and lab settings outside Git. The supplied `.gitignore` excludes them; ignoring a file does not remove it from existing Git history.

Before each publication, inspect the exact staged files and run a secret scanner with redacted output. Review findings rather than ignoring whole test/source directories. Do not copy a lab's live Script properties into the repository. This repository does not contain an installer's live Google or Parley authorization.

## Repository controls

The maintainer should enable GitHub private vulnerability reporting, secret scanning/push protection where available, and dependency alerts. These account/repository controls are distinct from the files committed here; a `SECURITY.md` or Dependabot config does not enable all of them automatically. See [GitHub's private-reporting instructions](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

Use reviewed pull requests for changes to `main`. Require the workflow's Sheets and Android checks once they have run successfully in GitHub. Do not claim a CI badge or dependency alert is an independent safety certification. Keep the maintainer's GitHub account protected and review access when collaborators leave.

## Downloadable Android releases

The source repository can be shared without bundling a debug APK. A debug build is marked as such and permits debugger access; it is not a production release. CI deliberately does not publish or sign APKs. The earlier 2.2 pilot remains a local evaluation artifact and predates the 2.2.1 review fixes.

To publish an installable release:

1. Build and test the reviewed source commit. Complete a live setup/scan/save/retry check using a test lab account and disposable worksheet, then document what was tested.
2. In Android Studio, select **Build → Generate Signed App Bundle / APK → APK** and use a private release keystore kept outside this repository. Back up the key and passwords through a maintainer-controlled secure process. Never add them to Git or a public workflow.
3. Verify the resulting APK with `apksigner verify --print-certs`. Confirm the intended version/application ID and that its manifest is not debuggable. Record the signing certificate's SHA-256 and the APK's SHA-256 in release notes alongside the source commit.
4. Publish the APK as an explicitly versioned GitHub Release asset. Include installation instructions, known limitations and the commit used to build it. Keep the same private signing key for subsequent updates.
5. Preserve third-party licenses/notices required by bundled components. AndroidX and OkHttp/Okio use their upstream license terms; the included Gradle wrapper has its own Apache license notice. The project's MIT license does not replace those terms.

A release signed with a different key cannot simply replace the previous debug-signed pilot. Reconcile saved and pending records and plan migration before changing signing identities; do not ask users to uninstall a working app as a shortcut. A release build has not been signed with a new maintainer key during this publication review. [Android signing documentation](https://developer.android.com/studio/publish/app-signing).

## Trust for lab users

Give users the source version, maintainer contact, clear permission/data explanations and a reproducible setup guide. Be explicit that photos go to MIT Parley and chemical names can go to public PubChem. A lab chooses its own Google ownership and sharing. Human chemical review and MIT reporting remain separate obligations; the app does not certify compliance or submit reports automatically.
