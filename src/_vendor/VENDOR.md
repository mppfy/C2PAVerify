# Vendored Platform Code

Files in this directory are **copy-pasted from the MPPFY platform scaffold** and will be extracted into an `@mppfy/platform-core` npm package in **Phase 2** (W4, after M6 goes live).

## Why vendored temporarily

Path A hybrid bootstrap — target architecture is shared package, but publishing a package before the first service ships adds pre-launch friction. Vendoring lets C2PAVerify ship on time while keeping the extraction path clear.

See `mpp-platform/DECISIONS.md` entry `2026-04-20 — Repo-per-service architecture (Path A hybrid bootstrap)`.

## What's inside

| File | Origin | Purpose |
|------|--------|---------|
| `adapters/types.ts` | `mpp-platform/src/adapters/types.ts` | `PaymentAdapter` interface, `PaymentRequirement`, `PaymentVerification` |
| `adapters/mpp.ts` | `mpp-platform/src/adapters/mpp.ts` | `MPPAdapter` — mppx SDK integration with atomic-charge WeakMap stash |
| `adapters/none.ts` | `mpp-platform/src/adapters/none.ts` | Dev-mode no-op adapter |
| `core/types.ts` | `mpp-platform/src/core/types.ts` | `ServiceEnv`, `ServiceDefinition`, `CallMetrics` |
| `core/define-service.ts` | `mpp-platform/src/core/define-service.ts` | `defineService()` factory |
| `core/observability.ts` | `mpp-platform/src/core/observability.ts` | `wrapHandler()` — metrics → D1 + Analytics Engine |

## Update policy

**Do not modify vendored files in-place.** If a bug is found:
1. Fix in `mpp-platform/src/...` first (source of truth).
2. Copy updated file back to this directory, keeping `// VENDOR:` header.
3. Note in commit message: `chore(vendor): sync <file> from mpp-platform@<commit-sha>`.

**Extraction trigger:** after M6 (this service) is live and M1 implementation begins. That's the point where duplication becomes real pain — two services means any adapter fix is already 2x work.

## Extraction plan (Phase 2, W4)

1. Create `mppfy/platform-core` repo
2. Move code from `mpp-platform/src/{adapters,core}/` into it
3. Publish to GitHub Packages as `@mppfy/platform-core@0.1.0`
4. In this repo: `npm i @mppfy/platform-core`, delete `src/_vendor/`, update imports
5. Verify typecheck + staging deploy still green
6. Commit: `refactor: replace vendored platform code with @mppfy/platform-core`
