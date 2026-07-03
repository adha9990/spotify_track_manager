// Assemble everything the packaged app ships outside the asar, into apps/desktop/build/.
// electron-builder then copies build/* into the app's resources/ (see electron-builder.yml):
//
//   build/frontend/index.html …            → resources/frontend   (loaded by the window)
//   build/backend/server.cjs               → resources/backend    (forked child process)
//   build/backend/node_modules/better-sqlite3 → resolved by server.cjs's require()
//
// Keeping the native module right next to the backend bundle is what makes
// `require("better-sqlite3")` resolve in the packaged app without any path hacks.

import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const repo = join(desktop, "..", "..");
const build = join(desktop, "build");

// better-sqlite3's only runtime need is `bindings` (→ file-uri-to-path). `prebuild-install`
// and its large tree are install-time only — skip them so we don't ship ~40 dead packages.
const INSTALL_ONLY = new Set(["prebuild-install"]);

const must = (path, hint) => {
  if (!existsSync(path)) {
    console.error(`stage: missing ${path}\n       ${hint}`);
    process.exit(1);
  }
};

// Windows: files copied from the pnpm store can be read-only, so a plain rm of a
// prior build EPERMs. Clear attributes first, then remove with retries.
function cleanBuild() {
  if (!existsSync(build)) return;
  const makeWritable = (p) => {
    try {
      const st = statSync(p);
      chmodSync(p, st.isDirectory() ? 0o777 : 0o666);
      if (st.isDirectory()) for (const e of readdirSync(p)) makeWritable(join(p, e));
    } catch {
      /* best-effort */
    }
  };
  makeWritable(build);
  rmSync(build, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

cleanBuild();
mkdirSync(join(build, "backend"), { recursive: true });

// 1. Frontend build → build/frontend
const frontend = join(repo, "apps", "frontend", "dist");
must(join(frontend, "index.html"), "run `pnpm -r build` first");
cpSync(frontend, join(build, "frontend"), { recursive: true });

// 2. Self-contained backend bundle → build/backend/server.cjs
const server = join(repo, "apps", "backend", "dist", "server.cjs");
must(server, "run `pnpm --filter @stm/backend bundle` first");
cpSync(server, join(build, "backend", "server.cjs"));

// 3. better-sqlite3 + its runtime dep closure → build/backend/node_modules (flat,
//    matching Node resolution). pnpm keeps these in the store, not inside the
//    better-sqlite3 folder, so a single copy misses them — walk the closure. The
//    .node binary is rebuilt for Electron's ABI by the `rebuild:native` step next.
const destNM = join(build, "backend", "node_modules");
const copied = new Set();

function copyClosure(pkg, fromPackageJson) {
  if (copied.has(pkg) || INSTALL_ONLY.has(pkg)) return;
  const req = createRequire(fromPackageJson);
  let pkgJsonPath;
  try {
    pkgJsonPath = req.resolve(`${pkg}/package.json`);
  } catch {
    return; // optional/peer dep absent — fine to skip
  }
  copied.add(pkg);
  cpSync(dirname(pkgJsonPath), join(destNM, pkg), { recursive: true, dereference: true });
  const deps = JSON.parse(readFileSync(pkgJsonPath, "utf8")).dependencies ?? {};
  for (const dep of Object.keys(deps)) copyClosure(dep, pkgJsonPath);
}

const backendPkg = join(repo, "apps", "backend", "package.json");
copyClosure("better-sqlite3", backendPkg);
// The offline embedding stack: onnxruntime-node (prebuilt N-API native — no
// electron-rebuild, it runs under the forked Node) + transformers.js and their
// runtime closures, resolved next to server.cjs so require() finds them.
copyClosure("onnxruntime-node", backendPkg);
copyClosure("@huggingface/transformers", backendPkg);

// 4. LaBSE model files → build/backend/models (read at runtime via STM_MODEL_PATH).
//    Optional: absent → the packaged app just runs with cross-language detection off.
const models = join(repo, "apps", "backend", "models");
if (existsSync(models)) {
  cpSync(models, join(build, "backend", "models"), { recursive: true, dereference: true });
  console.log("staged model →", join(build, "backend", "models"));
} else {
  console.warn(
    "stage: apps/backend/models missing — cross-language detection will be DISABLED in the\n" +
      "       packaged app. Run `node apps/backend/scripts/fetch-model.mjs` first to include it.",
  );
}

console.log("staged →", build, "\nnative deps:", [...copied].join(", "));
