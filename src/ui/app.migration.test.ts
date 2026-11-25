// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { App } from "./app";
import { ORIGINAL_SAVE_KEY, PRE_V13_ORIGINAL_SAVE_KEY, PRE_V14_ORIGINAL_SAVE_KEY, PRE_V15_ORIGINAL_SAVE_KEY, STORAGE_KEY, serialize } from "../engine/save";
import { chooseRoll, startSession } from "../engine/actions";
import { advance } from "../engine/advance";
import { bankableClaimOf } from "../engine/accumulator";
import { createInitialState, createWeapon, createWorldColumn } from "../engine/state";
import { BALANCE } from "../engine/constants";
import { worldCellReserved, worldPiecesOf } from "../engine/world";
import { SharedSave, memorySaveStorage, type SaveStorage } from "./shared-save";
import { createAppFixture } from "./testing/app-fixture";

// The calibrated-economy migration's save/import flow (issue #493): the
// one-time conversion explains itself where the save arrives, the exact
// original bytes stand retained before anything replaces them, and a
// reload never explains twice.

const fixture = createAppFixture();
const boot = fixture.boot;
let app: App;

beforeEach(() => {
  localStorage.clear();
  app = boot(undefined, false, new SharedSave(memorySaveStorage()));
});
afterEach(() => { fixture.release(); vi.restoreAllMocks(); });

// A finite overpowered v12 save: the parent's shape, every figure
// representable — runaway levels, a deep era, banked Arete, one claimed
// frontier step.
function overpoweredV12(savedAt = 750): string {
  const state = createInitialState();
  const mod = state.modules[0]!;
  mod.level = 1504;
  mod.invested = 1.6e308;
  state.nous = 8.2e9;
  state.eraEarned = 4e14;
  state.arete = 4;
  state.world.frontier = 1;
  const file = JSON.parse(serialize(state, savedAt));
  file.version = 12;
  return JSON.stringify(file);
}

function mapStorage(files: Map<string, string>): SaveStorage {
  return {
    getItem: (key: string) => files.get(key) ?? null,
    setItem: (key: string, value: string) => files.set(key, value),
    removeItem: (key: string) => { files.delete(key); },
  };
}

function priorFootprint(): string {
  const file = JSON.parse(serialize(createInitialState(), 750));
  file.version = 13;
  file.state.cells.push({ q: 0, r: 2 }, { q: 0, r: 3 });
  file.state.cellsBought = 2;
  file.state.modules[0].pos = { q: 0, r: 3 };
  file.state.unlockedRows = [3, -2];
  file.state.gatedRows = [0, 1, 2, 3, -2];
  return JSON.stringify(file);
}

describe("distance pricing at the save boundary (issue #543)", () => {
  it("retains the exact v13 source beside both earlier originals and explains its refund once", () => {
    const raw = priorFootprint();
    const files = new Map([[STORAGE_KEY, raw], [ORIGINAL_SAVE_KEY, "earlier"], [PRE_V13_ORIGINAL_SAVE_KEY, "archived"]]);
    const storage = mapStorage(files);
    app = boot(undefined, false, new SharedSave(storage));
    expect(document.getElementById("status")!.textContent).toContain("3 Arete returned");
    expect(app.state.modules[0]!.pos).toEqual({ q: 0, r: 3 });
    expect(app.state.arete).toBe(3);
    expect(files.get(PRE_V14_ORIGINAL_SAVE_KEY)).toBe(raw);
    expect(files.get(ORIGINAL_SAVE_KEY)).toBe("earlier");
    expect(files.get(PRE_V13_ORIGINAL_SAVE_KEY)).toBe("archived");
    expect(JSON.parse(files.get(STORAGE_KEY)!).version).toBe(15);
    app = boot(undefined, false, new SharedSave(storage));
    expect(document.getElementById("status")!.textContent).not.toContain("Arete returned");
    expect(app.state.arete).toBe(3);
  });

  it("protects the v13 source from ordinary and forced writes if backup is denied", () => {
    const raw = priorFootprint();
    const files = new Map([[STORAGE_KEY, raw], [ORIGINAL_SAVE_KEY, "earlier"], [PRE_V13_ORIGINAL_SAVE_KEY, "archived"]]);
    app = boot(undefined, false, new SharedSave({ ...mapStorage(files), setItem(key, value) {
      if (key === PRE_V14_ORIGINAL_SAVE_KEY) throw new Error("quota exceeded");
      files.set(key, value);
    } }));
    expect(app.state.arete).toBe(0);
    app.save();
    app.save(Date.now(), true);
    expect(files.get(STORAGE_KEY)).toBe(raw);
    expect(files.get(ORIGINAL_SAVE_KEY)).toBe("earlier");
    expect(files.get(PRE_V13_ORIGINAL_SAVE_KEY)).toBe("archived");
  });
});

