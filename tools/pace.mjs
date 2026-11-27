// Issue #20: `npm run pace`, the pace runner's thin CLI. It loads the pure
// engine module through Vite's SSR loader (the engine is TypeScript with
// extensionless imports) and prints the report. Consulted, never a gate:
// it exits 0 whatever the report says, and it is not part of check or test.
//
//   npm run pace                 # 250 credited hours, the full horizon
//   npm run pace -- --hours 40
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function hoursArg(argv) {
  const at = argv.indexOf("--hours");
  if (at === -1) return 250;
  const hours = Number(argv[at + 1]);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.error("Usage: npm run pace -- [--hours <credited hours>]");
    process.exit(2);
  }
  return hours;
}

const creditedHours = hoursArg(process.argv.slice(2));
const server = await createServer({
  root: repoRoot,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});
try {
  const pace = await server.ssrLoadModule("/src/engine/pace.ts");
  console.log(pace.formatPaceReport(pace.runPace({ creditedHours })));
} finally {
  await server.close();
}
