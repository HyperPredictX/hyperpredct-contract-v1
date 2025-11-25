import * as path from "path";

export function loadConfig<T = any>(
  cfgFile = process.env.CONFIG_FILE || "config/hype.ts"
): T {
  const absPath = path.isAbsolute(cfgFile)
    ? cfgFile
    : path.resolve(process.cwd(), cfgFile);

  let mod: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require(absPath);
  } catch (e1) {
    const jsCandidate = absPath.replace(/\.ts$/, ".js");
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require(jsCandidate);
    } catch (e2) {
      throw new Error(
        `Failed to load config. Tried:\n - ${absPath}\n - ${jsCandidate}\nOriginal error: ${
          (e1 as Error).message
        }`
      );
    }
  }

  const config = mod?.default ?? mod;
  if (!config || typeof config !== "object") {
    throw new Error(`Config module did not export an object: ${absPath}`);
  }
  return config as T;
}
