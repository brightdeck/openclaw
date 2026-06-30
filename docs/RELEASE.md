# Release process

Maintainer-only documentation for shipping a new version of
`@brightdeck/openclaw-deck` to [ClawHub](https://clawhub.ai/brightdeck/openclaw-deck).

End-users do not need to read this. See the [README](../README.md) for
install instructions.

## Prerequisites (one-time)

1. **Install the ClawHub CLI.**
   ```bash
   npm i -g clawhub
   ```
2. **Authenticate.**
   ```bash
   clawhub login
   ```
   Opens a browser to authenticate against your Brightdeck publisher
   account. CI uses `clawhub login --token clh_...` with a token stored
   securely by the org.
3. **Verify publisher membership.**
   ```bash
   clawhub whoami
   ```
   Must list `brightdeck` under publishers.

## Per-release checklist

### 1. Branch

```bash
git checkout -b release/<X.Y.Z>
```

### 2. Bump version

The version lives in **two** files that must stay in lockstep — bump
**both** per [SemVer](https://semver.org/):

- `package.json` (`version`) — **the source of truth for the published
  manifest.** `openclaw plugins build` copies this field verbatim into the
  generated `openclaw.plugin.json` `version`, so the manifest tracks
  `package.json` automatically **as long as you rebuild** (§4/§5) before
  publishing.
- `src/config.ts` (`PLUGIN_VERSION`) — the MCP client version sent in the
  `initialize` handshake. The build does **not** read this; it's a separate
  hand-maintained constant, so bump it in lockstep or the handshake version
  disagrees with the package.

SemVer guidance:

- **Patch** (`0.1.0 → 0.1.1`): bug fixes, no API surface changes.
- **Minor** (`0.1.0 → 0.2.0`): new tools or new optional parameters.
- **Major** (`0.1.0 → 1.0.0`): breaking changes — removed tools,
  removed parameters, removed scopes, or anything that requires the
  paired CIMD doc on the deck backend to bump its `software_version`
  in lockstep.

### 3. Update the changelog

Move everything under `[Unreleased]` in `CHANGELOG.md` to a new
`[<X.Y.Z>] — YYYY-MM-DD` section. Keep the sub-headings
(`### Added`, `### Changed`, `### Fixed`, `### Removed`,
`### Security`) per [Keep-a-Changelog](https://keepachangelog.com/en/1.1.0/).

If `[Unreleased]` is empty, that's a sign you forgot to record changes
during development — go back and fill it in by reading `git log` since
the last tag.

### 4. Clean build + tests

```bash
pnpm clean
pnpm install --frozen-lockfile
pnpm run audit-public
pnpm lint
pnpm build
pnpm run check-version
pnpm test
```

All six steps must pass before continuing. `pnpm run check-version`
(`scripts/check-version-sync.mjs`) fails unless `package.json`, `src/config.ts`
`PLUGIN_VERSION`, the version baked into the freshly built `dist/index.js`, and
the generated `openclaw.plugin.json` all match — it is the guard against
publishing a **stale bundle** under a new version number (the 0.3.0 failure
mode). Because ClawHub's publish (§8) runs no npm lifecycle scripts, this manual
run before §8 is the only thing that catches a stale `dist/` for the ClawHub
artifact.

> **Invariant — no runtime dependencies.** `pnpm build` **bundles** all third-party
> libraries (`@modelcontextprotocol/sdk`, `typebox`, `zod`, …) into a single
> self-contained `dist/index.js`; `openclaw` stays the only `peerDependency`. The
> published `package.json` MUST have an empty/absent `dependencies` block. If it
> lists any runtime dependency, OpenClaw runs `npm install` at install time, which
> materializes a real `node_modules/openclaw` and breaks the peer-dependency
> symlink (install fails + rolls back). Verify before publishing:
>
> ```bash
> node -e "const p=require('./package.json');if(Object.keys(p.dependencies||{}).length||Object.keys(p.optionalDependencies||{}).length){console.error('FAIL: runtime dependencies present');process.exit(1)}console.log('OK: no runtime dependencies')"
> ```

### 5. Validate against the OpenClaw SDK

```bash
openclaw plugins build --entry ./dist/index.js
openclaw plugins validate --entry ./dist/index.js
clawhub package validate .
```

`openclaw plugins validate` catches manifest ↔ runtime parity issues
(missing tool registrations, config-schema drift, peer-dep version
mismatches) that the unit tests don't. `clawhub package validate .` runs
the ClawHub Plugin Inspector locally and must report `Warnings: 0` — it is
what flags `package-manifest-version-drift` when `package.json` and the
generated `openclaw.plugin.json` disagree.

> **Guard.** `package.json` defines a `prepublishOnly` script
> (`pnpm run build && pnpm run validate`), so **`pnpm publish` (§9)
> auto-regenerates and revalidates the manifest** — npm can no longer ship
> a stale one. ClawHub's `clawhub package publish` (§8) packs the working
> tree directly and does **not** run npm lifecycle scripts, so you must
> still run §4/§5 by hand before §8. (This guard exists because 0.3.0
> shipped a stale `0.2.1` manifest — see the CHANGELOG `[0.3.1]` entry.)

### 6. Dry-run publish

```bash
clawhub package publish . \
  --family code-plugin \
  --owner brightdeck \
  --version <X.Y.Z> \
  --changelog "Short summary copied from CHANGELOG.md" \
  --tags "automation,presentations,brightdeck,latest" \
  --dry-run
```

The output must report `passed`. Fix any flagged issues before
proceeding. Common dry-run failures:

- `Fail: missing LICENSE` — the LICENSE file drifted from canonical
  Apache-2.0. Re-paste from
  https://www.apache.org/licenses/LICENSE-2.0.txt.
- `Warn: outbound network call to api.brightdeck.ai` — expected. ClawScan
  derives this automatically; there is no publish-time note field. If the
  human reviewer flags it, point them at the
  [SECURITY.md](../SECURITY.md) network-egress disclosure.

### 7. Tag + push

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): v<X.Y.Z>"
git push origin release/<X.Y.Z>
gh pr create --base main --title "release: v<X.Y.Z>"
```

After PR review + merge:

```bash
git checkout main && git pull
git tag v<X.Y.Z>
git push --tags
```

### 8. Real publish to ClawHub

```bash
clawhub package publish . \
  --family code-plugin \
  --owner brightdeck \
  --version <X.Y.Z> \
  --changelog "Short summary copied from CHANGELOG.md" \
  --tags "automation,presentations,brightdeck,latest"
```

ClawScan status progresses `Pending` → `Pass` (or `Review` → `Pass`
after a human gate). Watch the publish output for the final status.

### 9. Publish to npm

```bash
pnpm publish --access public
```

This pushes the package to the npm registry under
`@brightdeck/openclaw-deck`. Required for users who install via
`pnpm add` / `npm install` rather than `openclaw plugins install`.

`.npmignore` already excludes source, tests, scripts, and dev files —
verify the tarball with:

```bash
pnpm pack
tar -tzf brightdeck-openclaw-deck-<X.Y.Z>.tgz
```

Expected payload: `package/dist/`, `package/README.md`,
`package/LICENSE`, `package/CHANGELOG.md`, `package/package.json`.

### 10. Verify install from clean state

On a clean machine or fresh container, run the load-check for **every**
release:

```bash
openclaw plugins install clawhub:@brightdeck/openclaw-deck
openclaw plugins enable openclaw-deck
# Load-check: confirms the bundle loads and registers all 11 deck_* tools.
openclaw plugins inspect openclaw-deck --runtime
```

#### Manual OAuth sign-in — major releases only

For **major** releases — or any release that touches the OAuth/MCP path
(`src/lib/oauth.ts`, `auth.ts`, `token-store.ts`, `tool-helper.ts`,
`deck-client.ts`) — also exercise a tool end-to-end and complete the sign-in
by hand:

```bash
# Exercise a tool through an agent (there is no `openclaw call`; plugin tools
# are agent tools, reachable only via the Gateway). Either run one embedded
# agent turn:
openclaw agent --local -m "list my deck presentations"
# …or open an interactive UI and ask there:
#   openclaw chat        # then: "list my deck presentations"
```

On the first tool invocation, on a machine with a desktop browser the plugin
auto-opens your browser to the authorize URL and blocks until you finish; when a
browser can't be opened (SSH-without-`DISPLAY`, in CI, or with `DECK_NO_BROWSER=1`)
the tool returns the URL in its result for the agent to relay, and you sign in
then re-run (see README.md). Complete the OAuth dance once; the token persists to
a `0600` file under the OpenClaw home, so subsequent calls (and later processes)
skip it until refresh.

For **minor / patch** releases this manual click is **not** required. The
regression surface it used to cover is now gated automatically:

- The hermetic end-to-end test (`src/__tests__/e2e/oauth-mcp-e2e.test.ts`, part
  of normal `pnpm test` / CI) drives the real file-backed token store through a
  real loopback dance and a real MCP `initialize → tools/call`, asserting the
  token lands on disk at `0600`.
- The anonymous contract smoke
  (`pnpm test:smoke` via `.github/workflows/release-smoke.yml`) checks the live
  backend's discovery documents, redirect-URI accept/reject, and the `/mcp`
  401 challenge.

Together they cover the loopback-dance + MCP-handshake + persistence regression
surface without a human in the loop.

### 11. Announce

Update the [GitHub release](https://github.com/brightdeck/openclaw/releases)
notes for `v<X.Y.Z>` with the changelog excerpt and a link to the
ClawHub listing.

## Versioning policy

- **Major bumps require a paired CIMD doc deploy** on `api.brightdeck.ai`
  (the `software_version` field). Coordinate before publishing.
- **Patch and minor bumps** are independent of the deck backend.
- **The CIMD doc URL never changes** — it's the persistent client
  identifier. See SECURITY.md for the rationale.

## Hotfix releases

For a critical fix that can't wait for the normal cadence:

1. Branch from the tag of the affected version: `git checkout -b hotfix/<X.Y.Z+1> v<X.Y.Z>`.
2. Cherry-pick the fix.
3. Run the full per-release checklist above.
4. After publishing, merge the hotfix branch back to `main` to keep
   history linear.

## Rollback

ClawHub publishes are immutable per version. To "roll back" a bad
release, publish a corrected `<X.Y.Z+1>` **with the `latest` tag** rather
than unpublishing — new installs resolve `latest` to the fix, leaving the
bad version installable-but-un-preferred. This is the preferred path; it
needs no destructive action.

ClawHub CLI **v0.23.0 has no `deprecate` command** (earlier docs
referenced one — it no longer exists). The only version-level moderation
is a **permanent, irreversible** delete; reach for it only when a version
must be removed entirely:

```bash
# IRREVERSIBLE — the version "cannot be restored or republished".
# Publish the replacement FIRST if you are deleting the current latest.
clawhub package delete brightdeck/openclaw-deck --version <X.Y.Z> --yes
```

npm still supports a reversible deprecation warning:

```bash
npm deprecate @brightdeck/openclaw-deck@<X.Y.Z> "Use <X.Y.Z+1>"
```

## Troubleshooting

### `clawhub: 401 unauthorized` on publish

Token expired. Re-run `clawhub login`. If you're in CI, rotate the
stored token.

### ClawScan stuck in `Review`

A human reviewer flagged something. Check the publish UI for the
review comment. Common asks: clarify the network-egress note, add a
SECURITY.md disclosure, or pin a peer-dep range.

### `pnpm publish` fails with `403 Forbidden`

You're not a member of the `@brightdeck` npm org, or your npm token
lacks publish permission. `npm whoami` to check; ask an org admin to
add you or re-issue a token with `--access publish`.

### Tag exists but publish was skipped

If `clawhub package publish` succeeded but `pnpm publish` failed (or
vice versa), the two registries are out of sync. Repeat the failing
step against the same version — both registries are idempotent and
will accept the same version once.

## Related references

- [CHANGELOG.md](../CHANGELOG.md) — release history
- [CONTRIBUTING.md](../CONTRIBUTING.md) — day-to-day contributor flow
- [SECURITY.md](../SECURITY.md) — disclosure policy + network egress
- [ClawHub publisher docs](https://docs.openclaw.ai/clawhub/publishing)
- [OpenClaw plugin SDK docs](https://docs.openclaw.ai/plugins/sdk-overview)
- [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
- [SemVer](https://semver.org/spec/v2.0.0.html)
