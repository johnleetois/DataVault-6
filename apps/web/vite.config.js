import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 8080,
    strictPort: false,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.API_TARGET_URL || "http://localhost:4000",
        changeOrigin: true
      }
    }
  },
  preview: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 8080,
    strictPort: false,
    allowedHosts: true
  }
});

