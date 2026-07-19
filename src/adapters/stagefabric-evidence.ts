import { createHash } from "node:crypto";

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";

import type { Digest, ExecutionEvidenceBinding } from "../contracts/types.js";
import { validateAs } from "../contracts/registry.js";
import { canonicalize, digestValue, omitDigest } from "../core/canonical.js";

export const STAGEFABRIC_EXECUTION_EVIDENCE_MEDIA_TYPE =
  "application/vnd.stagefabric.execution-placement-evidence+json" as const;

type StageFabricDigest = `sha256:${string}`;

export interface StageFabricExecutionPlacement {
  stageIdDigest: StageFabricDigest;
  targetIdDigest: StageFabricDigest;
  zoneDigest: StageFabricDigest;
  adapterKindDigest: StageFabricDigest;
  attempt: number;
  status: "succeeded";
  reasonCode: "completed";
}

export interface StageFabricExecutionTraceEvent {
  stageIdDigest: StageFabricDigest;
  targetIdDigest: StageFabricDigest;
  zoneDigest: StageFabricDigest;
  adapterKindDigest: StageFabricDigest;
  attempt: number;
  status: "succeeded" | "failed";
  reasonCode:
    | "completed"
    | "retryable_pre_output_status"
    | "adapter_not_registered"
    | "adapter_failed"
    | "invalid_outputs"
    | "input_policy_rejected"
    | "output_policy_rejected";
  statusCode?: number;
}

export interface StageFabricExecutionPlacementEvidence {
  apiVersion: "stagefabric.dev/v1alpha1";
  kind: "ExecutionPlacementEvidence";
  producer: "stagefabric";
  disclosure: "content-free";
  authority: "observation-only";
  runIdDigest: StageFabricDigest;
  observedAt: string;
  planDigest: StageFabricDigest;
  bindingDigest: StageFabricDigest;
  snapshotDigest: StageFabricDigest;
  egressDigest: StageFabricDigest;
  placements: StageFabricExecutionPlacement[];
  trace: StageFabricExecutionTraceEvent[];
  digest: StageFabricDigest;
}

export type StageFabricEvidenceErrorCode =
  | "stagefabric_evidence_invalid"
  | "stagefabric_evidence_digest_mismatch"
  | "stagefabric_evidence_encoding_mismatch"
  | "stagefabric_evidence_binding_invalid";

export class StageFabricEvidenceError extends Error {
  readonly code: StageFabricEvidenceErrorCode;

  constructor(code: StageFabricEvidenceErrorCode) {
    super(code);
    this.name = "StageFabricEvidenceError";
    this.code = code;
  }
}

const digestSchema = { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } as const;
const identityDigestProperties = {
  stageIdDigest: digestSchema,
  targetIdDigest: digestSchema,
  zoneDigest: digestSchema,
  adapterKindDigest: digestSchema
} as const;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    apiVersion: { const: "stagefabric.dev/v1alpha1" },
    kind: { const: "ExecutionPlacementEvidence" },
    producer: { const: "stagefabric" },
    disclosure: { const: "content-free" },
    authority: { const: "observation-only" },
    runIdDigest: digestSchema,
    observedAt: { type: "string" },
    planDigest: digestSchema,
    bindingDigest: digestSchema,
    snapshotDigest: digestSchema,
    egressDigest: digestSchema,
    placements: {
      type: "array",
      minItems: 1,
      maxItems: 1024,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...identityDigestProperties,
          attempt: { type: "integer", minimum: 1, maximum: 33 },
          status: { const: "succeeded" },
          reasonCode: { const: "completed" }
        },
        required: [
          "stageIdDigest",
          "targetIdDigest",
          "zoneDigest",
          "adapterKindDigest",
          "attempt",
          "status",
          "reasonCode"
        ]
      }
    },
    trace: {
      type: "array",
      minItems: 1,
      maxItems: 33792,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...identityDigestProperties,
          attempt: { type: "integer", minimum: 1, maximum: 33 },
          status: { enum: ["succeeded", "failed"] },
          reasonCode: {
            enum: [
              "completed",
              "retryable_pre_output_status",
              "adapter_not_registered",
              "adapter_failed",
              "invalid_outputs",
              "input_policy_rejected",
              "output_policy_rejected"
            ]
          },
          statusCode: { type: "integer", minimum: 100, maximum: 599 }
        },
        required: [
          "stageIdDigest",
          "targetIdDigest",
          "zoneDigest",
          "adapterKindDigest",
          "attempt",
          "status",
          "reasonCode"
        ]
      }
    },
    digest: digestSchema
  },
  required: [
    "apiVersion",
    "kind",
    "producer",
    "disclosure",
    "authority",
    "runIdDigest",
    "observedAt",
    "planDigest",
    "bindingDigest",
    "snapshotDigest",
    "egressDigest",
    "placements",
    "trace",
    "digest"
  ]
} as const;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const addFormats = addFormatsImport as unknown as FormatsPlugin;
addFormats(ajv);
const validateEvidence: ValidateFunction<StageFabricExecutionPlacementEvidence> =
  ajv.compile(schema);

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function prefixedDigest(value: unknown): StageFabricDigest {
  return `sha256:${digestValue(value)}`;
}

function unprefixedDigest(value: StageFabricDigest): Digest {
  return value.slice("sha256:".length);
}

const stageFabricTimestamp = new RegExp(
  "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|" +
    "\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|" +
    "(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))" +
    "T(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?" +
    "(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$"
);

