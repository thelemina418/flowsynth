import { render } from "preact";
import "./ui/shell/shell.css";
import "./ui/board/board.css";
import { browserSaveStorage } from "./ui/shared-save";
import { App } from "./ui/shell/App";
import { Shell } from "./ui/shell/shell";

// The entry (issue #21): load, migrate and save the player's game through
// the shell, then mount what first load owes, and then the board.
const shell = new Shell(browserSaveStorage);
shell.boot();
render(<App shell={shell} />, document.getElementById("app")!);
