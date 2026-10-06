import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Standard Vite assets avoid the unpatched braces dependency pulled in by
// vite-plugin-singlefile. Precache every built asset so the installed PWA
// retains offline startup, including immediately after the first installation.
function offlineShell(): Plugin {
  return {
    name: "compass-offline-shell",
    apply: "build",
    closeBundle() {
      const dist = path.resolve(__dirname, "dist");
      const assets: string[] = [];
      const walk = (relative: string) => {
        for (const entry of readdirSync(path.join(dist, relative), { withFileTypes: true })) {
          const name = path.posix.join(relative, entry.name);
          if (entry.isDirectory()) walk(name);
          else if (entry.isFile()) assets.push(`./${name}`);
        }
      };
      walk("assets");
      assets.sort();
      const shell = ["./", "./manifest.webmanifest", "./icon.svg", ...assets];
      const digest = createHash("sha256");
      // Cache-handling repairs must also invalidate any old, polluted shell.
      digest.update(readFileSync(path.join(__dirname, "public/sw.js")));
      for (const name of shell) {
        digest.update(name).update("\0");
        digest.update(readFileSync(path.join(dist, name === "./" ? "index.html" : name)));
      }
      const id = digest.digest("hex").slice(0, 16);
      const swPath = path.join(dist, "sw.js");
      const source = readFileSync(swPath, "utf8");
      const cachePattern = /const CACHE = "[^"]+";/;
      const shellPattern = /const SHELL = \[[^\n]*\];/;
      if (!cachePattern.test(source) || !shellPattern.test(source)) {
        throw new Error("Service-worker shell markers are missing");
      }
      writeFileSync(swPath, source
        .replace(cachePattern, `const CACHE = "compass-shell-v4-${id}";`)
        .replace(shellPattern, `const SHELL = ${JSON.stringify(shell)};`));

      // The post-deployment check verifies these exact served bytes, rather
      // than accepting an old page just because its title still matches.
      const names = ["index.html", "sw.js", "manifest.webmanifest", "icon.svg", "location-check.html", ...assets.map((name) => name.slice(2))];
      const files = Object.fromEntries(names.map((name) => [name,
        createHash("sha256").update(readFileSync(path.join(dist, name))).digest("hex"),
      ]));
      writeFileSync(path.join(dist, "build.json"), JSON.stringify({
        revision: process.env.GITHUB_SHA ?? "local",
        cache: `compass-shell-v4-${id}`,
        files,
      }, null, 2) + "\n");
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), offlineShell()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
