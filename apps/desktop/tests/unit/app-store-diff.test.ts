import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateFilePath } from "../../electron/app-store-diff";

let workspaceRoot = "";

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), "pi-diff-validate-"));
  await mkdir(join(workspaceRoot, "sub"), { recursive: true });
  await writeFile(join(workspaceRoot, "sub", "file.ts"), "// hi", "utf8");
});

afterEach(async () => {
  if (workspaceRoot) {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

describe("validateFilePath", () => {
  it("accepts file inside workspace", () => {
    expect(validateFilePath(workspaceRoot, "sub/file.ts")).toBe("sub/file.ts");
  });

  it("accepts the workspace root itself", () => {
    expect(validateFilePath(workspaceRoot, ".")).toBe(".");
  });

  it("rejects ../ traversal", () => {
    expect(() => validateFilePath(workspaceRoot, "../escape")).toThrow(/escapes/);
  });

  it("rejects absolute path outside workspace", () => {
    expect(() => validateFilePath(workspaceRoot, "/etc/passwd")).toThrow(/escapes/);
  });

  it("treats /var → /private/var symlink-equivalent paths consistently on macOS", async () => {
    if (process.platform !== "darwin") return;
    // /tmp on macOS is symlinked to /private/tmp; mkdtemp() above already gives a /var path,
    // so just verify both canonical/non-canonical forms behave the same.
    const altRoot = workspaceRoot.startsWith("/private")
      ? workspaceRoot.replace("/private", "")
      : `/private${workspaceRoot}`;
    // we can't always traverse the alt path (depends on host), but at minimum the same
    // workspaceRoot string accepted from both directions should not falsely reject "."
    expect(validateFilePath(workspaceRoot, ".")).toBe(".");
    expect(validateFilePath(altRoot, ".")).toBe(".");
  });

  it("rejects symlink that escapes workspace", async () => {
    const escapeTarget = await mkdtemp(join(tmpdir(), "pi-diff-escape-"));
    try {
      await writeFile(join(escapeTarget, "secret.txt"), "secret", "utf8");
      await symlink(join(escapeTarget, "secret.txt"), join(workspaceRoot, "link"));
      expect(() => validateFilePath(workspaceRoot, "link")).toThrow(/escapes/);
    } finally {
      await rm(escapeTarget, { recursive: true, force: true });
    }
  });
});
