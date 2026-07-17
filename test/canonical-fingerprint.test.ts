import { describe, expect, it } from "vitest";

import {
  canonicalize,
  createCompositeFingerprint,
  createSafeCacheKey,
  digestValue,
  evaluateCacheAdmission,
  seal,
  validateCompositeFingerprint,
  verifySeal
} from "../src/index.js";
import type { FingerprintInput, IntentEnvelope } from "../src/index.js";
import { runDemo } from "../src/demo/demo.js";

const input: FingerprintInput = {
  canonicalIntent: "apply a bounded change",
  constraints: { dryRun: false, revision: 7 },
  authoritativeContextDigests: [digestValue("z"), digestValue("a"), digestValue("z")],
  outcomeDigest: digestValue("outcome"),
  policyBundleDigest: digestValue("policy"),
  capabilitySetDigest: digestValue("capabilities"),
  tenantPartitionDigest: digestValue("tenant"),
  privacyPartition: "tenant"
};

describe("canonical contracts", () => {
  it("matches RFC 8785 key ordering and number serialization vectors", () => {
    expect(canonicalize({ z: 1, a: { b: true, a: false } })).toBe(
      '{"a":{"a":false,"b":true},"z":1}'
    );
    expect(canonicalize([Number("333333333.33333329"), 1e30, 4.5, 2e-3, 1e-27])).toBe(
      "[333333333.3333333,1e+30,4.5,0.002,1e-27]"
    );
    expect(
      canonicalize({
        "1": { f: { f: "hi", F: 5 }, "\n": 56 },
        "10": {},
        "": "empty",
        a: {},
        "111": [{ e: "yes", E: "no" }],
        A: {}
      })
    ).toBe(
      '{"":"empty","1":{"\\n":56,"f":{"F":5,"f":"hi"}},"10":{},"111":[{"E":"no","e":"yes"}],"A":{},"a":{}}'
    );
    expect(digestValue({ b: 2, a: 1 })).toBe(digestValue({ a: 1, b: 2 }));
  });

  it("rejects values outside the JSON contract", () => {
    expect(() => canonicalize(Number.NaN)).toThrow("finite");
    expect(() => canonicalize({ value: undefined })).toThrow("does not support undefined");
    expect(() => canonicalize(Symbol("unsupported"))).toThrow("does not support symbol");
    expect(() => canonicalize("\ud800")).toThrow("lone Unicode surrogates");
    expect(() => canonicalize(new Date("2026-07-17T12:00:00.000Z"))).toThrow(
      "only JSON objects and arrays"
    );
  });

  it("seals and detects mutation", () => {
    const record = seal({ id: "record-1", enabled: true });
    expect(verifySeal(record)).toBe(true);
    expect(verifySeal({ ...record, enabled: false })).toBe(false);
  });
});

describe("safe cache fingerprints", () => {
  it("normalizes authoritative digest ordering and duplication", () => {
    const reordered = {
      ...input,
      authoritativeContextDigests: [...input.authoritativeContextDigests].reverse()
    };
    expect(createSafeCacheKey(input)).toBe(createSafeCacheKey(reordered));
    expect(createCompositeFingerprint(input)).toEqual(createCompositeFingerprint(reordered));
  });

  it("admits only semantic and operational equivalence", () => {
    const baseline = createCompositeFingerprint(input);
    expect(evaluateCacheAdmission(baseline, baseline)).toMatchObject({
      admitted: true,
      reason: "equivalent"
    });

    const semanticMismatch = createCompositeFingerprint({
      ...input,
      canonicalIntent: "inspect a bounded change"
    });
    expect(evaluateCacheAdmission(semanticMismatch, baseline)).toMatchObject({
      admitted: false,
      semanticEquivalent: false,
      reason: "semantic-mismatch"
    });

    const operationalMismatch = createCompositeFingerprint({
      ...input,
      policyBundleDigest: digestValue("different-policy")
    });
    expect(evaluateCacheAdmission(operationalMismatch, baseline)).toMatchObject({
      admitted: false,
      semanticEquivalent: true,
      operationalEquivalent: false,
      reason: "operational-mismatch"
    });

    expect(
      evaluateCacheAdmission({ ...baseline, digest: digestValue("tampered") }, baseline)
    ).toMatchObject({ admitted: false, reason: "invalid-fingerprint" });
  });

  it("validates the intent binding, not just well-shaped digests", () => {
    const intent = runDemo().bundle.intent;
    expect(validateCompositeFingerprint(intent).valid).toBe(true);
    const changed: IntentEnvelope = { ...intent, canonicalIntent: "different intent" };
    const result = validateCompositeFingerprint(changed);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("semantic-fingerprint");
  });
});
