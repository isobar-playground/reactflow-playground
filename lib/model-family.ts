// Pure, isolated derivation of Family from a Model's endpoint_id (ADR-0010,
// PRD #43, issue #44). No I/O and no React so it can be unit-tested directly
// and reused by both the filter and the browser.
//
// Family is deliberately NOT FAL's `metadata.group.key` — that field is
// version-fragmented (Kling alone spans ~15 keys) and absent on ~200 Models
// (see ADR-0010). Instead: strip the provider prefix, take the leading path
// segment, cut it before any trailing version/digit run, then merge through
// a small app-owned alias map. Unmapped tokens fall back to their own
// derived (title-cased) name.

import type { Model } from "./fal-models";

// The alias map is a deliberately maintained artifact (ADR-0010): when FAL
// introduces a new fragmenting model line (or a new spelling of an existing
// one), it needs a one-line addition here. Keys are the raw tokens as they
// appear after stripping the provider prefix and cutting any trailing
// version/digit run — some lines fragment with a *word* suffix (e.g.
// `-pro`/`-lite`) rather than a version number, so those need their own
// literal entries alongside the bare token.
const FAMILY_ALIASES: Record<string, string> = {
  ltx: "LTX",
  "ltx-video": "LTX",
  ltxv: "LTX",

  kling: "Kling",
  "kling-video": "Kling",
  "kling-image": "Kling",

  "nano-banana": "Nano Banana",
  "nano-banana-pro": "Nano Banana",
  "nano-banana-lite": "Nano Banana",

  veo: "Veo",
  veo2: "Veo",
  veo3: "Veo",

  flux: "Flux",
  "flux-pro": "Flux",
  "flux-realism": "Flux",
  "flux-lora": "Flux",
  "flux-schnell": "Flux",

  wan: "Wan",
  "wan-t2v": "Wan",
  "wan-i2v": "Wan",

  seedance: "Seedance",
  "seedance-pro": "Seedance",
  "seedance-lite": "Seedance",
};

// Matches a trailing version/digit run so e.g. "kling-v3" and "veo3" collapse
// to their bare line name before the alias lookup. Anchored at the end so an
// embedded digit mid-token (e.g. "wan-t2v") is left alone — only a *trailing*
// version run counts.
const TRAILING_VERSION = /-?v?\d[\d.-]*$/i;

export function deriveFamily(endpointId: string): string {
  const segments = endpointId.split("/");
  // segments[0] is the provider prefix (e.g. "fal-ai"); the leading path
  // segment is the model-line token that follows it.
  const rawToken = segments[1] ?? endpointId;

  const cutToken = rawToken.replace(TRAILING_VERSION, "") || rawToken;

  return FAMILY_ALIASES[cutToken.toLowerCase()] ?? titleCase(cutToken);
}

// Falls back to a readable name for tokens with no alias entry, e.g.
// "my-model" -> "My Model".
function titleCase(token: string): string {
  return token
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

// The family names to offer in the dropdown: distinct families with >= 2
// loaded Models, in first-seen order (PRD #43 / ADR-0010). Pure
// auto-derivation produces many single-Model tokens (~113 observed); those
// stay reachable via text search but are excluded here so the dropdown
// stays short and every option is meaningful.
export function familyOptions(models: Model[]): string[] {
  const counts = new Map<string, number>();
  const order: string[] = [];

  for (const model of models) {
    const family = deriveFamily(model.endpointId);
    const count = (counts.get(family) ?? 0) + 1;
    counts.set(family, count);
    if (count === 1) order.push(family);
  }

  return order.filter((family) => (counts.get(family) ?? 0) >= 2);
}
