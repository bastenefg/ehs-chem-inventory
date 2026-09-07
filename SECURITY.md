# Security policy

ChemInventory is a lab-developed inventory tool. Source availability and passing tests help review it; they are not an independent security certification or MIT approval. The current source is 2.2.1. Older pilot APKs do not receive fixes automatically.

## Report a vulnerability privately

Use **Security → Advisories → Report a vulnerability** in [bastenefg/ehs-chem-inventory](https://github.com/bastenefg/ehs-chem-inventory/security/advisories) when private reporting is enabled. If that button is unavailable, open an issue asking the maintainer for a private reporting channel, without including exploit details, lab identities or credentials. Do not assume a public issue is confidential. The maintainer is [@bastenefg](https://github.com/bastenefg); no response-time guarantee is offered.

Include the app version, affected source file or behavior, impact, and steps using synthetic data. Never attach a Parley key, worksheet token, Script properties dump, real inventory or private bottle photo. If a credential was exposed, revoke/rotate it with its service owner; deleting a post or commit alone does not revoke it.

## Boundaries to understand

- Each phone uses its owner's Parley key. The app sends Parley requests only to `parley.api.mit.edu` over HTTPS and does not follow Parley redirects. MIT controls that service's models and retention.
- Google authorization uses only `drive.file`. The lab's Apps Script deployment executes as its owner and authenticates app requests with a shared bearer token. Possession of both its URL and token permits appends; it does not establish which rep sent a row. Script editors can read the token and change the backend. Use a separate project/worksheet per lab.
- The endpoint is publicly reachable because the Android app does not use Google browser sign-in. Invalid requests can consume Apps Script quota. The connector is not a substitute for an institutional service that requires per-user authentication, audit attribution or stronger availability controls.
- Do not repoint an existing deployment to another lab's worksheet. The app binds a pending record to its deployment URL, but a changed returned Sheet ID is detected after sending. Verify and save setup after owner-approved recovery, before sending new rows.
- Keys/settings use Android Keystore-backed AES-GCM. Inventory records are in app-private storage and excluded from backups, but are not separately encrypted by this app. Temporary-photo deletion is best effort. A compromised/unlocked device, trusted debugger or account owner is outside these protections.
- Public PubChem receives the chemical name when lookup is enabled. A CAS match is evidence for review, not proof of identity. Multiple/conflicting label numbers and mixtures remain for manual review. Human confirmation is required before sending.

The app requests Internet and Camera permissions, uses Android's system picker for individually selected files, and does not request contacts, microphone, location or broad storage access. See the full [data handling statement](docs/PRIVACY.md) and [verification record](docs/VALIDATION.md).

## Builds and updates

Build from a reviewed commit using the included Gradle wrapper. GitHub Actions checks source with read-only repository permissions and requires no lab credentials. Dependency-update proposals still need review and testing.

Pilot debug APKs are for evaluation. For distribution, use a non-debug release signed with a privately managed maintainer key, publish the APK SHA-256 and signing-certificate SHA-256, and use the same key for updates. A checksum verifies matching bytes; it does not establish that the app is secure or that MIT endorses it. See [release and repository guidance](docs/GITHUB_SHARING.md).
