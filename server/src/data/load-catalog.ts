import Ajv from "ajv";
import type { Card, EffectType, TargetRules } from "../shared/types.js";
import catalogSchema from "./card-catalog.schema.json" with { type: "json" };
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CATALOG_PATH = join(__dirname, "card-catalog.json");

export interface LoadedCatalog {
  cards: Card[];
  byId: Map<string, Card>;
  byArchetype: Map<EffectType, Card[]>;
}

let cached: LoadedCatalog | null = null;

function toTargetRules(raw: Record<string, unknown>): TargetRules {
  return {
    scope: (raw.scope as TargetRules["scope"]) ?? "self",
    requires: (raw.requires as string[]) ?? [],
  };
}

function toCard(raw: Record<string, unknown>): Card {
  return {
    id: raw.id as string,
    name: raw.name as string,
    type: raw.type as Card["type"],
    deck: raw.deck as Card["deck"],
    subtype: raw.subtype as string,
    rarity: raw.rarity as Card["rarity"],
    effectType: raw.effectType as EffectType,
    effectParams: raw.effectParams as Record<string, unknown>,
    targetRules: toTargetRules(raw.targetRules as Record<string, unknown>),
  };
}

function buildIndex(cards: Card[]): LoadedCatalog {
  const byId = new Map<string, Card>();
  const byArchetype = new Map<EffectType, Card[]>();

  for (const card of cards) {
    byId.set(card.id, card);
    const list = byArchetype.get(card.effectType);
    if (list) {
      list.push(card);
    } else {
      byArchetype.set(card.effectType, [card]);
    }
  }

  return { cards, byId, byArchetype };
}

export function resetCatalogCache(): void {
  cached = null;
}

export function loadCatalog(): Card[] {
  if (cached) return cached.cards;

  const raw = readFileSync(CATALOG_PATH, "utf-8");
  const catalogJson = JSON.parse(raw) as Record<string, unknown>;

  const ajv = new (Ajv as unknown as { new (options?: object): { compile(schema: unknown): (data: unknown) => boolean; errors?: unknown[] } })({ allErrors: true });

  const validate = ajv.compile(catalogSchema);

  const valid = validate(catalogJson.cards);
  if (!valid) {
    const errors = (validate as { errors?: unknown[] }).errors ?? [];
    const rawErr = JSON.stringify(errors, null, 2);
    throw new Error(`Card catalog validation failed: ${rawErr}`);
  }

  cached = buildIndex((catalogJson.cards as Record<string, unknown>[]).map(toCard));
  return cached.cards;
}

export function getCardById(id: string): Card {
  const card = loadCatalog().find((c) => c.id === id);
  if (!card) throw new Error(`Card not found: ${id}`);
  return card;
}

export function getCardsByArchetype(effectType: EffectType): Card[] {
  const indexed = buildIndex(loadCatalog());
  return indexed.byArchetype.get(effectType) ?? [];
}
