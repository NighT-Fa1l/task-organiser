import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VERCEL ? "/" : "/task-organiser/",
  server: { host: "0.0.0.0", port: 5173 },
  build: { target: "es2020", outDir: "dist", emptyOutDir: true }
});
