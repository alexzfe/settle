// A Home Folder's two files, and the script that writes them, as docs/specs/skill-set.md#packaging,
// spike 1, and ADR 0006 settled. The server never writes to the user's disk: the web shows a
// command that fetches this script from the server and runs it inside the folder, on each computer.
// Claude Code owns .claude/settings.local.json (the server approval lands there), so the script
// never touches it, and only .mcp.json says which Home a folder belongs to.

/** The server key in .mcp.json, so the Agent's tools are mcp__settle__<tool>. */
export const MCP_SERVER_KEY = "settle";
/** The plugin marketplace's name, and the GitHub repository it lives in. */
export const PLUGIN_MARKETPLACE = "settle";
export const PLUGIN_REPO = "alexzfe/settle";
/** The plugin's name in that marketplace. */
export const PLUGIN_NAME = "settle";

/** Once on each computer: registers the marketplace and installs the plugin. */
export const PLUGIN_INSTALL =
  `claude plugin marketplace add ${PLUGIN_REPO} && ` +
  `claude plugin install ${PLUGIN_NAME}@${PLUGIN_MARKETPLACE}`;

export interface HomeFolderFile {
  /** Relative to the Home Folder. */
  path: string;
  content: string;
}

export interface HomeFolderSetup {
  /** The origin the app names itself by, e.g. "https://settle.example.com". */
  origin: string;
  /** Pasted inside the folder: fetches the script and runs it. */
  command: string;
  pluginInstall: string;
  /** What the script writes: .mcp.json, then .claude/settings.json. */
  files: HomeFolderFile[];
}

export function homeFolderSetup(origin: string, homeSlug: string): HomeFolderSetup {
  return {
    origin,
    command: `curl -fsSL "${scriptUrl(origin, homeSlug)}" | sh`,
    pluginInstall: PLUGIN_INSTALL,
    files: homeFolderFiles(origin, homeSlug),
  };
}

export function homeFolderFiles(origin: string, homeSlug: string): HomeFolderFile[] {
  const mcp = {
    mcpServers: { [MCP_SERVER_KEY]: { type: "http", url: `${origin}/mcp/homes/${homeSlug}` } },
  };
  const settings = {
    enabledPlugins: { [`${PLUGIN_NAME}@${PLUGIN_MARKETPLACE}`]: true },
    extraKnownMarketplaces: {
      [PLUGIN_MARKETPLACE]: { source: { source: "github", repo: PLUGIN_REPO } },
    },
    enabledMcpjsonServers: [MCP_SERVER_KEY],
  };
  return [
    { path: ".mcp.json", content: `${JSON.stringify(mcp, null, 2)}\n` },
    { path: ".claude/settings.json", content: `${JSON.stringify(settings, null, 2)}\n` },
  ];
}

/**
 * The POSIX sh script GET /api/home_folder_script serves: run in the Home Folder, it refuses a
 * folder whose .mcp.json names another Home, keeps a differing file as <file>.before-settle,
 * writes both files, and says what to do next. It reads nothing from stdin, which is the script
 * itself under `curl … | sh`. Home slugs are [a-z0-9-], so they need no shell quoting.
 */
export function homeFolderScript(origin: string, homeSlug: string): string {
  const writes = homeFolderFiles(origin, homeSlug).flatMap(({ path, content }) => [
    `write_file ${path} <<'SETTLE_EOF'`,
    content.trimEnd(),
    "SETTLE_EOF",
  ]);
  return [
    "#!/bin/sh",
    `# Settle: makes the current folder the Home Folder of the Home "${homeSlug}" at ${origin}.`,
    "set -eu",
    "",
    `home=${homeSlug}`,
    "",
    "if [ -f .mcp.json ]; then",
    "  other=$(grep -o '/mcp/homes/[a-z0-9-]*' .mcp.json | sed 's|/mcp/homes/||' | grep -v -x \"$home\" | head -n 1 || true)",
    '  if [ -n "$other" ]; then',
    '    echo "This folder is already the Home Folder of another Home, \\"$other\\": its .mcp.json points at that Home." >&2',
    `    echo "Nothing was changed. Run the command in another folder, such as ~/Homes/$home." >&2`,
    "    exit 1",
    "  fi",
    "fi",
    "",
    "wrote=''",
    "kept=''",
    "same=''",
    "",
    "# Writes stdin (a here-document, never the script's own input) to $1, keeping a differing",
    "# file that was there as $1.before-settle.",
    "write_file() {",
    '  mkdir -p "$(dirname "$1")"',
    '  cat > "$1.settle-new"',
    '  if [ -f "$1" ] && cmp -s "$1" "$1.settle-new"; then',
    '    rm -f "$1.settle-new"',
    '    same="$same $1"',
    "    return",
    "  fi",
    '  if [ -f "$1" ]; then',
    '    cp "$1" "$1.before-settle"',
    '    kept="$kept $1.before-settle"',
    "  fi",
    '  mv "$1.settle-new" "$1"',
    '  wrote="$wrote $1"',
    "}",
    "",
    ...writes,
    "",
    'if [ -n "$wrote" ]; then echo "Wrote$wrote."; fi',
    'if [ -n "$same" ]; then echo "Already up to date:$same."; fi',
    'if [ -n "$kept" ]; then echo "Kept the files that were there as$kept."; fi',
    `echo "This folder is now the Home Folder of the Home \\"$home\\"."`,
    "echo",
    "echo 'Once on each computer, install the Settle plugin:'",
    `echo '  ${PLUGIN_INSTALL}'`,
    "echo",
    "echo 'Run `claude` here.'",
    "",
  ].join("\n");
}

function scriptUrl(origin: string, homeSlug: string): string {
  return `${origin}/api/home_folder_script?home=${homeSlug}`;
}