function priorCombat(lost = false): string {
  const state = createInitialState();
  state.arete = 3;
  state.nous = 555;
  state.eraEarned = 20_000_000;
  state.world.unlocked = state.world.starterColumnGranted = state.world.starterWeaponGranted = true;
  state.world.frontier = 2;
  state.world.hone.chargeBlade = 1;
  state.cells.push({ q: -1, r: 0 });
  state.modules[0]!.pos = { q: -1, r: 0 }; // occupied below old cleared World wall
  const blade = createWeapon(state, "chargeBlade");
  const column = createWorldColumn(state);
  state.world.weapons.push({ ...blade, pos: state.cells[1]!, store: 9, cooldown: 55 });
  state.world.columns.push({ ...column, pos: state.cells[2]! });
  state.bankedRolls = [{ id: "historical-offer", candidates: [
    { id: "old-world", type: "chargeBlade" }, { id: "old-synth", type: "additive", tier: 1 }, { id: "old-synth-2", type: "square", tier: 1 },
  ] }];
  const file = JSON.parse(serialize(state, 700));
  file.version = 14;
  const { unlocked, starterColumnGranted, starterWeaponGranted, frontier, hone, weapons, columns } = file.state.world;
  file.state.world = { unlocked, starterColumnGranted, starterWeaponGranted, frontier, hone, weapons, columns,
    enemies: { w0: { discovered: true, hp: 0 }, w1: { discovered: true, hp: 4 } } };
  if (lost) file.state.arete = null;
  return JSON.stringify(file, null, 3);
}

