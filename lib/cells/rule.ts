import {
  dimensionsForLevel,
  type Account,
  type Dimension,
  type GranularityLevel,
  type TerritoryRule,
} from "@/lib/domain";

type Term = Partial<Record<Dimension, string>>;

function matches(account: Account, term: Term): boolean {
  for (const [dimension, value] of Object.entries(term)) {
    if (account[dimension as Dimension] !== value) return false;
  }
  return true;
}

function termKey(term: Term, dimensions: readonly Dimension[]): string {
  return dimensions.map((d) => term[d] ?? "*").join(" ");
}

/**
 * Collapses a set of full cell tuples into the fewest terms describing the same
 * accounts.
 *
 * A rep who owns Manufacturing in all four regions should be told they own
 * Manufacturing, not handed four lines. The collapse is sound because a
 * dimension is only wildcarded when the term set covers every value of it that
 * is *occupied* in this universe. Unoccupied tuples contain no accounts, so
 * widening into them cannot capture anybody else's book. That soundness is what
 * the round-trip test actually checks, rather than trusting this paragraph.
 */
function collapse(
  terms: Term[],
  occupied: Term[],
  dimensions: readonly Dimension[],
): Term[] {
  let current = terms;

  for (let pass = 0; pass < dimensions.length; pass++) {
    let changed = false;

    for (const dimension of dimensions) {
      const groups = new Map<string, Term[]>();
      const untouched: Term[] = [];

      for (const term of current) {
        if (term[dimension] === undefined) {
          untouched.push(term);
          continue;
        }
        const rest: Term = { ...term };
        delete rest[dimension];
        const key = termKey(rest, dimensions);
        groups.set(key, [...(groups.get(key) ?? []), term]);
      }

      const next: Term[] = [...untouched];
      let collapsedAny = false;

      for (const group of groups.values()) {
        const context: Term = { ...(group[0] as Term) };
        delete context[dimension];

        // Which values of this dimension actually exist under this context?
        const needed = new Set<string>();
        for (const tuple of occupied) {
          let inContext = true;
          for (const [d, v] of Object.entries(context)) {
            if (tuple[d as Dimension] !== v) {
              inContext = false;
              break;
            }
          }
          if (inContext && tuple[dimension] !== undefined) {
            needed.add(tuple[dimension] as string);
          }
        }

        const have = new Set(group.map((t) => t[dimension] as string));
        const coversAll = needed.size > 0 && [...needed].every((v) => have.has(v));

        if (coversAll) {
          next.push(context);
          collapsedAny = true;
        } else {
          next.push(...group);
        }
      }

      if (collapsedAny) {
        // Two groups can collapse onto the same term; de-duplicate.
        const seen = new Set<string>();
        current = next.filter((term) => {
          const key = termKey(term, dimensions);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        changed = true;
      }
    }

    if (!changed) break;
  }

  return [...current].sort((a, b) =>
    termKey(a, dimensions) < termKey(b, dimensions) ? -1 : 1,
  );
}

/**
 * Renders a territory as a rule: a cell set, plus the accounts lifted in or out
 * as exceptions.
 *
 * Exceptions are *shown*, never folded into the predicate. A rule that hid them
 * would still describe a correct assignment while quietly lying, and the rep who
 * lost an account would find out from the CRM instead of from the plan.
 */
export function renderRule(args: {
  cellValues: Term[];
  occupiedCellValues: Term[];
  level: GranularityLevel;
  plus: string[];
  minus: string[];
}): TerritoryRule {
  const dimensions = dimensionsForLevel(args.level);
  return {
    include: collapse(args.cellValues, args.occupiedCellValues, dimensions),
    plus: [...args.plus].sort(),
    minus: [...args.minus].sort(),
  };
}

/**
 * Evaluates a rule against the universe. The inverse of `renderRule`, and the
 * subject of sweep invariant 6.
 */
export function evaluateRule(
  rule: TerritoryRule,
  accounts: Account[],
): Set<string> {
  const minus = new Set(rule.minus);
  const plus = new Set(rule.plus);
  const result = new Set<string>();

  for (const account of accounts) {
    if (plus.has(account.id)) {
      result.add(account.id);
      continue;
    }
    if (minus.has(account.id)) continue;
    if (rule.include.some((term) => matches(account, term))) result.add(account.id);
  }
  return result;
}

/** Human-readable rule text, as it would appear in a territory document. */
export function formatRule(
  rule: TerritoryRule,
  level: GranularityLevel,
  nameOf: (accountId: string) => string = (id) => id,
): string {
  const dimensions = dimensionsForLevel(level);
  const terms = rule.include.map((term) => {
    const parts = dimensions
      .filter((d) => term[d] !== undefined)
      .map((d) => term[d] as string);
    return parts.length === 0 ? "everything" : parts.join(" × ");
  });

  let text = terms.length === 0 ? "no cells" : terms.join(", ");
  if (rule.plus.length > 0) text += `, plus ${rule.plus.map(nameOf).join(", ")}`;
  if (rule.minus.length > 0) text += `, minus ${rule.minus.map(nameOf).join(", ")}`;
  return text;
}
