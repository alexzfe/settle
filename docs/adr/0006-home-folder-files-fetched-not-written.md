---
status: accepted
---

# The Home Folder's files are fetched by a command, not written by the platform

"Set up Home Folder" no longer writes anything to disk. The web UI shows a one-line command for the user to paste inside the folder, on each computer they work from; the command fetches a short script from the platform (`/api/home_folder_script?home=<slug>`), and that script writes the folder's two files, `.mcp.json` and `.claude/settings.json`. We chose this because the platform now runs on a server ([handoff/hosting.md](../handoff/hosting.md), Q5), and a hosted platform cannot reach the user's disk; because a Home Folder is on the user's computer by definition (CONTEXT.md), next to the Agent and the user's other tools, not next to the platform; and because one command serves a local and a hosted platform alike, so there is a single setup path rather than one per deployment. It amends [ADR 0002](0002-one-local-app-serves-ui-and-mcp.md), whose one local app wrote the files itself.

## Consequences

- An existing `.claude/settings.json` is not merged, only replaced: the script keeps the old file as `.claude/settings.json.before-settle` when its content differs, and the user copies back anything they want. The same holds for `.mcp.json`.
- The platform no longer knows where the Home Folders are. It stores no path (`homes.home_folder_path` is dropped), a Home may have one folder per computer, and the "Talk it through" hint says "in your Home Folder" rather than naming one.
- The "another Home's folder" check moves into the script: it refuses when `./.mcp.json` points its `settle` server at a different Home. It still never touches `.claude/settings.local.json`, which Claude Code owns.
- Piping a script into `sh` asks the user to trust the platform's address. The script reads nothing from stdin and writes only the two files and their backups, so it can be read in full before running.
- The plugin now comes from the GitHub marketplace `alexzfe/settle`, which needs a one-time `claude plugin install` per computer; the script prints that line when it finishes.
