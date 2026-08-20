import meridian from "./universes/meridian.json";
import northwind from "./universes/northwind.json";
import { parseUniverse, type Universe } from "@/lib/domain";

/**
 * The committed corpus, validated on load.
 *
 * Validation is not defensive theatre against a hostile file — nobody else
 * writes here. It is a tripwire on the generator: a pass that starts emitting a
 * band above 1 or a stage that is not a stage should fail loudly at import
 * rather than quietly skew every number downstream.
 */
const UNIVERSES: Universe[] = [meridian, northwind].map(parseUniverse);

export const DEFAULT_UNIVERSE_ID = "meridian";

export function listUniverses(): Universe[] {
  return UNIVERSES;
}

export function getUniverse(id: string): Universe | undefined {
  return UNIVERSES.find((u) => u.id === id);
}

export function requireUniverse(id: string): Universe {
  const universe = getUniverse(id);
  if (!universe) throw new Error(`unknown universe: ${id}`);
  return universe;
}
