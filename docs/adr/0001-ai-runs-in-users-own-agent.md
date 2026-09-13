---
status: accepted
---

# AI runs in the user's own Agent, not in the platform

The platform makes no LLM calls. All AI work (Sessions, reading Blueprints, writing Shopping Guides) happens in the user's own Agent (Claude Code first), which reaches the platform's data through our MCP server and Skills. We wanted users to bring their existing Claude or ChatGPT subscriptions, but as of September 2026 neither vendor lets a third-party app route model calls through a consumer subscription: Anthropic's Claude Code legal terms prohibit it explicitly, and "Sign in with ChatGPT" is an identity login only. A user running their own Agent with our MCP server and Skills is permitted, bills their own subscription, and gives us automatic Skill selection and image reading for free.

## Consequences

- The web UI can show and edit data but cannot generate anything. AI-written content such as Shopping Guides must be produced during a Session and stored.
- Users without an Agent cannot use the product.
- An in-browser chat is planned for later. It must be built as one more client of the same core operations the MCP server uses, not by adding LLM calls to other parts of the platform.