describe("lifetime combat migration (issue #544)", () => {
  it("archives exact v14 bytes beside earlier originals, keeps valid ledgers and opens a fresh sequence once", () => {
    const source = priorCombat();
    const before = JSON.parse(source).state;
    const files = new Map([[STORAGE_KEY, source], [ORIGINAL_SAVE_KEY, "v12 source"], [PRE_V13_ORIGINAL_SAVE_KEY, "older"], [PRE_V14_ORIGINAL_SAVE_KEY, "v13 source"]]);
    app = boot(undefined, false, new SharedSave(mapStorage(files)));
    expect(files.get(PRE_V15_ORIGINAL_SAVE_KEY)).toBe(source);
    expect(files.get(ORIGINAL_SAVE_KEY)).toBe("v12 source");
    expect(files.get(PRE_V13_ORIGINAL_SAVE_KEY)).toBe("older");
    expect(files.get(PRE_V14_ORIGINAL_SAVE_KEY)).toBe("v13 source");
    expect(document.getElementById("status")!.textContent).toContain("Old Blade-only clears do not count");
    expect(app.state).toMatchObject({ arete: 3, nous: 555, eraEarned: 20_000_000, cells: before.cells, modules: before.modules, bankedRolls: before.bankedRolls });
    expect(app.state.world).toMatchObject({ frontier: 2, hone: before.world.hone });
    expect(app.state.world.weapons).toHaveLength(1);
    expect(app.state.world.weapons[0]).toMatchObject({ pos: before.world.weapons[0].pos, store: 9, cooldown: 0 });
    expect(app.state.world.columns).toEqual(before.world.columns);
    expect(app.state.world.enemies.shale).toEqual({ discovered: true, hp: 48 });
    expect(worldCellReserved(app.state, { q: -1, r: 0 })).toBe(true);
    expect(worldPiecesOf(app.state).filter(({ copy }) => copy.pos === null)).toHaveLength(4);
    expect(JSON.parse(files.get(STORAGE_KEY)!).version).toBe(15);
    app = boot(undefined, false, new SharedSave(mapStorage(files)));
    expect(worldPiecesOf(app.state)).toHaveLength(6);
    expect(document.getElementById("status")!.textContent).not.toContain("Old Blade-only");
    expect(chooseRoll(app.state, "historical-offer", "old-world").ok).toBe(true);
    expect(app.state.world.weapons).toHaveLength(2);
  });

  it("protects exact v14 bytes on denied backup, including forced writes", () => {
    const source = priorCombat();
    const files = new Map([[STORAGE_KEY, source], [ORIGINAL_SAVE_KEY, "old"]]);
    const storage = { ...mapStorage(files), setItem(key: string, value: string) {
      if (key === PRE_V15_ORIGINAL_SAVE_KEY) throw new Error("quota exceeded");
      files.set(key, value);
    } };
    app = boot(undefined, false, new SharedSave(storage));
    expect(app.state.world.unlocked).toBe(false);
    app.save();
    app.save(Date.now(), true);
    expect(files.get(STORAGE_KEY)).toBe(source);
    expect(files.get(ORIGINAL_SAVE_KEY)).toBe("old");
  });

  it("requires explicit recovery for lost v14 money and retains the source on successful recovery", () => {
    const source = priorCombat(true);
    const files = new Map([[STORAGE_KEY, source], [ORIGINAL_SAVE_KEY, "old"], [PRE_V13_ORIGINAL_SAVE_KEY, "older"]]);
    app = boot(undefined, false, new SharedSave(mapStorage(files)));
    expect(app.ui.recovery?.lost).toContain("arete");
    app.save(Date.now(), true);
    expect(files.get(STORAGE_KEY)).toBe(source);
    document.getElementById("recovery-apply")!.click();
    expect(files.get(PRE_V15_ORIGINAL_SAVE_KEY)).toBe(source);
    expect(files.get(ORIGINAL_SAVE_KEY)).toBe("old");
    expect(files.get(PRE_V13_ORIGINAL_SAVE_KEY)).toBe("older");
    expect(app.state.arete).toBe(0);
    expect(worldPiecesOf(app.state)).toHaveLength(6);
  });
});

