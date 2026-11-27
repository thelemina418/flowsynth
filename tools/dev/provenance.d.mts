// Type surface for tools/dev/provenance.mjs — the implementation is plain
// JavaScript so the capture preflight runs under plain node; this declaration
// is what the TypeScript side (vite.config.ts, tests) compiles against.

export interface SourceChange {
  path: string;
  /** Porcelain XY state, e.g. "M", " D", "??", "R ". */
  state: string;
}

export interface SourceStatus {
  /** True when no source change differs from the identified commit. */
  clean: boolean;
  /** Changes that taint evidence — anything not under an evidence-output path. */
  changes: SourceChange[];
  /** Evidence-output changes (docs/evidence/**, .dev/**) — reported, never tainting. */
  evidence: SourceChange[];
}

export interface DevProvenance {
  app: string;
  worktree: string;
  branch: string | null;
  commit: string | null;
  /** Null when git is unavailable; the preflight refuses evidence then. */
  source: SourceStatus | null;
}

export declare const EVIDENCE_OUTPUT_PREFIXES: readonly string[];

export declare function isEvidenceOutputPath(filePath: string): boolean;

export declare function readSourceStatus(root: string): SourceStatus | null;

export declare function devProvenance(root?: string): DevProvenance;

/** The dev server's provenance route, hung off the origin. */
export declare const ENDPOINT_PATH: string;
