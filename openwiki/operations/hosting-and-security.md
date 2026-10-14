---
type: operations
title: Configuration, security and self-hosting
description: Settle's environment settings, the three run modes (local, hosted, LAN), the front-door Host/Origin guard, the shared-password login and per-Home MCP bearer keys, and how the Docker image, compose file and CI build and ship it.
tags: [configuration, security, auth, hosting, docker, ci, lan-mode, deploy]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-14T08:07:45.932Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-4b571b39f042df3a80e17d02
    resource: repo://deploy/compose.yaml
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
  - id: openwiki-source-14c7fc2cd7605010c868d4c7
    resource: repo://packages/server/src/app.ts
  - id: openwiki-source-fbf5b91f778776240c1a0456
    resource: repo://packages/server/src/auth.ts
  - id: openwiki-source-08d4a54891669940c0207346
    resource: repo://packages/server/src/config.ts
  - id: openwiki-source-3d4389327f1d6eb70faa0f52
    resource: repo://packages/server/src/lan.ts
generated: { by: "claude-code", at: "2026-10-14T08:07:45.932Z" }
---

# Configuration, security and self-hosting

## Settings

`packages/server/src/config.ts` reads everything from the environment and **refuses to start** on
an unsafe or malformed combination, printing a plain explanation (`main.ts` exits without a stack
trace).

| Variable | Default | Meaning |
| --- | --- | --- |
| `SETTLE_PORT` | `4380` | 0–65535; 0 picks a free port |
| `SETTLE_HOST` | `127.0.0.1` | Bind address |
| `SETTLE_DATA_DIR` | `$XDG_DATA_HOME/settle` or `~/.local/share/settle` | Database, `uploads/`, `rendered/`, `session-secret` |
| `SETTLE_PUBLIC_ORIGIN` | — | `scheme://host[:port]` exactly, no path or trailing slash |
| `SETTLE_PASSWORD` | — | The household's shared password; empty means none |
| `SETTLE_LAN` / `SETTLE_LAN_HOST` | off | LAN mode, and optionally its address |

Safety rules enforced at load:

- A non-loopback `SETTLE_HOST` requires both `SETTLE_PUBLIC_ORIGIN` (the host guard needs it) and
  `SETTLE_PASSWORD`.
- A `SETTLE_PUBLIC_ORIGIN` requires a password even on loopback — a reverse proxy in front makes it
  just as reachable.
- `SETTLE_LAN_HOST` may not be a wildcard (`0.0.0.0`, `::`).

## Run modes

- **Local** (default): loopback only, no password, origin `http://127.0.0.1:<port>`.
- **Hosted**: `SETTLE_PUBLIC_ORIGIN` + `SETTLE_PASSWORD`. The origin is what Home Folder commands,
  `.mcp.json` files and Quick Guide links name. The container serves plain HTTP; HTTPS is the
  operator's job (reverse proxy such as Caddy, or `tailscale serve`), per `SELF-HOSTING.md`.
- **LAN mode** (`SETTLE_LAN=1`): a **second listener** on this machine's private-network address
  (found among interfaces, skipping docker/VPN/tailscale-style interfaces, or named by
  `SETTLE_LAN_HOST`), on the same port, serving **only** `/guide/<token>` Quick Guide pages so a
  phone on the home network can open them from the QR code. Everything else stays on loopback;
  every miss is the same 404. No LAN address → `NoLanAddressError` at startup.

## Layers of protection

Request order in `createApp` (`packages/server/src/app.ts`):

1. **Front door** (`frontDoor`): DNS-rebinding and cross-site protection on every route. The
   `Host` must be this machine's name (`127.0.0.1`/`localhost`) or the public origin's host, and a
   browser `Origin`, when sent, must be local or exactly the public origin. Otherwise 403.
2. **Login** (`auth.ts`, only with a password). Every route needs a valid `settle_session` cookie
   except `/health`, `/login`, `/logout` and Quick Guide pages **by token** (`/guide/<x>` without
   `?home=`). Cookies are `<expiry>.<HMAC>` signed with a key derived from a 32-byte secret in
   `<dataDir>/session-secret` (created mode 0600 on first start) mixed with the password — so
   sessions survive restarts and **changing the password logs everyone out**. Sessions last 30
   days; cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when the origin is https. Failed
   logins wait 1 s. Password and token comparisons use `timingSafeEqual` on digests. `next`
   redirects are restricted to same-site paths (`safeNext`).
3. **Per-Home bearer keys.** The Agent has no cookie: `/mcp/homes/<slug>` and
   `GET /api/home_folder_script?home=<slug>` accept `Authorization: Bearer <that Home's token>`,
   and the key opens nothing else. Unauthorised MCP requests get 401 with `WWW-Authenticate:
   Bearer` and a message telling the user to re-run the Home Folder command; API calls get a JSON
   401; page loads redirect to `/login`.
4. **MCP SDK checks.** The MCP transport separately enables DNS-rebinding protection with the same
   allowed hosts and origins ([HTTP server](../server/http-and-mcp.md)).

Without a password (`useNoAuth`) `/login` simply redirects onward. Home Folders always carry the
token, so turning a password on later needs no re-setup
([Skills and plugin](../agent/skills-and-plugin.md#home-folders)). Static HTML pages (login, guide,
exports) carry a strict content-security policy (`FILE_HEADERS` in `pages.ts`).

## Container image

The multi-stage `Dockerfile` (Node 26 bookworm-slim, pnpm pinned) builds core, server and web,
installs production dependencies for the server only, and keeps the workspace layout
(`/app/packages/{core,server,web}`) because the server finds the UI at `packages/web/dist` and core
finds `migrations/`, `data/` (cities) and `fixture/` beside its `dist/`. It sets
`SETTLE_DATA_DIR=/data`, `SETTLE_HOST=0.0.0.0`, port 4380, runs as `node` with app files root-owned
and read-only, declares `/data` as a volume, and health-checks `/health`. The Skills build is not
part of the image.

`deploy/compose.yaml` runs `ghcr.io/alexzfe/settle:latest` with a named volume and refuses to start
unless `.env` provides `SETTLE_PUBLIC_ORIGIN` and `SETTLE_PASSWORD`. Migrations run on startup, so
upgrading is `docker compose pull && docker compose up -d`. Backups: stop and tar the volume, or
`sqlite3 … ".backup"` plus `uploads/` and `rendered/`.

## CI and deployment

`.github/workflows/ci.yml`: on every PR and push to `main`, install with a frozen lockfile, then
`pnpm lint`, `pnpm test`, `pnpm build`. On `main` only, build the image for amd64 and arm64 (QEMU)
and push to `ghcr.io/alexzfe/settle` tagged `sha-<short>`, `main` and `latest`. PRs cancel older
runs; `main` runs queue. **There is no automatic deploy** — a server picks up a new image when its
operator pulls it.
