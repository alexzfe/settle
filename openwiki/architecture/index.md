# Files

- [Operation registry and the write path](operation-registry.md) - How @settle/core defines every operation once, how Core.run validates input and dispatches for the Agent or the web UI, how Sessions are checked, and how a write becomes one transaction, change-log rows and event-bus notifications.
- [Architecture overview](overview.md) - Settle's pnpm monorepo — core domain logic, a Hono server with an MCP endpoint and web API, a React web UI, and Skills built into a Claude Code plugin — and how a change flows from the Agent or the UI through core into SQLite and back out as live updates.
- [Persistence: SQLite store, migrations and files](persistence.md) - How Settle stores everything in one node:sqlite database behind the store.ts seam, applies numbered SQL migrations at open, encodes Measurements with Provenance as column triples, enforces the Provenance rule, and keeps uploaded and rendered files under the data dir.
