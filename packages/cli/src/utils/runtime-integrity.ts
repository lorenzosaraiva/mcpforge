import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { GENERATOR_RUNTIME_VERSION, getGeneratorIdentity } from "../core.js";

export { GENERATOR_RUNTIME_VERSION };

/** Hash executable inputs and artifacts, never credentials, logs, or client settings. */
export async function computeRuntimeHash(directory: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(path: string, required = false): Promise<void> {
    let stat;
    try {
      stat = await lstat(join(directory, path));
    } catch (error) {
      if (!required && (error as NodeJS.ErrnoException).code === "ENOENT")
        return;
      throw error;
    }
    if (stat.isSymbolicLink())
      throw new Error("Runtime files must not be symbolic links.");
    if (stat.isDirectory()) {
      for (const name of (await readdir(join(directory, path))).sort())
        await visit(`${path}/${name}`, true);
    } else if (stat.isFile() && /\.(?:ts|js|json)$/.test(path)) {
      hash
        .update(`${path}\0`)
        .update(await readFile(join(directory, path)))
        .update("\0");
    }
  }
  for (const path of [
    "mcpforge.runtime.json",
    "src",
    "dist",
    "package.json",
    "tsconfig.json",
    "package-lock.json",
  ]) {
    await visit(path, path !== "dist" && path !== "package-lock.json");
  }
  return hash.digest("hex");
}

export async function generationIsCurrent(directory: string): Promise<boolean> {
  try {
    const manifest = JSON.parse(
      await readFile(join(directory, "mcpforge.runtime.json"), "utf8"),
    );
    const current = await getGeneratorIdentity();
    return (
      manifest.schemaVersion === 1 &&
      manifest.runtimeVersion === GENERATOR_RUNTIME_VERSION &&
      manifest.templateHash === current.templateHash
    );
  } catch {
    return false;
  }
}