function placementKey(
  value: Pick<
    StageFabricExecutionPlacement | StageFabricExecutionTraceEvent,
    "stageIdDigest" | "targetIdDigest" | "zoneDigest" | "adapterKindDigest" | "attempt"
  >
): string {
  return [
    value.stageIdDigest,
    value.targetIdDigest,
    value.zoneDigest,
    value.adapterKindDigest,
    String(value.attempt)
  ].join("\u0000");
}

function isSemanticallyCoherent(
  evidence: StageFabricExecutionPlacementEvidence
): boolean {
  if (!stageFabricTimestamp.test(evidence.observedAt)) return false;
  const placementIndexByStage = new Map<string, number>();
  const placementKeys = new Set<string>();
  for (const [index, placement] of evidence.placements.entries()) {
    if (placementIndexByStage.has(placement.stageIdDigest)) return false;
    placementIndexByStage.set(placement.stageIdDigest, index);
    placementKeys.add(placementKey(placement));
  }

  const nextAttemptByStage = new Map<string, number>();
  const completedStages = new Set<string>();
  const successfulPlacements = new Set<string>();
  let currentPlacementIndex = 0;
  for (const event of evidence.trace) {
    const completed = event.reasonCode === "completed";
    const retryable = event.reasonCode === "retryable_pre_output_status";
    if ((event.status === "succeeded") !== completed) return false;
    if ((event.statusCode !== undefined) !== retryable) return false;
    if (placementIndexByStage.get(event.stageIdDigest) !== currentPlacementIndex) {
      return false;
    }
    if (completedStages.has(event.stageIdDigest)) return false;

    const expectedAttempt = nextAttemptByStage.get(event.stageIdDigest) ?? 1;
    if (event.attempt !== expectedAttempt) return false;
    nextAttemptByStage.set(event.stageIdDigest, expectedAttempt + 1);

    if (event.status === "succeeded") {
      const key = placementKey(event);
      if (!placementKeys.has(key) || successfulPlacements.has(key)) return false;
      successfulPlacements.add(key);
      completedStages.add(event.stageIdDigest);
      currentPlacementIndex += 1;
    }
  }

  return evidence.placements.every((placement) =>
    successfulPlacements.has(placementKey(placement))
  );
}

export function parseStageFabricExecutionPlacementEvidence(
  input: unknown
): StageFabricExecutionPlacementEvidence {
  if (!validateEvidence(input)) {
    throw new StageFabricEvidenceError("stagefabric_evidence_invalid");
  }
  const evidence = deepCopy(input);
  if (!isSemanticallyCoherent(evidence)) {
    throw new StageFabricEvidenceError("stagefabric_evidence_invalid");
  }
  if (prefixedDigest(omitDigest(evidence)) !== evidence.digest) {
    throw new StageFabricEvidenceError("stagefabric_evidence_digest_mismatch");
  }
  return evidence;
}

function serializeValidatedEvidence(
  evidence: StageFabricExecutionPlacementEvidence
): string {
  return `${canonicalize(evidence)}\n`;
}

export function serializeStageFabricExecutionPlacementEvidence(input: unknown): string {
  return serializeValidatedEvidence(parseStageFabricExecutionPlacementEvidence(input));
}

export function computeStageFabricExecutionPlacementArtifactDigest(
  input: unknown
): Digest {
  return createHash("sha256")
    .update(serializeStageFabricExecutionPlacementEvidence(input), "utf8")
    .digest("hex");
}

export function requireStageFabricExecutionPlacementArtifactEncoding(
  input: unknown,
  source: string
): StageFabricExecutionPlacementEvidence {
  const evidence = parseStageFabricExecutionPlacementEvidence(input);
  if (source !== serializeValidatedEvidence(evidence)) {
    throw new StageFabricEvidenceError("stagefabric_evidence_encoding_mismatch");
  }
  return evidence;
}

export interface CreateStageFabricExecutionEvidenceBindingOptions {
  uri?: string;
}

/**
 * Reduces a validated content-free StageFabric artifact to the descriptor
 * accepted by Execution Passport v2. The observation can support lineage but
 * can never grant or expand runtime authority.
 */
export function createStageFabricExecutionEvidenceBinding(
  input: unknown,
  options: CreateStageFabricExecutionEvidenceBindingOptions = {}
): ExecutionEvidenceBinding {
  const evidence = parseStageFabricExecutionPlacementEvidence(input);
  const binding: ExecutionEvidenceBinding = {
    contractType: "ExecutionEvidenceBinding",
    role: "execution-placement",
    producer: evidence.producer,
    runIdDigest: unprefixedDigest(evidence.runIdDigest),
    observedAt: new Date(evidence.observedAt).toISOString(),
    authority: "observation-only",
    resource: {
      name: "stagefabric-execution-placement",
      digest: {
        sha256: createHash("sha256")
          .update(serializeValidatedEvidence(evidence), "utf8")
          .digest("hex")
      },
      mediaType: STAGEFABRIC_EXECUTION_EVIDENCE_MEDIA_TYPE,
      ...(options.uri === undefined ? {} : { uri: options.uri })
    },
    disclosure: "content-free"
  };
  if (!validateAs("ExecutionEvidenceBinding", binding).valid) {
    throw new StageFabricEvidenceError("stagefabric_evidence_binding_invalid");
  }
  return binding;
}
