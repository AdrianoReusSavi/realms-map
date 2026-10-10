import { createAuthflow } from "./auth.js";
import { createRealmsApi, downloadBackup } from "./realms.js";
import { renderMap } from "./render.js";
import { config } from "./config.js";
import { log } from "./logger.js";

async function main(): Promise<void> {
  if (!config.realmId) {
    log.error("REALM_ID is not set. Run `npm run setup` first.");
    process.exit(1);
  }

  log.info("Authenticating...");
  const auth = createAuthflow();
  const api = await createRealmsApi(auth);

  log.info("Downloading backup...");
  const { worldPath, realmName } = await downloadBackup(api);

  log.info("Rendering map...");
  await renderMap(worldPath, realmName);

  log.info("Update complete.");
}

main().catch((error) => {
  log.error("Update failed", error);
  process.exit(1);
});