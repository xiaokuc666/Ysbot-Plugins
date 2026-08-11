import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { ensureDir, pathExists, resolveCoreDir } from "./workspace.js";

export async function importCoreModule(coreDir, relativePath) {
  await assertCoreAvailable(coreDir);
  const root = resolveCoreDir(coreDir);
  const file = path.join(root, relativePath);
  if (!(await pathExists(file))) {
    throw new Error(
      `Core module not found: ${file}. Pass --core or set YSBOT_CORE_DIR.`,
    );
  }
  return import(pathToFileURL(file).href);
}

export async function assertCoreAvailable(coreDir) {
  const root = resolveCoreDir(coreDir);
  if (!(await pathExists(path.join(root, "package.json")))) {
    if (process.env.YSBOT_NO_BOOTSTRAP === "1") {
      throw new Error(`YSbot Core not found at ${root}`);
    }
    await ensureDir(path.dirname(root));
    const result = spawnSync(
      "git",
      ["clone", "--depth", "1", "https://github.com/xiaokuc666/Ysbot-Core.git", root],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`Failed to bootstrap YSbot Core at ${root}`);
    }
  }
  return root;
}
