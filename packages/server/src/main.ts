import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

const config = loadConfig();
const server = await startServer(config).catch((error: unknown) => {
  if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
  console.error(
    `Port ${config.port} is in use. Is the app already running? IDH_PORT picks another.`,
  );
  process.exit(1);
});
console.log(`Interior Design Harness on ${server.url} (data in ${config.dataDir})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
