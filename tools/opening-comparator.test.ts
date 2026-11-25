import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
// @ts-expect-error The standalone recording CLI is plain JavaScript.
import { verifiedCheckout } from "../docs/evidence/issue-543/measure.mjs";

let root: string;
let commit: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "flowsynth-543-checkout-")));
  git("init", "-q");
  writeFileSync(join(root, "source.ts"), "export const clean = true;\n");
  git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "recording source");
  commit = git("rev-parse", "HEAD");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("records the actual checkout root and full HEAD while allowing new evidence files", () => {
  mkdirSync(join(root, "docs/evidence"), { recursive: true });
  writeFileSync(join(root, "docs/evidence", "result.json"), "{}\n");
  expect(verifiedCheckout(root, commit, "from")).toMatchObject({ worktree: root, commit, source: { clean: true } });
});

it("refuses a wrong HEAD, nested directory, dirty tracked or untracked source before measuring", () => {
  expect(() => verifiedCheckout(root, "f".repeat(40), "from")).toThrow(/from checkout HEAD/);
  const nested = join(root, "nested");
  mkdirSync(nested);
  expect(() => verifiedCheckout(nested, commit, "from")).toThrow(/from checkout root/);
  writeFileSync(join(root, "new.ts"), "");
  expect(() => verifiedCheckout(root, commit, "to")).toThrow(/to checkout has uncommitted source/);
  rmSync(join(root, "new.ts"));
  writeFileSync(join(root, "source.ts"), "export const clean = false;\n");
  expect(() => verifiedCheckout(root, commit, "to")).toThrow(/to checkout has uncommitted source/);
});
