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

Edit `package.json` and bump per [SemVer](https://semver.org/):

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
pnpm test
```

All five steps must pass before continuing.

### 5. Validate against the OpenClaw SDK

```bash
openclaw plugins build --entry ./dist/index.js
openclaw plugins validate --entry ./dist/index.js
```

This catches manifest ↔ runtime parity issues (missing tool
registrations, config-schema drift, peer-dep version mismatches) that
the unit tests don't.

### 6. Dry-run publish

```bash
clawhub package publish . \
  --family code-plugin \
  --owner brightdeck \
  --version <X.Y.Z> \
  --changelog "Short summary copied from CHANGELOG.md" \
  --tags "automation,presentations,brightdeck,latest" \
  --clawscan-note "Wraps api.brightdeck.ai MCP server. Auth via OAuth 2.1 + PKCE with loopback callback." \
  --dry-run
```

The output must report `passed`. Fix any flagged issues before
proceeding. Common dry-run failures:

- `Fail: missing LICENSE` — the LICENSE file drifted from canonical
  Apache-2.0. Re-paste from
  https://www.apache.org/licenses/LICENSE-2.0.txt.
- `Warn: outbound network call to api.brightdeck.ai` — expected; the
  `--clawscan-note` covers it. If the human reviewer still flags it,
  point them at the [SECURITY.md](../SECURITY.md) network-egress
  disclosure.

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
  --tags "automation,presentations,brightdeck,latest" \
  --clawscan-note "Wraps api.brightdeck.ai MCP server. Auth via OAuth 2.1 + PKCE with loopback callback."
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

On a clean machine or fresh container:

```bash
openclaw plugins install clawhub:@brightdeck/openclaw-deck
openclaw plugins enable openclaw-deck
openclaw plugins inspect openclaw-deck --runtime --json
openclaw call openclaw-deck/deck_list_presentations
```

The first call triggers the OAuth dance in the browser; subsequent
calls within the access-token TTL skip it.

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
release, publish a corrected `<X.Y.Z+1>` rather than unpublishing.

To deprecate a known-bad version so installers see a warning:

```bash
clawhub package deprecate brightdeck/openclaw-deck \
  --version <X.Y.Z> \
  --reason "Use <X.Y.Z+1> — see CHANGELOG.md"
```

For npm:

```bash
npm deprecate @brightdeck/openclaw-deck@<X.Y.Z> "Use <X.Y.Z+1>"
```

Both are reversible.

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
