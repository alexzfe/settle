import { loadConfig } from "./config.js";
import { NoLanAddressError } from "./lan.js";
import { startServer } from "./server.js";

const config = loadConfig();
const server = await startServer(config).catch((error: unknown) => {
  if (error instanceof NoLanAddressError) {
    console.error(error.message);
    process.exit(1);
  }
  if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
  console.error(
    `Port ${config.port} is in use. Is the app already running? SETTLE_PORT picks another.`,
  );
  process.exit(1);
});
console.log(`Settle on ${server.url} (data in ${config.dataDir})`);
if (server.lanUrl) {
  console.log(
    `LAN mode: phones on this network open Quick Guides at ${server.lanUrl}/guide/<token>, the ` +
      "address each Purchase's page shows as a QR code. Nothing else is served there.",
  );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
