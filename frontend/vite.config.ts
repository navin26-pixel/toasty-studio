import { defineConfig } from "vite";

// In dev, Vite serves the UI on :5173 and forwards API and WebSocket calls to the Python server on :8000.
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
});
