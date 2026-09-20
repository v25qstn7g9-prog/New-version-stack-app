import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Vendor libraries change far less often than app code — splitting
        // them into their own chunk means a returning visitor's browser
        // cache still serves react/recharts/lucide-react unchanged after an
        // app-only deploy, instead of re-downloading everything together.
        manualChunks: {
          vendor: ["react", "react-dom", "recharts", "lucide-react"],
        },
      },
    },
  },
});
