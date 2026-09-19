import { loadConfig } from "./config.js";
import { NoLanAddressError } from "./lan.js";
import { startServer } from "./server.js";

const config = (() => {
  try {
    return loadConfig();
  } catch (error) {
    // A setting the server can't start with: say which and why, without a stack trace.
    console.error((error as Error).message);
    process.exit(1);
  }
})();
const server = await startServer(config).catch((error: unknown) => {
  if (error instanceof NoLanAddressError) {
    console.error(error.message);
    process.exit(1);
  }
  if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
  console.error(
    `Port ${config.port} is in use on ${config.host}. Is Settle already running? SETTLE_PORT ` +
      "picks another.",
  );
  process.exit(1);
});
console.log(
  config.publicOrigin
    ? `Settle at ${config.publicOrigin}, listening on ${config.host}:${new URL(server.url).port} ` +
        `(data in ${config.dataDir})`
    : `Settle on ${server.url} (data in ${config.dataDir})`,
);
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
