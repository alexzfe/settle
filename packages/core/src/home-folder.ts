import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { CoreError } from "./errors.js";
import type { OperationContext } from "./registry.js";
import type { HomeRow } from "./store.js";

// Writes a Home Folder's two files, as docs/specs/skill-set.md#packaging and spike 1 settled.
// Claude Code owns .claude/settings.local.json (the server approval lands there), so this never
// reads or writes it, and only .mcp.json says which Home a folder belongs to.

/** The server key in .mcp.json, so the Agent's tools are mcp__settle__<tool>. */
export const MCP_SERVER_KEY = "settle";

const HOME_URL = /\/mcp\/homes\/([^/?#]+)/;

export interface HomeFolderResult {
  path: string;
  files: string[];
}

export function setUpHomeFolder(
  context: OperationContext,
  home: HomeRow,
  requestedPath: string,
): HomeFolderResult {
  const { files, store } = context;
  const folder = resolveFolder(requestedPath, home.slug);
  const mcpPath = join(folder, ".mcp.json");
  const settingsPath = join(folder, ".claude", "settings.json");

  const mcp = readJsonObject(context, mcpPath);
  const owner = homeNamedBy(mcp);
  if (owner !== undefined && owner !== home.slug) {
    const name = store.home(owner)?.name ?? owner;
    throw new CoreError(
      "folder_belongs_to_other_home",
      `${folder} is already the Home Folder of "${name}": its .mcp.json points at that Home. ` +
        `Choose another folder, such as ~/Homes/${home.slug}.`,
    );
  }
  const settings = readJsonObject(context, settingsPath);
  const { marketplace, plugin } = readMarketplace(context);
  const { port, repoRoot } = context.homeFolder;

  const nextMcp = {
    ...mcp,
    mcpServers: {
      ...asObject(mcp?.mcpServers),
      [MCP_SERVER_KEY]: { type: "http", url: `http://127.0.0.1:${port}/mcp/homes/${home.slug}` },
    },
  };
  const approved = Array.isArray(settings?.enabledMcpjsonServers)
    ? (settings.enabledMcpjsonServers as unknown[])
    : [];
  const nextSettings = {
    ...settings,
    enabledPlugins: { ...asObject(settings?.enabledPlugins), [`${plugin}@${marketplace}`]: true },
    extraKnownMarketplaces: {
      ...asObject(settings?.extraKnownMarketplaces),
      [marketplace]: { source: { source: "directory", path: repoRoot } },
    },
    enabledMcpjsonServers: approved.includes(MCP_SERVER_KEY)
      ? approved
      : [...approved, MCP_SERVER_KEY],
  };

  try {
    files.writeText(mcpPath, `${JSON.stringify(nextMcp, null, 2)}\n`);
    files.writeText(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
  } catch (error) {
    throw new CoreError(
      "home_folder_unusable",
      `Could not write the Home Folder files into ${folder} (${(error as Error).message}). ` +
        "Check that the path is a folder you can write to.",
    );
  }

  if (home.homeFolderPath !== folder) {
    context.write("web", (log) => {
      store.setHomeFolderPath(home.id, folder);
      log({
        home,
        recordKind: "home",
        record: home,
        field: "home_folder_path",
        old: home.homeFolderPath ?? undefined,
        new: folder,
      });
    });
  }
  return { path: folder, files: [mcpPath, settingsPath] };
}

function resolveFolder(path: string, homeSlug: string): string {
  const expanded =
    path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  if (!isAbsolute(expanded)) {
    throw new CoreError(
      "validation",
      `The Home Folder path must be absolute, such as ~/Homes/${homeSlug}; "${path}" is not.`,
    );
  }
  return resolve(expanded);
}

/** The slug of the Home a folder's .mcp.json points our server at, if it does. */
function homeNamedBy(mcp: Record<string, unknown> | undefined): string | undefined {
  const server = asObject(asObject(mcp?.mcpServers)[MCP_SERVER_KEY]);
  const slug = typeof server.url === "string" ? HOME_URL.exec(server.url)?.[1] : undefined;
  return slug === undefined ? undefined : decodeURIComponent(slug);
}

function readJsonObject(
  { files }: OperationContext,
  path: string,
): Record<string, unknown> | undefined {
  let text: string | undefined;
  try {
    text = files.readText(path);
  } catch (error) {
    throw new CoreError(
      "home_folder_unusable",
      `Could not read ${path} (${(error as Error).message}). Check the Home Folder path.`,
    );
  }
  if (text === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Reported below, with what to do about it.
  }
  throw new CoreError(
    "home_folder_unusable",
    `${path} is not a JSON object, so it can't be updated safely. Fix or remove it, then set up ` +
      "the Home Folder again.",
  );
}

/** The marketplace and plugin names from this repo's .claude-plugin/marketplace.json. */
function readMarketplace({ files, homeFolder }: OperationContext): {
  marketplace: string;
  plugin: string;
} {
  const path = join(homeFolder.repoRoot, ".claude-plugin", "marketplace.json");
  const text = files.readText(path);
  const manifest = text === undefined ? undefined : (JSON.parse(text) as Record<string, unknown>);
  const plugins = Array.isArray(manifest?.plugins) ? manifest.plugins : [];
  const marketplace = manifest?.name;
  const plugin = asObject(plugins[0]).name;
  if (typeof marketplace !== "string" || typeof plugin !== "string") {
    throw new Error(`${path} must name the marketplace and list the plugin`);
  }
  return { marketplace, plugin };
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
