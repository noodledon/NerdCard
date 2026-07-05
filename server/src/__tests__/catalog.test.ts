import { describe, it, expect } from "vitest";
import { loadCatalog, getCardById, getCardsByArchetype } from "../data/load-catalog.js";
import type { EffectType } from "../shared/types.js";

describe("card catalog", () => {
  it("loads exactly 30 cards", () => {
    expect(loadCatalog().length).toBe(30);
  });

  it("resolves a card by id", () => {
    expect(getCardById("act-shield-001").name).toBe("Aegis Guard");
  });

  it("returns the expected archetype count for integral", () => {
    const cards = getCardsByArchetype("integral" as EffectType);
    expect(cards.length).toBe(1);
    expect(cards[0].effectType).toBe("integral");
  });

  it("contains the FROZEN marker in root comment", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(new URL("../data/card-catalog.json", import.meta.url), "utf-8");
    expect(content).toContain("FROZEN for v1");
  });

  it("covers every EffectType archetype at least once", () => {
    const effectTypes: EffectType[] = [
      "add_term",
      "derivative",
      "integral",
      "limit",
      "continuity",
      "modular",
      "prime",
      "nt_theorem",
      "vector",
      "matrix",
      "transform",
      "eigenvalue",
      "offensive",
      "shield",
      "trap",
      "martial_theorem",
      "artifact_theorem",
      "add_board",
      "composition",
      "force_eval",
      "eval",
    ];

    for (const et of effectTypes) {
      expect(getCardsByArchetype(et).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("rejects a tampered catalog missing an id field", async () => {
    const fs = await import("fs");
    const path = new URL("../data/card-catalog.json", import.meta.url);
    const original = fs.readFileSync(path, "utf-8");
    const json = JSON.parse(original);

    const tampered = { ...json, cards: [...json.cards] };
    delete tampered.cards[0].id;
    fs.writeFileSync(path, JSON.stringify(tampered, null, 2));

    expect(() => loadCatalog()).toThrow();

    fs.writeFileSync(path, original);
  });
});
