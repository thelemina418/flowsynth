import { render } from "preact";
import "./ui/shell/shell.css";
import "./ui/board/board.css";
import "./ui/console/console.css";
import { browserSaveStorage } from "./ui/shared-save";
import { App } from "./ui/shell/App";
import { Shell } from "./ui/shell/shell";

// The entry (issue #21): load, migrate and save the player's game through
// the shell, then mount what first load owes, and then the board.
//
// The clock boundary (issue #39), ported from the old focus console's
// loop (`8ecaeac^` app.ts): a one-second timer and every visibility change
// call `shell.boundary`. Going hidden closes the span with the presence it
// had, so the hidden time that follows is accounted as away; the visible
// return settles it. The drift between the wall clock and the performance
// clock tells slept time apart (trust.applyGap).
const drift = () => Date.now() - (performance.timeOrigin + performance.now());
const shell = new Shell(browserSaveStorage, () => Date.now(), drift);
shell.boot();
render(<App shell={shell} />, document.getElementById("app")!);

let visible = document.visibilityState === "visible";
const presence = () => (visible ? "visible" : "away");

setInterval(() => shell.boundary(presence()), 1000);
document.addEventListener("visibilitychange", () => {
  shell.boundary(presence());
  visible = document.visibilityState === "visible";
  if (visible) shell.boundary("visible");
});
window.addEventListener("pagehide", () => shell.boundary(presence()));
