// Issues #253 and #454: development-only provenance for the serving checkout —
// the absolute worktree path, branch, current commit, and whether the served
// source still matches that commit. The dev server serves it at
// /-/dev/provenance so a browser look can be tied to the exact checkout and
// source state under review. Nothing here ever runs in a production build.
import { execFileSync } from "node:child_process";
import path from "node:path";

export const ENDPOINT_PATH = "/-/dev/provenance";

// Issue #454: evidence outputs are products of capturing evidence, not inputs
// to the served app — the captures and their READMEs, the preflight's own
// record, and the dev-server log. They never taint source cleanliness.
export const EVIDENCE_OUTPUT_PREFIXES = ["docs/evidence", ".dev"];

export function isEvidenceOutputPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return EVIDENCE_OUTPUT_PREFIXES.some(
    (candidate) => normalized === candidate || normalized.startsWith(`${candidate}/`),
  );
}

const unquote = (rawPath) =>
  rawPath.startsWith('"') && rawPath.endsWith('"') ? rawPath.slice(1, -1) : rawPath;

// The one authoritative read of a checkout's working tree: every non-ignored
// change git reports, split into source changes (which taint evidence) and
// evidence outputs (which never do). A rename taints when either side is a
// source path. Null when git is unavailable — cleanliness is then unknown,
// and the preflight must refuse evidence rather than assume.
export function readSourceStatus(root) {
  let status;
  try {
    status = execFileSync("git", ["status", "--porcelain=v1", "-uall", "--"], {
      cwd: root,
      encoding: "utf8",
    });
  } catch {
    return null;
  }
  const changes = [];
  const evidence = [];
  for (const line of status.split("\n")) {
    if (!line) continue;
    const state = line.slice(0, 2);
    const sides = unquote(line.slice(3))
      .split(" -> ")
      .map((side) => unquote(side));
    const entry = { path: sides[sides.length - 1], state };
    if (sides.every(isEvidenceOutputPath)) evidence.push(entry);
    else changes.push(entry);
  }
  return { clean: changes.length === 0, changes, evidence };
}

const git = (args, cwd) => {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
};

// Recomputed per call, not cached at server start: a server restarted after
// a checkout change — or even one that keeps running across one — reports
// the commit now checked out, never a stale one.
export function devProvenance(root = process.cwd()) {
  // --show-toplevel resolves to this worktree's root, not the main checkout.
  const worktree = git(["rev-parse", "--show-toplevel"], root) ?? root;
  const commit = git(["rev-parse", "HEAD"], worktree);
  return {
    app: "flowsynth",
    worktree,
    branch: git(["branch", "--show-current"], worktree),
    commit,
    // Cleanliness is only meaningful against a known commit; without git it
    // stays null and the capture preflight refuses evidence.
    source: commit === null ? null : readSourceStatus(worktree),
  };
}
