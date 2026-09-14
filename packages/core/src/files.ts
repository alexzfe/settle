import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The file store seam: the Home Folder writer's only way to the disk. */
export interface FileStore {
  /** The file's text, or undefined when there is no such file. */
  readText(path: string): string | undefined;
  /** Writes the file, creating its folder and any missing parents. */
  writeText(path: string, text: string): void;
}

export const nodeFileStore: FileStore = {
  readText(path) {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  writeText(path, text) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  },
};
