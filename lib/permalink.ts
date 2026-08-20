import { configSchema, type Config } from "@/lib/domain";

/**
 * The permalink carries the *config*, never the plan.
 *
 * The plan is a pure function of the config, so transporting it would only
 * create a second source of truth that can disagree with the first. Two people
 * opening the same link see the same carve because they ran the same
 * deterministic search, not because a blob was serialised — and if the search
 * ever stops being deterministic, the sweep says so rather than the link quietly
 * papering over it.
 */

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeConfig(config: Config): string {
  return toBase64Url(JSON.stringify(config));
}

/**
 * Decoding is a boundary, so it is validated like one. A permalink is a string
 * from the internet; a stale one from an older shape of the config should fall
 * back to the default rather than render a half-built page.
 */
export function decodeConfig(encoded: string | null | undefined): Config | null {
  if (!encoded) return null;
  try {
    const parsed = configSchema.safeParse(JSON.parse(fromBase64Url(encoded)));
    return parsed.success ? (parsed.data as Config) : null;
  } catch {
    return null;
  }
}
