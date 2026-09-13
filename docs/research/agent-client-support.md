# Agent client support (researched 2026-09-13)

What each Agent supports for our MCP server and Skills, and what the vendors allow on consumer subscriptions. Findings come from primary sources, listed at the end. Re-verify anything load-bearing, because this changes fast.

## Subscriptions in third-party apps

- **Claude:** a third-party app cannot route model calls through a Pro or Max subscription. Anthropic "does not permit third-party developers to offer Claude.ai login … or to route requests through Free, Pro, or Max plan credentials on behalf of their users" [1]. Using the unmodified Claude Code on one's own subscription is permitted, and third-party MCP servers and plugins are first-class features [2][3].
- **ChatGPT:** "Sign in with ChatGPT" (beta, 2026-08) only provides identity login, and model usage is not billed to the user's plan [4]. Third-party MCP servers and plugins are first-class features in Codex and ChatGPT [5].
- **Alternatives if we ever call models ourselves:** a user-supplied Anthropic or OpenAI API key (both allow direct browser calls via `dangerouslyAllowBrowser`), or OpenRouter's OAuth PKCE sign-in, which issues a key billed to the user's own credits [6].

## Per-client matrix

| | MCP transport | Skills | Bundle skills + MCP | Prompts / Resources | MCP Apps UI |
|---|---|---|---|---|---|
| Claude Code | stdio, HTTP (localhost OK) | `SKILL.md`, auto-invoked by description, or explicit `/name` | Plugin: `skills/` + `.mcp.json` via marketplace | Both | Not listed |
| Claude Desktop | Local stdio, remote | Yes, via plugins | Plugins | Unverified | Yes (unverified from a local server) |
| claude.ai web | Remote only (must be public) | ZIP upload | Plugins | Unverified | Yes |
| Codex CLI/app | stdio, HTTP incl. localhost | `SKILL.md` in `.agents/skills` | Plugin: `plugin.json`, `skills/`, `mcp.json` | Tools only | Unclear |
| ChatGPT web | Remote only, or a tunnel | Yes | Plugins | Unverified | Yes |

## Consequences for us

- Our localhost HTTP MCP server works as-is with Claude Code, Claude Desktop, and Codex. claude.ai and ChatGPT web need a hosted server.
- `SKILL.md` Skills are the portable format. MCP prompts are not: only Claude Code surfaces them.
- Claude Code reads a local image or PDF the user points to. Codex reads images only, so a PDF Blueprint must be rendered to images first.

## Sources

1. https://code.claude.com/docs/en/legal-and-compliance
2. https://code.claude.com/docs/en/mcp
3. https://code.claude.com/docs/en/plugins-reference
4. https://help.openai.com/en/articles/20001410-sign-in-with-chatgpt
5. https://developers.openai.com/plugins/build/plugins
6. https://openrouter.ai/docs/use-cases/oauth-pkce
7. https://code.claude.com/docs/en/skills
8. https://learn.chatgpt.com/docs/build-skills
9. https://modelcontextprotocol.io/extensions/client-matrix
10. https://github.com/openai/codex/issues/1797 (Codex PDF support, still open)
