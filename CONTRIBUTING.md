# Contributing

[中文](CONTRIBUTING.zh-CN.md)

Contributions are welcome. Keep changes focused, explain the user problem, and avoid including private UU account or session data in issues, tests, and commits.

## Before opening an issue

Search existing issues first. Use the Bug report form for reproducible problems and the Feature request form for proposed behavior.

Send vulnerabilities and possible credential exposure to `iola1999@foxmail.com`. Security reports should stay out of public issues.

## Development setup

Requirements:

- Node.js 22
- npm
- A modern browser with WebRTC support

Install dependencies and start the development servers:

```bash
npm ci
npm run dev
```

The repository contains four main areas:

- `frontend`: React UI, browser WebRTC session, input, audio, and clipboard handling
- `backend`: Express gateway for UU API and Socket.IO signal traffic
- `cloudflare`: Worker and Durable Object implementation of the hosted gateway
- `shared`: protocol codecs, request validation, room models, and shared types

## Local checks

Run the checks that cover your change. Before opening a pull request, the full set is:

```bash
npm run format:check
npm run lint
npm run typecheck -w frontend
npm run typecheck:cloudflare
npm test
npm run build
npm run check:cloudflare
```

Changes to the Node gateway should include backend tests. Changes to Worker signaling should include Cloudflare tests. Browser session behavior belongs in the focused frontend test files instead of a single large integration test.

`npm test` includes the Worker runtime suite under `cloudflare/tests/runtime/`. It exercises HTTP routing, SQLite storage, alarms, object reconstruction, and concurrent lifecycle operations locally with synthetic data.

When testing Worker request options and redirects, keep the native `fetch` and supply synthetic responses through Miniflare's `outboundService`. Replacing the global `fetch` skips the runtime's request validation.

## Commit messages

Use an English Conventional Commit subject:

```text
type(scope): concise imperative summary
```

Examples:

```text
fix(input): correct touchpad scroll direction
feat(clipboard): add bidirectional synchronization
docs(deploy): explain Cloudflare connection routing
```

Common types are `feat`, `fix`, `refactor`, `test`, `docs`, `style`, `chore`, `ci`, and `build`. Keep the subject focused on the change contained in that commit.

## Pull requests

- Keep the diff small enough to review as one coherent change.
- Link the issue when one exists.
- Add or update tests for behavior changes.
- Update both `README.md` and `README.zh-CN.md` for shared user-facing documentation.
- Describe the commands you ran and any checks you skipped.
- Do not commit `node_modules`, build output, Wrangler state, local logs, or exported credentials.

## Sensitive data

UU Remote Web handles login state, authenticated UU API requests, room configuration, and remote-control signaling. Reports and test fixtures must use synthetic values.

Remove SMS codes, exported login-state JSON, account tokens, room tokens, complete device IDs, private IP addresses, and private page contents before sharing logs or screenshots. See [SECURITY.md](SECURITY.md) for the trust model and private reporting process.
