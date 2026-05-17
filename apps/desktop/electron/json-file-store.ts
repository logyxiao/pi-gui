import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface JsonFileStoreOptions<T> {
  readonly validate?: (value: unknown) => value is T;
}

export class JsonFileStore<T> {
  private readonly rootDir: string;
  private readonly validate?: (value: unknown) => value is T;

  constructor(userDataDir: string, subdir: string, options: JsonFileStoreOptions<T> = {}) {
    this.rootDir = join(userDataDir, subdir);
    this.validate = options.validate;
  }

  async read(sessionKey: string): Promise<T | undefined> {
    const filePath = this.filePath(sessionKey);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      await this.preserveCorrupt(filePath, error);
      return undefined;
    }
    if (this.validate && !this.validate(parsed)) {
      await this.preserveCorrupt(filePath, new Error("schema validation failed"));
      return undefined;
    }
    return parsed as T;
  }

  async write(sessionKey: string, data: T): Promise<void> {
    const filePath = this.filePath(sessionKey);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  }

  private async preserveCorrupt(filePath: string, error: unknown): Promise<void> {
    const backupPath = `${filePath}.corrupt-${Date.now()}.bak`;
    try {
      await rename(filePath, backupPath);
      console.warn(`[JsonFileStore] preserved corrupt file as ${backupPath}: ${(error as Error).message ?? error}`);
    } catch (renameError) {
      console.warn(`[JsonFileStore] failed to preserve corrupt file ${filePath}: ${(renameError as Error).message ?? renameError}`);
    }
  }

  private filePath(sessionKey: string): string {
    return join(this.rootDir, `${encodeURIComponent(sessionKey)}.json`);
  }
}
