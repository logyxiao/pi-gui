#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const releaseDir = path.resolve("apps/desktop/release");

async function findLatestDmg() {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const dmgFiles = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".dmg"))
      .map(async (entry) => {
        const filePath = path.join(releaseDir, entry.name);
        const fileStat = await stat(filePath);
        return { filePath, mtimeMs: fileStat.mtimeMs };
      }),
  );

  return dmgFiles.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath;
}

async function main() {
  if (process.platform !== "darwin") {
    return;
  }

  const dmgPath = await findLatestDmg();
  if (!dmgPath) {
    console.warn(`No .dmg file found in ${releaseDir}`);
    return;
  }

  const dmgDir = path.dirname(dmgPath);
  console.log(`Opening DMG output folder: ${dmgDir}`);
  await new Promise((resolve, reject) => {
    const child = spawn("open", ["-R", dmgPath], { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`open -R exited with code ${code}`));
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
