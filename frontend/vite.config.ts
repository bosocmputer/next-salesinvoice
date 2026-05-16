import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 3000,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@mui/x-data-grid")) return "mui-datagrid";
          if (id.includes("@mui/")) return "mui-core";
          if (id.includes("@uiw/react-json-view")) return "jsonview";
          if (id.includes("react-router")) return "react-router";
          if (id.includes("/react-dom/") || id.includes("/react/") || id.includes("scheduler")) return "react";
          return undefined;
        },
      },
    },
  },
});
