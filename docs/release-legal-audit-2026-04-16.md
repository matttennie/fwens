# Release Legal Audit — 2026-04-16

Project: `fwens`
Scope: repository license, package metadata, dependency licenses, contribution/security docs, source header convention, and copied-code indicators

## Summary

Status: not ready for a public GitHub release without documentation and metadata cleanup.

Blocking findings:

1. `package.json`, `packages/cli/package.json`, and `packages/server/package.json` do not declare a `license` field even though the repo ships an MIT `LICENSE` file.
2. `CONTRIBUTING.md` does not reference a code of conduct or any contributor behavior policy, and there is no `CODE_OF_CONDUCT.md`.
3. `SECURITY.md` explains reporting, but it does not define a response timeline or supported versions.

Non-blocking findings:

1. No copyleft dependency licenses were found in installed dependencies.
2. Source files appear to follow a repo-wide "no per-file license header" convention consistently.
3. No obvious copied-code attribution markers were found in the source tree.
4. Package metadata is thin for a public project: `description`, `repository`, `author`, and `keywords` are absent from all package manifests.

## Findings

### 1. LICENSE file exists and is MIT, but manifests do not match it

- [LICENSE](/LICENSE:1) contains a standard MIT license grant and copyright notice.
- [package.json](/package.json:1) has no `license` field.
- [packages/cli/package.json](/packages/cli/package.json:1) has no `license` field.
- [packages/server/package.json](/packages/server/package.json:1) has no `license` field.

Recommendation:

- Add `"license": "MIT"` to all three manifests.
- For a public GitHub release, also add `repository`, `description`, `author`, and `keywords` fields. Keeping `private: true` is fine if npm publication is not intended.

### 2. Dependency license review

Method:

- Reviewed `npm ls --all --json`.
- Walked installed package manifests in `node_modules` and workspace `node_modules` directories.
- Checked `package-lock.json` package metadata for declared licenses.

Result:

- No installed dependency declared GPL, AGPL, LGPL, SSPL, CPAL, EPL, MPL, or CDDL.
- One missing license entry was found in `node_modules/github-from-package/example/package.json`, package name `beep-boop@1.2.3`. This is an example fixture from a transitive dependency, not a shipped runtime dependency for `fwens`.

Assessment:

- No current blocker from dependency copyleft licensing was found.
- The only missing license signal found appears limited to test/example material inside a dependency package.

Recommendation:

- Treat dependency licensing as acceptable for MIT distribution based on the current installed tree.
- If you want stricter release hygiene, add a repeatable dependency-license audit step in CI using a dedicated license scanner.

### 3. CONTRIBUTING.md is present but incomplete for public collaboration

- [CONTRIBUTING.md](/CONTRIBUTING.md:1) covers setup, testing, PR flow, and code style.
- It does not reference a code of conduct.
- `CODE_OF_CONDUCT.md` is missing from the repository root.

Recommendation:

- Add a `CODE_OF_CONDUCT.md` file.
- Update `CONTRIBUTING.md` to link to it and to state expected review/PR workflow more explicitly.

### 4. SECURITY.md is present but incomplete

- [SECURITY.md](/SECURITY.md:1) includes a threat model, hardening notes, and reporting guidance.
- [SECURITY.md](/SECURITY.md:16) does not state supported versions.
- [SECURITY.md](/SECURITY.md:16) does not state an expected response timeline or acknowledgement SLA.

Recommendation:

- Add a supported-versions section.
- Add an expected acknowledgement window and update cadence for reporters.
- Prefer one clear private reporting channel if GitHub private vulnerability reporting is intended.

### 5. Source-file license header convention

- No source files under `packages/` contain SPDX or copyright headers.
- This appears consistent across the project rather than accidental drift.

Assessment:

- This is acceptable for an MIT-licensed TypeScript project as long as the repository-level `LICENSE` file is present.

Recommendation:

- No change required unless you want an explicit SPDX-header policy.

### 6. README completeness

- [README.md](/README.md:20) includes a quick start.
- [README.md](/README.md:40) includes CLI setup instructions.
- [README.md](/README.md:179) includes a command reference.
- [README.md](/README.md:211) includes a license section.
- `README.md` does not link to `CONTRIBUTING.md`.
- `README.md` does not include a dedicated installation section for users who want to install from npm or from source before configuring CLIs.

Recommendation:

- Add a short install section near the top.
- Add a contributing link near the end or in a "Project" section.

### 7. Copied-code / attribution scan

Method:

- Searched the repo for markers such as `copied from`, `adapted from`, `based on`, `source:`, `stackoverflow`, `github.com/`, `TODO`, and license header strings outside `node_modules`.

Result:

- No obvious copied-code attribution markers were found in the source tree.
- Matches were limited to normal documentation links, the project `LICENSE`, and generated/package-lock metadata.

Assessment:

- No clear evidence of copied third-party code needing attribution was found in this pass.

## Recommended release checklist

1. Add `"license": "MIT"` to root and workspace `package.json` files.
2. Add `description`, `repository`, `author`, and `keywords` to root and package manifests.
3. Add `CODE_OF_CONDUCT.md` and link it from `CONTRIBUTING.md`.
4. Expand `SECURITY.md` with supported versions and a response timeline.
5. Add install and contributing links to `README.md`.
