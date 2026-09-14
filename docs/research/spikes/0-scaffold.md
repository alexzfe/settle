# Spike 0: the scaffold

**Status:** done 2026-09-13. The [Repository layout](../../build-plan.md#repository-layout) of the build plan is in the repo. It installs, builds, tests, lints, builds the plugin, and runs an empty server. No slice 1 feature is implemented.

## What was set up

| Path | What it holds |
|---|---|
| `package.json`, `pnpm-workspace.yaml` | the workspace (`packages/*`), the root scripts, and a pnpm **catalog**: every dependency's version is set once there, and packages ask for `catalog:` |
| `tsconfig.base.json` | strict, ESM, `NodeNext`, `ES2023`, plus `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly` |
| `biome.json`, `vitest.config.ts` | Biome's recommended preset; one Vitest run over every package as a project |
| `packages/core` | `createCore()` returning an empty `Core`, and `migrate(path)`, which opens `node:sqlite`, turns on WAL and foreign keys, and applies `migrations/NNNN_*.sql` in one transaction, recorded in `migrations (id, applied_at)`. `0000_init.sql` creates only that table. Zod is installed |
| `packages/server` | Hono on `@hono/node-server`, bound to `127.0.0.1:4380` (`IDH_PORT`), data in `$XDG_DATA_HOME/int-design-harness` (`IDH_DATA_DIR`). At startup it creates the data dir and runs `migrate()` on `harness.sqlite`. Routes: `GET /` (a placeholder page), `GET /health` (`{"status":"ok"}`), and `/mcp/homes/:home` (stateless streamable HTTP, **no tools**) |
| `packages/web` | Vite, React, React Router, TanStack Query, CSS modules. One page fetches `/health` through the Vite proxy (`/health`, `/api`, `/events` go to the server) |
| `packages/skills` | `protocol.md` (a one-line placeholder), `home-intake/SKILL.md` (spec-only frontmatter; the description is the spec's draft, unrevised), and `src/build.ts` |
| `plugin/` | `.claude-plugin/plugin.json` (`int-design-harness`, `0.0.1`), the built `skills/home-intake/SKILL.md`, `evals/.gitkeep` |
| `.claude-plugin/marketplace.json` | the marketplace `int-design-harness`, listing the plugin with source `./plugin` |

Versions resolved: pnpm 12.4.1 (through mise), TypeScript 7.0.2, Vitest 5.0.0, Vite 8.3.0, Biome 2.5.13, Hono 4.13.7, `@hono/node-server` 2.1.1, `@modelcontextprotocol/sdk` 1.30.0, React 19.3, React Router 8.3.1, TanStack Query 5.102.8, Zod 4.6.4, tsx 4.23.13, concurrently 10.0.5.

## Commands

| Command | Does | Verified |
|---|---|---|
| `mise use -g pnpm@latest` | installs pnpm | `pnpm --version` prints 12.4.1 in a fresh login shell |
| `pnpm install` | installs the workspace | passes pnpm's supply-chain check |
| `pnpm test` | `vitest run` over all four packages | 6 files, 15 tests pass |
| `pnpm build` | `tsc` in every package, `vite build` for web, and the plugin build | passes |
| `pnpm lint` / `pnpm format` | `biome check .` / `biome check --write .` | lint is clean |
| `pnpm plugin:build` | writes `plugin/skills/<name>/SKILL.md` | writes `home-intake`; `claude plugin validate --strict` passes for `./plugin` and for the marketplace at `.` |
| `pnpm dev` | concurrently runs `tsx watch` for the server and Vite for the UI | `/health` answers on 4380 and through Vite on 5173 |
| `pnpm start` | `node dist/main.js` (needs `pnpm build` first) | answers `/`, `/health`, and an MCP `initialize`; exits 0 on SIGTERM; a second instance prints "Port 4380 is in use" and exits 1 |
| `pnpm plugin:eval` | `claude plugin eval ./plugin` | exits 1 with "No eval cases found" until the first case lands |

## Choices made

- **Hono, not `node:http`.** SDK 1.30 ships `WebStandardStreamableHTTPServerTransport`, which takes a `Request` and returns a `Response`, so an MCP route is `transport.handleRequest(c.req.raw)`. Each request gets a fresh `McpServer` and transport, with `sessionIdGenerator: undefined` and `enableJsonResponse: true`. A server test sends `initialize` end to end. `@hono/mcp` was not needed.
- **Workspace packages resolve to source in dev and tests.** Each package's `exports` has an `@idh/source` condition pointing at `src/index.ts`, ahead of `types` and `default` pointing at `dist/`. tsx runs with `--conditions=@idh/source`, the server's Vitest config sets it for SSR resolution, and `tsconfig.base.json` sets it as a `customCondition` so editors see live types. The server's tsconfig **references** core, so `tsc --build` swaps in core's `.d.ts` output. The condition is namespaced so no third-party package's `source` export is picked up by mistake.
- **Package names** are `@idh/core`, `@idh/server`, `@idh/web`, `@idh/skills`, matching the `IDH_` environment prefix.
- **Migrations:** `id` is the file's number (`0000` is 0). Files are `NNNN_snake_case.sql`, and a misnamed `.sql` file or a repeated number stops startup. Files hold no `BEGIN`/`COMMIT`, because `migrate()` wraps every pending file in one transaction. `0000_init` uses a `STRICT` table, a precedent for later tables.
- **The database file** is `<data dir>/harness.sqlite`, a name the docs did not fix.
- **The server binds `127.0.0.1` only.** The plan's LAN mode (slice 6) adds the LAN address later. The Vite proxy targets `127.0.0.1` for the same reason.
- **The plugin build** validates each source's frontmatter with Zod (only `name` and `description`, `name` matching the folder, description ≤ 1,024 characters), renders everything before writing, then replaces `plugin/skills/` entirely, so a deleted Skill disappears from the output. The protocol goes under `## Session protocol` at the end of each body.
- **Manifests** carry `author` and a marketplace `description`, beyond what the brief listed, so `claude plugin validate --strict` passes and can gate a later CI.

## Workarounds

- **pnpm 12 refuses unapproved build scripts** (`ERR_PNPM_IGNORED_BUILDS` for esbuild). `allowBuilds: { esbuild: false }` in `pnpm-workspace.yaml`: the script only re-checks the platform binary that pnpm already installs as an optional dependency, and tsx works without it.
- **pnpm 12 has a minimum release age.** zod 4.6.5 was under three hours old, and pnpm added it to `minimumReleaseAgeExclude` by itself. I removed the exclusion and let `pnpm update zod` pick 4.6.4 instead, keeping the gate intact.
- **Vitest 5 no longer excludes `dist/`** by default. `tsc` compiles the tests into `dist/` too, so core and server set `test.include: ["src/**/*.test.ts"]`.
- **Biome 2.5 deprecated `rules.recommended`.** `biome migrate` rewrote it to `"preset": "recommended"`.
- **Biome reads only the repo's `.gitignore`**, not the global one that hides `.claude/`, so `biome.json` excludes `.claude`.
- **TypeScript 7** defaults `types` to `[]`, so each Node package lists `"types": ["node"]`, and web lists `"vite/client"`.

## For the next slices

- **Before slice 1 ships a tool, turn on DNS-rebinding protection** for `/mcp/homes/*`. A browser page can reach a localhost server. The web-standard transport has `enableDnsRebindingProtection` with `allowedHosts` and `allowedOrigins`, off by default and left off here; a Hono middleware checking `Host` would also cover `/api`.
- **The web package does not import core yet.** When it does, add `resolve.conditions: ["@idh/source", ...]` to `vite.config.ts`.
- **`pnpm plugin:eval` publishes its report to claude.ai by default.** Add `--no-publish` to the script if reports should stay local.
- **`plugin/skills/` is build output.** Edit `packages/skills/<name>/SKILL.md` and run `pnpm plugin:build`.
- **`.mcp.json` URLs** should use `127.0.0.1`, or rely on the client falling back from `::1`, because the server does not listen on IPv6.
- **The server does not serve the built UI yet.** `GET /` is a placeholder until slice 1.
- **A project `mise.toml`** pinning Node 26.8.1 and pnpm would make the toolchain reproducible. It was outside this brief's paths.

## To verify by hand

- Open `pnpm dev`'s Vite URL in a browser and see "Server: ok". I checked it only with `curl`: the page's HTML and `/health` through the proxy, not the rendered React.
- Run `claude --plugin-dir ./plugin` and check that `home-intake` is listed.
