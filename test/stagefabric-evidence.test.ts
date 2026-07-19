import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  STAGEFABRIC_EXECUTION_EVIDENCE_MEDIA_TYPE,
  StageFabricEvidenceError,
  computeStageFabricExecutionPlacementArtifactDigest,
  createExecutionPassport,
  createStageFabricExecutionEvidenceBinding,
  digestValue,
  omitDigest,
  runConformance,
  runDemo,
  serializeStageFabricExecutionPlacementEvidence,
  validateDocument
} from "../src/index.js";
import type { StageFabricExecutionPlacementEvidence } from "../src/index.js";
import { writeJson, writeText } from "../src/adapters/documents.js";
import { createCliProgram } from "../src/cli-program.js";

type UnsealedStageFabricEvidence = Omit<StageFabricExecutionPlacementEvidence, "digest">;

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${digestValue(value)}`;
}

function stageFabricEvidence(
  runId = "run-change-demo-001"
): StageFabricExecutionPlacementEvidence {
  const identity = {
    stageIdDigest: sha256("summarize"),
    targetIdDigest: sha256("local-runtime"),
    zoneDigest: sha256("private"),
    adapterKindDigest: sha256("openai-compatible")
  };
  const unsigned: UnsealedStageFabricEvidence = {
    apiVersion: "stagefabric.dev/v1alpha1",
    kind: "ExecutionPlacementEvidence",
    producer: "stagefabric",
    disclosure: "content-free",
    authority: "observation-only",
    runIdDigest: sha256(runId),
    observedAt: "2026-07-19T09:30:00.000Z",
    planDigest: sha256({ plan: "fixture" }),
    bindingDigest: sha256({ binding: "fixture" }),
    snapshotDigest: sha256({ snapshot: "fixture" }),
    egressDigest: sha256({ egress: "fixture" }),
    placements: [
      {
        ...identity,
        attempt: 1,
        status: "succeeded",
        reasonCode: "completed"
      }
    ],
    trace: [
      {
        ...identity,
        attempt: 1,
        status: "succeeded",
        reasonCode: "completed"
      }
    ]
  };
  return { ...unsigned, digest: sha256(unsigned) };
}

function passportInput(evidence: StageFabricExecutionPlacementEvidence) {
  const bundle = runDemo().bundle;
  return {
    bundle,
    report: runConformance(bundle, "enterprise", {
      generatedAt: "2026-07-19T09:30:01.000Z"
    }),
    oasfRecord: { id: "fixture-agent" },
    oasfMediaType: "application/json",
    executionEvidence: [createStageFabricExecutionEvidenceBinding(evidence)],
    issuedAt: "2026-07-19T09:30:02.000Z"
  } as const;
}

describe("StageFabric execution placement evidence adapter", () => {
  it("matches a retrying golden artifact emitted by StageFabric", () => {
    const fixturePath = fileURLToPath(
      new URL("fixtures/stagefabric/execution-placement-evidence.json", import.meta.url)
    );
    const source = readFileSync(fixturePath, "utf8");
    const evidence = JSON.parse(source) as unknown;

    expect(serializeStageFabricExecutionPlacementEvidence(evidence)).toBe(source);
    expect(computeStageFabricExecutionPlacementArtifactDigest(evidence)).toBe(
      "aa0d03a6af7b6e5e03afd1d43530077578d8e67cba58295f7d86c88bd2fad632"
    );
    expect(createStageFabricExecutionEvidenceBinding(evidence).resource.digest.sha256)
      .toBe("aa0d03a6af7b6e5e03afd1d43530077578d8e67cba58295f7d86c88bd2fad632");
  });

  it("reduces a sealed content-free observation to a run-bound descriptor", () => {
    const evidence = stageFabricEvidence();
    const binding = createStageFabricExecutionEvidenceBinding(evidence, {
      uri: "https://example.test/evidence/stagefabric.json"
    });

    expect(binding).toEqual({
      contractType: "ExecutionEvidenceBinding",
      role: "execution-placement",
      producer: "stagefabric",
      runIdDigest: digestValue("run-change-demo-001"),
      observedAt: evidence.observedAt,
      authority: "observation-only",
      resource: {
        name: "stagefabric-execution-placement",
        digest: {
          sha256: computeStageFabricExecutionPlacementArtifactDigest(evidence)
        },
        mediaType: STAGEFABRIC_EXECUTION_EVIDENCE_MEDIA_TYPE,
        uri: "https://example.test/evidence/stagefabric.json"
      },
      disclosure: "content-free"
    });
    expect(validateDocument(binding)).toEqual({ valid: true, issues: [] });

    const serialized = JSON.stringify(binding);
    expect(serialized).not.toContain("summarize");
    expect(serialized).not.toContain("local-runtime");
    expect(serialized).not.toContain("private");
  });

  it("creates a valid Execution Passport only for the observed run", () => {
    const passport = createExecutionPassport(passportInput(stageFabricEvidence()));
    expect(passport.predicate.executionEvidence).toHaveLength(1);
    expect(passport.predicate.executionEvidence[0]?.authority).toBe("observation-only");

    const unrelated = stageFabricEvidence("different-run");
    expect(() => createExecutionPassport(passportInput(unrelated))).toThrow(
      "belongs to a different run"
    );
  });

  it("emits canonical CLI input for the passport command without provider content", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentic-strata-stagefabric-"));
    try {
      const inputPath = join(directory, "stagefabric-evidence.json");
      const outputPath = join(directory, "binding.json");
      writeText(
        inputPath,
        serializeStageFabricExecutionPlacementEvidence(stageFabricEvidence())
      );

      await createCliProgram().parseAsync(
        [
          "bind-stagefabric",
          inputPath,
          "--uri",
          "urn:stagefabric:evidence:fixture-1",
          "--output",
          outputPath
        ],
        { from: "user" }
      );

      const raw = readFileSync(outputPath, "utf8");
      const binding = JSON.parse(raw) as unknown;
      expect(raw).toBe(JSON.stringify(binding));
      expect(raw).not.toContain("summarize");
      expect(raw).not.toContain("local-runtime");
      expect(raw).not.toContain(directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires the exact canonical JSON bytes emitted by StageFabric", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentic-strata-stagefabric-bytes-"));
    try {
      const inputPath = join(directory, "pretty-evidence.json");
      writeJson(inputPath, stageFabricEvidence());

      await expect(
        createCliProgram().parseAsync(["bind-stagefabric", inputPath], {
          from: "user"
        })
      ).rejects.toThrow("stagefabric_evidence_encoding_mismatch");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects tampering and content-bearing extensions", () => {
    const evidence = stageFabricEvidence();
    expect(() =>
      createStageFabricExecutionEvidenceBinding({
        ...evidence,
        planDigest: sha256("tampered")
      })
    ).toThrowError(
      new StageFabricEvidenceError("stagefabric_evidence_digest_mismatch")
    );

    expect(() =>
      createStageFabricExecutionEvidenceBinding({
        ...evidence,
        content: "provider-output"
      })
    ).toThrowError(new StageFabricEvidenceError("stagefabric_evidence_invalid"));
  });

  it("rejects sealed but semantically incoherent placement traces", () => {
    const valid = stageFabricEvidence();
    const unsigned = omitDigest(valid);
    const incoherent = {
      ...unsigned,
      trace: [{ ...unsigned.trace[0], attempt: 2 }]
    };
    expect(() =>
      createStageFabricExecutionEvidenceBinding({
        ...incoherent,
        digest: sha256(incoherent)
      })
    ).toThrowError(new StageFabricEvidenceError("stagefabric_evidence_invalid"));
  });

  it("matches the StageFabric timestamp grammar and report chronology", () => {
    const resealAt = (observedAt: string) => {
      const unsigned = { ...omitDigest(stageFabricEvidence()), observedAt };
      return { ...unsigned, digest: sha256(unsigned) };
    };

    expect(() => createStageFabricExecutionEvidenceBinding(resealAt("2026-07-19T09:30Z")))
      .not.toThrow();
    expect(() => createStageFabricExecutionEvidenceBinding(resealAt("2026-07-19t09:30:00z")))
      .toThrowError(new StageFabricEvidenceError("stagefabric_evidence_invalid"));
    expect(() => createExecutionPassport(passportInput(resealAt("2030-01-01T00:00Z"))))
      .toThrow("cannot precede execution evidence");
  });

  it("rejects authority expansion and unstable or credentialed references", () => {
    const evidence = stageFabricEvidence();
    expect(() =>
      createStageFabricExecutionEvidenceBinding({
        ...evidence,
        authority: "grants-execution"
      })
    ).toThrowError(new StageFabricEvidenceError("stagefabric_evidence_invalid"));

    for (const uri of [
      "https://user:secret@example.test/evidence.json",
      "https://example.test/evidence.json?version=1",
      "file:///tmp/evidence.json"
    ]) {
      expect(() =>
        createStageFabricExecutionEvidenceBinding(evidence, { uri })
      ).toThrowError(
        new StageFabricEvidenceError("stagefabric_evidence_binding_invalid")
      );
    }
  });
});
