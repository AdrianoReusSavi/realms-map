import "dotenv/config";

export const config = {
  realmId: process.env.REALM_ID || "",
  outputPath: process.env.OUTPUT_PATH || "./output",
  backupPath: process.env.BACKUP_PATH || "./backups",
  authCachePath: process.env.AUTH_CACHE_PATH || "./auth-cache",
};