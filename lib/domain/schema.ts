import { z } from "zod";
import {
  AXES,
  DIMENSION_ORDER,
  EMPLOYEE_BANDS,
  GRANULARITY_LEVELS,
  INDUSTRIES,
  REGIONS,
  SEGMENTS,
  STAGES,
} from "./dimensions";
import type { Config, Universe } from "./types";

export const industrySchema = z.enum(INDUSTRIES);
export const regionSchema = z.enum(REGIONS);
export const segmentSchema = z.enum(SEGMENTS);
export const employeeBandSchema = z.enum(EMPLOYEE_BANDS);
export const stageSchema = z.enum(STAGES);
export const dimensionSchema = z.enum(DIMENSION_ORDER);
export const axisSchema = z.enum(AXES);
export const granularitySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  industry: industrySchema,
  region: regionSchema,
  segment: segmentSchema,
  employeeBand: employeeBandSchema,
  potentialUsd: z.number().nonnegative(),
  potentialBand: z.number().min(0).max(1),
  openPipelineUsd: z.number().nonnegative(),
  openOppStage: stageSchema.nullable(),
  currentOwnerId: z.string().min(1),
  tenureDays: z.number().int().nonnegative(),
  lastActivityDays: z.number().int().nonnegative(),
  isNamed: z.boolean(),
});

export const repSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

export const universeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  accounts: z.array(accountSchema).min(1),
  reps: z.array(repSchema).min(2),
});

export const exclusionSchema = z.object({
  repId: z.string().min(1),
  dimension: dimensionSchema,
  value: z.string().min(1),
});

export const constraintsSchema = z.object({
  pinned: z.record(z.string(), z.string()),
  capacity: z
    .object({ min: z.number().int().nonnegative(), max: z.number().int().positive() })
    .nullable(),
  exclusions: z.array(exclusionSchema),
  protectStage: stageSchema.nullable(),
});

/**
 * Weights are a search input, not a score. They are bounded rather than
 * normalised because a caller asking for `{count: 0, potential: 0, pipeline: 0,
 * churn: 1}` is asking a real question — "what does the status quo cost me?" —
 * and normalising it away would refuse to answer.
 */
export const weightsSchema = z.object({
  count: z.number().min(0).max(10),
  potential: z.number().min(0).max(10),
  pipeline: z.number().min(0).max(10),
  churn: z.number().min(0).max(10),
});

export const configSchema = z.object({
  universeId: z.string().min(1),
  granularity: granularitySchema,
  weights: weightsSchema,
  constraints: constraintsSchema,
  seed: z.number().int().nonnegative(),
  /** Capped because the search must terminate inside a request. */
  restarts: z.number().int().min(1).max(32),
  iterationCap: z.number().int().min(1).max(20_000),
});

export type ConfigInput = z.input<typeof configSchema>;

export const DEFAULT_WEIGHTS = {
  count: 1,
  potential: 2,
  pipeline: 1,
  churn: 2,
} as const;

export function defaultConfig(universeId: string): Config {
  return {
    universeId,
    granularity: 3,
    weights: { ...DEFAULT_WEIGHTS },
    constraints: {
      pinned: {},
      capacity: null,
      exclusions: [],
      protectStage: "negotiation",
    },
    seed: 20_260_816,
    restarts: 6,
    iterationCap: 4_000,
  };
}

export function parseUniverse(input: unknown): Universe {
  return universeSchema.parse(input) as Universe;
}

export { GRANULARITY_LEVELS };