describe("the calibrated migration's flow (issue #493)", () => {
  it("booting a stored v12 save explains the migration, retains the original bytes, and lands calibrated", () => {
    const source = overpoweredV12();
    const files = new Map<string, string>([[STORAGE_KEY, source]]);
    app = boot(undefined, false, new SharedSave(mapStorage(files)));
    // The report stands and names the movement.
    expect(app.ui.migration).toMatchObject({ fromVersion: 12, modulesCleared: 1, nousCleared: 8.2e9, eraEarnedCleared: 4e14, frontierCleared: 1, areteRetained: 4 });
    expect(app.ui.modal).toBe("migration");
    // The exact stored bytes were retained before the boot save replaced
    // the slot with the converted v13 file.
    expect(files.get(ORIGINAL_SAVE_KEY)).toBe(source);
    const stored = JSON.parse(files.get(STORAGE_KEY)!);
    expect(stored.version).toBe(15);
    expect(stored.state.nous).toBe(BALANCE.openingGrant);
    expect(stored.state.eraEarned).toBe(0);
    expect(stored.state.world.frontier).toBe(0);
    expect(stored.state.arete).toBe(4);
  });

  it("an existing lineage backup survives beside the exact pre-conversion bytes", () => {
    const source = overpoweredV12();
    const earlier = serialize({ ...createInitialState(), nous: 7 }, 100);
    const files = new Map<string, string>([[STORAGE_KEY, source], [ORIGINAL_SAVE_KEY, earlier]]);
    app = boot(undefined, false, new SharedSave(mapStorage(files)));
    expect(app.retainedOriginal()).toBe(source);
    expect(files.get(PRE_V13_ORIGINAL_SAVE_KEY)).toBe(earlier);
    expect(JSON.parse(files.get(STORAGE_KEY)!).version).toBe(15);
    app.closeModal();
    app = boot(undefined, false, new SharedSave(mapStorage(files)));
    expect(app.retainedOriginal()).toBe(source);
    expect(files.get(PRE_V13_ORIGINAL_SAVE_KEY)).toBe(earlier);
  });

  it.each([PRE_V13_ORIGINAL_SAVE_KEY, ORIGINAL_SAVE_KEY])("migration backup denial at %s replaces neither the current save nor the earlier original", (deniedKey) => {
    const source = overpoweredV12();
    const earlier = serialize(createInitialState(), 100);
    const files = new Map<string, string>([[STORAGE_KEY, source], [ORIGINAL_SAVE_KEY, earlier]]);
    const storage: SaveStorage = {
      ...mapStorage(files),
      setItem: (key, value) => {
        if (key === deniedKey) throw new Error("quota exceeded");
        files.set(key, value);
      },
    };
    app = boot(undefined, false, new SharedSave(storage));
    expect(app.ui.migration).toBeNull();
    app.save();
    app.save(Date.now(), true);
    expect(files.get(STORAGE_KEY)).toBe(source);
    expect(files.get(ORIGINAL_SAVE_KEY)).toBe(earlier);
  });

  it.each([10, 11, 12])("lost-money v%s boot preserves both slots until explicit recovery", (version) => {
    const file = JSON.parse(overpoweredV12());
    file.version = version;
    file.state.nous = null;
    file.state.arete = null;
    const source = JSON.stringify(file);
    const earlier = serialize(createInitialState(), 100);
    const files = new Map<string, string>([[STORAGE_KEY, source], [ORIGINAL_SAVE_KEY, earlier]]);
    app = boot(undefined, false, new SharedSave(mapStorage(files)));
    // The recovery offer (issue #494) stands where the save arrived; the
    // migration never claims it, and no duplicate load notice rides
    // beside the offer.
    expect(app.ui.migration).toBeNull();
    expect(app.ui.recovery).toMatchObject({ from: "boot" });
    expect(app.ui.modal).toBe("recovery");
    expect(document.getElementById("status")!.textContent).not.toContain("Could not load");
    app.save();
    app.save(Date.now(), true);
    expect(files.get(STORAGE_KEY)).toBe(source);
    expect(files.get(ORIGINAL_SAVE_KEY)).toBe(earlier);
  });

  it("a lost-money import adopts nothing and leaves both slots intact", () => {
    app = boot(undefined, false, new SharedSave(localStorage));
    const primary = localStorage.getItem(STORAGE_KEY);
    const original = localStorage.getItem(ORIGINAL_SAVE_KEY);
    const before = serialize(app.state, 1000);
    const file = JSON.parse(overpoweredV12());
    file.state.eraEarned = null;
    expect(app.importText(JSON.stringify(file))).toBe(false);
    // The recovery offer (issue #494) stands at the import destination;
    // declining is what returns the message, and nothing was adopted.
    expect(app.ui.recovery).toMatchObject({ from: "import" });
    app.declineRecovery();
    expect(app.ui.importError).toContain("recovery");
    expect(serialize(app.state, 1000)).toBe(before);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(primary);
    expect(localStorage.getItem(ORIGINAL_SAVE_KEY)).toBe(original);
  });

  it("honesty credits the retained minutes without resurrecting old money, then explains the cleared bucket", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const state = createInitialState();
    state.modules[0]!.level = 100;
    startSession(state, null);
    advance(state, 600, () => 0.4, "provisional");
    const file = JSON.parse(serialize(state));
    file.version = 12;
    const files = new Map<string, string>([[STORAGE_KEY, JSON.stringify(file)]]);
    app = boot(undefined, false, new SharedSave(mapStorage(files)));
    expect(app.ui.modal).toBe("honesty");
    expect(app.state.session!.accounting.bucketNous).toBe(0);
    app.resolveHonesty("full");
    expect(app.state.session!.accounting.creditedSeconds).toBe(600);
    expect(app.state.eraEarned).toBe(0);
    expect(bankableClaimOf(app.state)).toBe(0);
    expect(app.ui.modal).toBe("migration");
    expect(document.getElementById("modal-content")!.textContent).toContain("held from the old economy cleared");
    app.finishMigration();
    const reloaded = boot(undefined, false, new SharedSave(mapStorage(files)));
    expect(reloaded.ui.migration).toBeNull();
    expect(reloaded.ui.modal).toBeNull();
    expect(reloaded.state.session!.accounting.creditedSeconds).toBe(600);
  });

  it("the explanation presents once: a reload of the converted save stands silent", () => {
    const files = new Map<string, string>([[STORAGE_KEY, overpoweredV12()]]);
    app = boot(undefined, false, new SharedSave(mapStorage(files)));
    app.closeModal();
    expect(app.ui.migration).toBeNull();
    expect(app.ui.modal).toBeNull();
    const second = boot(undefined, false, new SharedSave(mapStorage(files)));
    expect(second.ui.migration).toBeNull();
    expect(second.ui.modal).toBeNull();
  });

  it("an imported v12 save retains its source bytes and explains the economy it landed on", () => {
    app = boot(undefined, false, new SharedSave(localStorage));
    const source = overpoweredV12();
    expect(app.importText(source)).toBe(true);
    expect(localStorage.getItem(ORIGINAL_SAVE_KEY)).toBe(source);
    expect(app.ui.modal).toBe("migration");
    expect(app.state.nous).toBe(BALANCE.openingGrant);
    expect(app.state.eraEarned).toBe(0);
  });

  it("a rejected v12 save adopts nothing and its exact bytes stay retained", () => {
    const corrupt = '{"app":"flowsynth","version":12,"state":{"mode":"weird"}}';
    const files = new Map<string, string>([[STORAGE_KEY, corrupt]]);
    app = boot(undefined, false, new SharedSave(mapStorage(files)));
    // A rejected save never carries a report: the fresh instrument stands,
    // and the corrupt original is what the retained slot keeps.
    expect(app.ui.migration).toBeNull();
    expect(app.ui.modal).toBeNull();
    expect(app.state.sessionRecords).toHaveLength(0);
    expect(files.get(ORIGINAL_SAVE_KEY)).toBe(corrupt);
  });

  it("a canceled import migrates nothing: the stored save and its retained original stand untouched", () => {
    const stored = serialize({ ...createInitialState(), nous: 9 }, 500);
    localStorage.setItem(STORAGE_KEY, stored);
    app = boot(undefined, false, new SharedSave(localStorage));
    const afterBoot = localStorage.getItem(STORAGE_KEY);
    app.openModal("import");
    // The walk's cancel: closing the import modal without applying. No
    // conversion ran, nothing was adopted, and neither slot moved.
    app.closeModal();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(afterBoot);
    expect(JSON.parse(afterBoot!).state.nous).toBe(9);
    // The boot retained the first-seen bytes once; the cancel moved
    // neither slot.
    expect(localStorage.getItem(ORIGINAL_SAVE_KEY)).toBe(stored);
    expect(app.ui.modal).toBeNull();
    expect(app.ui.migration).toBeNull();
  });

  it("the explanation names what was kept and what moved, and offers the retained original", () => {
    const files = new Map<string, string>([[STORAGE_KEY, overpoweredV12()]]);
    app = boot(undefined, false, new SharedSave(mapStorage(files)));
    const content = document.getElementById("modal-content")!;
    expect(content.textContent).toContain("calibrated economy");
    // What was kept: the collection, the Arete, the life record.
    expect(content.textContent).toContain("Arete");
    // What moved: the levels and the balances, with the report's figures.
    expect(content.textContent).toContain("8.2B");
    expect(content.textContent).toContain("opening grant");
    for (const term of ["Arete", "Hone", "Catalog", "nous", "Claimed frontier"]) {
      expect(content.querySelector(`.term-trigger[aria-label="${term} — what it means"]`)).not.toBeNull();
    }
    // Charge's reusable definition moved; this reset consequence did not.
    expect(content.textContent).toContain("charge empties");
    expect(content.querySelector('[aria-label="charge — what it means"]')).toBeNull();
    // The retained original is offered, not just claimed.
    expect(content.querySelector("#migration-original")).not.toBeNull();
    app.closeModal();
    expect(app.ui.modal).toBeNull();
  });
});
