import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const env = { ...process.env };

if (process.platform === "linux") {
  env.NO_STRIP = env.NO_STRIP || "1";

  const systemPc = "/usr/lib/pkgconfig/gdk-pixbuf-2.0.pc";
  const systemPixbufDir = "/usr/lib/gdk-pixbuf-2.0/2.10.0";

  if (existsSync(systemPc) && !existsSync(systemPixbufDir)) {
    const compatRoot = join(rootDir, "src-tauri", "target", "appimage-pkgconfig");
    const compatPixbufDir = join(compatRoot, "gdk-pixbuf-2.0", "2.10.0");
    const compatPkgConfigDir = join(compatRoot, "pkgconfig");

    mkdirSync(join(compatPixbufDir, "loaders"), { recursive: true });
    mkdirSync(compatPkgConfigDir, { recursive: true });

    const patchedPc = readFileSync(systemPc, "utf8").replace(
      /^gdk_pixbuf_binarydir=.*$/m,
      `gdk_pixbuf_binarydir=${compatPixbufDir}`,
    );

    writeFileSync(join(compatPkgConfigDir, "gdk-pixbuf-2.0.pc"), patchedPc);
    env.PKG_CONFIG_PATH = env.PKG_CONFIG_PATH
      ? `${compatPkgConfigDir}:${env.PKG_CONFIG_PATH}`
      : compatPkgConfigDir;
  }
}

const tauriBin = process.platform === "win32"
  ? join(rootDir, "node_modules", ".bin", "tauri.cmd")
  : join(rootDir, "node_modules", ".bin", "tauri");

const result = spawnSync(tauriBin, process.argv.slice(2), {
  cwd: rootDir,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
