import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the build works from any path (e.g. crispymushroom.github.io/task-lube/)
export default defineConfig({
  base: "./",
  plugins: [react()],
});
