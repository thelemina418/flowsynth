import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ENTRIES } from "../engine/encyclopedia";

// The banned-word list in docs/design/philosophy.md ("Words", rule 5),
// enforced over every string a UI source file holds: string and template
// literals and JSX text. The engine's sources are scanned the same way:
// their refusal reasons and load messages reach the player verbatim.
// Comments are not copy and are not scanned.
const ROOT = join(import.meta.dirname, "..", "..");
const PHILOSOPHY = readFileSync(join(ROOT, "docs/design/philosophy.md"), "utf8");

const BANNED: { word: string; pattern: RegExp }[] = [
  ...["unlock", "boost", "enhance", "powerful", "synergy", "seamless", "journey", "unleash", "harness", "empower", "optimiz", "amazing"].map((stem) => ({
    word: stem === "optimiz" ? "optimize" : stem,
    pattern: new RegExp(`\\b${stem}\\w*`, "i"),
  })),
  { word: "level up", pattern: /\blevel(s|led|ling|ing)?[ -]up\b/i },
  { word: "exclamation marks", pattern: /!/ },
];

function bannedCopy(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.text;
    // Module specifiers are paths and property keys are names (theme
    // tokens such as "hue-booster"), not copy.
    const notCopy = ts.isStringLiteral(node) && (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent) || (ts.isPropertyAssignment(node.parent) && node.parent.name === node));
    if (text !== null && !notCopy) {
      for (const { word, pattern } of BANNED) {
        if (pattern.test(text)) found.push(`${fileName}: ${word} in ${JSON.stringify(text.trim())}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("UI copy (philosophy.md, Words rule 5)", () => {
  it("keeps the list in step with philosophy.md", () => {
    const line = PHILOSOPHY.split("\n").find((l) => l.includes("**Banned in UI copy**"))!;
    for (const { word } of BANNED) expect(line, word).toContain(word);
  });

  it("no UI source string carries a banned word or an exclamation mark", () => {
    const files = [...sources(join(ROOT, "src/ui")), join(ROOT, "src/main.tsx")];
    expect(files.length).toBeGreaterThan(3);
    const found = files.flatMap((path) => bannedCopy(readFileSync(path, "utf8"), relative(ROOT, path)));
    expect(found).toEqual([]);
  });

  it("no engine refusal or load message carries a banned word or an exclamation mark", () => {
    const files = sources(join(ROOT, "src/engine"));
    expect(files.length).toBeGreaterThan(3);
    const found = files.flatMap((path) => bannedCopy(readFileSync(path, "utf8"), relative(ROOT, path)));
    expect(found).toEqual([]);
  });

  it("no Encyclopedia entry's title or line carries a banned word or an exclamation mark", () => {
    expect(ENTRIES.length).toBe(13);
    const found = ENTRIES.flatMap((entry) =>
      [entry.title, ...entry.lines].flatMap((text) => BANNED.filter(({ pattern }) => pattern.test(text)).map(({ word }) => `${entry.id}: ${word} in ${JSON.stringify(text)}`)),
    );
    expect(found).toEqual([]);
  });

  it("catches a banned word, an inflection and an exclamation mark, in strings and JSX text", () => {
    const sample = [
      `const a = "Unlocked the Sine";`,
      "const b = `Level up ${x} now`;",
      `const c = <p>Ready to go!</p>;`,
      `const d = <p>A quiet line.</p>; // a comment may say unlock`,
      `const e = { "hue-booster": "#1f95b5", label: "Booster" };`,
    ].join("\n");
    expect(bannedCopy(sample, "sample.tsx")).toEqual([
      `sample.tsx: unlock in "Unlocked the Sine"`,
      `sample.tsx: level up in "Level up"`,
      `sample.tsx: exclamation marks in "Ready to go!"`,
      `sample.tsx: boost in "Booster"`,
    ]);
  });
});
