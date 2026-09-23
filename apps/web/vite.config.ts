import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true }, // the API's CORS allow-list expects exactly this origin
  
  
  preview: {
    allowedHosts: ['taskboardweb-production.up.railway.app'],
  },
  
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
