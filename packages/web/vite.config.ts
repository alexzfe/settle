import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "IDH_");
  const server = `http://127.0.0.1:${env.IDH_PORT || 4380}`;
  return {
    plugins: [react()],
    server: {
      proxy: { "/health": server, "/api": server, "/events": server },
    },
  };
});
