import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createAuthflow } from "./auth.js";
import { createRealmsApi, listRealms } from "./realms.js";
import { config } from "./config.js";
import { log } from "./logger.js";

export async function encodeAuthCache(): Promise<string> {
  const files = await readdir(config.authCachePath);
  const cache: Record<string, string> = {};

  for (const file of files) {
    cache[file] = await readFile(join(config.authCachePath, file), "utf-8");
  }

  return Buffer.from(JSON.stringify(cache)).toString("base64");
}

async function main(): Promise<void> {
  log.info("Realms Map Setup");
  log.info("Authenticating with Microsoft...");

  const auth = createAuthflow();
  const api = await createRealmsApi(auth);
  const realms = await listRealms(api);

  if (realms.length === 0) {
    log.error("No Realms found for this account.");
    process.exit(1);
  }

  const encoded = await encodeAuthCache();

  log.info("========================================");
  log.info("Add these as GitHub Secrets in your repo:");
  log.info("(Settings > Secrets and variables > Actions)");
  log.info("========================================");
  log.info(`REALM_ID=${realms[0].id}`);
  log.info("(use the ID of the Realm you want to map)");
  log.info(`AUTH_CACHE=${encoded}`);
  log.info("Then enable GitHub Pages:");
  log.info("Settings > Pages > Source: GitHub Actions");
  log.info("Setup complete.");
}

main().catch((error) => {
  log.error("Setup failed", error);
  process.exit(1);
});