# Contributing

Thanks for looking. Watchfire is small and deliberate, and a few rules keep it that way.
Read this, then [`specs/README.md`](specs/README.md), before opening a pull request.

## The one rule that is not negotiable

**Watchfire is report-only.** A change that lets Watchfire write, mutate, deploy or delete
anything on a system it monitors will not be merged, however useful it looks. That
includes "just in case" capabilities that nothing uses yet. See
[`SECURITY.md`](SECURITY.md) for why this is a security property.

## Working in the repository

It is an npm-workspaces monorepo. Install once at the root:

```bash
npm ci
```

| Task | Command |
|---|---|
| Lint, typecheck, test everything | `npm run lint && npm run typecheck && npm test` |
| One workspace | `npm test -w @watchfire/agent` · `npm run build -w @watchfire/dashboard` |
| Run the agent locally | see the [README quickstart](README.md#quickstart) |
| Build the agent image | `npm run test:container` (runs the suite inside the production image) |

Use Node 24 (`.nvmrc`).

GitHub Actions checks the agent. **The dashboard has no GitHub CI** — its pipeline runs
on Azure Pipelines — so for dashboard changes, run its lint, typecheck and build
yourself and say so in the pull request.

## Specs first

The [`specs/`](specs/README.md) directory is the source of truth for behaviour.

- **A behaviour change starts with a spec change.** Propose the spec edit, get it
  agreed, then implement.
- **Spec edits and code go in separate commits.** A reviewer should be able to read
  what was decided without wading through how it was built.
- If the spec is silent or ambiguous about what you need, say so in the pull request
  rather than inventing behaviour.

## Conventions

- TypeScript, ESM, strict mode. No `any` without a comment explaining why.
- Business logic in pure functions; side effects at the edges.
- Tests live beside the code: `foo.ts` next to `foo.test.ts`, using Vitest.
- One adapter per directory under `apps/agent/src/adapters/<system>/`; the wrappers in
  `apps/agent/bin/` stay thin.
- No new runtime dependency without a spec change that justifies it.
- **Secrets never appear** in code, tests, logs, error messages, or the tenant
  registry, which holds only environment-variable names. There is no pre-commit hook
  to catch a mistake — it is on you and on review.

Changes that add a command or an adapter need a second look at safety: does the
command belong in the allowlist in `apps/agent/src/agent/safety.ts`, and does the
adapter's credential have only read rights?

## Pull requests

Keep them small enough to review in one sitting. Describe what changed and why, what
you verified and how, and anything you were unsure about.

## Licensing your contribution

Watchfire is licensed [AGPL-3.0-only](LICENSE), with a narrow Section 7 permission for the
Claude Agent SDK. By contributing, you agree your contribution is licensed under the
same terms. Sign off your commits to certify you have the right to submit them
([Developer Certificate of Origin](https://developercertificate.org/)):

```bash
git commit -s
```

## Working with AI agents here

Watchfire was built with AI coding agents, and contributions made with them are welcome
on the same terms as any other.

[`CLAUDE.md`](CLAUDE.md) is the briefing an agent should read before touching
anything. It tells the agent to read the relevant specs before writing code, to stop
and ask when a spec is silent rather than invent behaviour, and to end any spec edit
with a short list of what it inferred, what it was unsure about, and what it
skipped. Keep that list in your pull request — it is the cheapest place to catch an
agent confidently building the wrong thing.

You are responsible for everything you submit, whoever or whatever wrote it.
