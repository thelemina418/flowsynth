// Vitest globalSetup: the fail-fast supported-runtime gate.
import { requireRuntimeEnvironment } from "./runtime.mjs";

export default async function runtimeGuard() {
  await requireRuntimeEnvironment();
}
