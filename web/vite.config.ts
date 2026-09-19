// Plain TanStack Start config. We deliberately do NOT use
// @lovable.dev/vite-tanstack-config: its hmr-gate/sandbox machinery is built
// for the Lovable editor preview and causes periodic full page reloads when
// the app runs outside it.
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    // src/server.ts wraps SSR errors so they render a readable page.
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
  ],
  server: {
    port: 5173,
    // Something on this machine kills idle WebSockets every ~60s, and vite's
    // client responds to each reconnect with a full page reload — fatal for a
    // live demo. HMR off = edit, then refresh manually. Delete this line on a
    // machine without the 60s socket sweeper.
    hmr: false,
    // /api -> vcs/agents through the gateway. The live board WS connects
    // directly to the gateway (see use-review-feed). NEVER proxy "/ws":
    // vite's HMR socket lives there.
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
