# Contributing

Thanks for your interest in contributing to `@brightdeck/openclaw-deck`.

## Development setup

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Running against a local deck

If you run a deck backend locally or against a non-default environment,
set the plugin's `apiBaseUrl` config to that backend's URL. The plugin
discovers its OAuth `client_id` from
`<apiBaseUrl>/mcp/.well-known/cimd/openclaw.json`, so any deck deployment
that publishes that document is usable.

## Pull requests

- One change per PR.
- Add or update tests under `src/**/__tests__`.
- Update `CHANGELOG.md` under `[Unreleased]`.
- `pnpm run audit-public` must pass — it greps for monorepo paths and
  internal references that must not ship to the public repo.

## Release process

(For maintainers.) See the section "Publishing a new version" in the
[release docs](https://github.com/brightdeck/openclaw/blob/main/docs/RELEASE.md).
