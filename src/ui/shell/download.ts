// Hands the viewer the exact bytes of a save as a file (ADR-0082: the
// original is downloadable before any recovery is chosen).
export function downloadSave(text: string, name = "flowsynth-original-save.json"): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
