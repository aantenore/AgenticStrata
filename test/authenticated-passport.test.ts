import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  canonicalize,
  createExecutionPassport,
  runConformance,
  runDemo,
  verifyAuthenticatedExecutionPassport
} from "../src/index.js";
import type {
  EnvelopeVerifier,
  VerifyAuthenticatedExecutionPassportInput
} from "../src/index.js";

const GENERATED_AT = "2026-07-17T12:00:00.000Z";
const ISSUED_AT = "2026-07-17T12:00:01.000Z";

function digestBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture(): Omit<VerifyAuthenticatedExecutionPassportInput, "verifier"> {
  const bundle = runDemo().bundle;
  const report = runConformance(bundle, "enterprise", { generatedAt: GENERATED_AT });
  const oasfRecord = { externalRecord: "validated-by-owner" };
  const passport = createExecutionPassport({
    bundle,
    report,
    oasfRecord,
    oasfMediaType: "application/json",
    issuedAt: ISSUED_AT
  });
  return { bundle, report, oasfRecord, passport, envelope: { signed: true } };
}

function acceptingVerifier(): {
  verifier: EnvelopeVerifier;
  verify: ReturnType<typeof vi.fn<EnvelopeVerifier["verify"]>>;
  observedPayload: () => Uint8Array | undefined;
} {
  let observedPayload: Uint8Array | undefined;
  const verify = vi.fn<EnvelopeVerifier["verify"]>(
    ({ expectedPayload, expectedPayloadType }) => {
      observedPayload = expectedPayload;
      expect(expectedPayloadType).toBe("application/vnd.in-toto+json");
      return Promise.resolve({
        valid: true,
        issues: [],
        authenticatedPayloadDigest: digestBytes(expectedPayload),
        signer: {
          issuer: "https://issuer.example",
          subjectAlternativeName: "https://identity.example/workload"
        }
      });
    }
  );
  return {
    verifier: { provider: "test-envelope", verify },
    verify,
    observedPayload: () => observedPayload
  };
}

describe("authenticated Execution Passport verification", () => {
  it("authenticates the exact canonical Statement after artifact verification", async () => {
    const input = fixture();
    const envelope = acceptingVerifier();
    const result = await verifyAuthenticatedExecutionPassport({
      ...input,
      verifier: envelope.verifier
    });

    expect(result).toMatchObject({
      valid: true,
      trustLevel: "authenticated",
      authentication: {
        status: "verified",
        provider: "test-envelope",
        signer: {
          issuer: "https://issuer.example",
          subjectAlternativeName: "https://identity.example/workload"
        }
      }
    });
    expect(new TextDecoder().decode(envelope.observedPayload())).toBe(
      canonicalize(input.passport)
    );
  });

  it("does not evaluate authentication for an inconsistent artifact set", async () => {
    const input = fixture();
    const envelope = acceptingVerifier();
    const result = await verifyAuthenticatedExecutionPassport({
      ...input,
      oasfRecord: { externalRecord: "replaced" },
      verifier: envelope.verifier
    });

    expect(result.valid).toBe(false);
    expect(result.authentication.status).toBe("not-evaluated");
    expect(envelope.verify).not.toHaveBeenCalled();
  });

  it("fails closed when the envelope is rejected or the verifier throws", async () => {
    const input = fixture();
    const rejected: EnvelopeVerifier = {
      provider: "test-envelope",
      verify: () => Promise.resolve({
        valid: false,
        issues: [
          {
            path: "/authentication/signature",
            code: "signature-invalid",
            message: "The authenticated envelope signature is invalid."
          }
        ]
      })
    };
    const rejectedResult = await verifyAuthenticatedExecutionPassport({
      ...input,
      verifier: rejected
    });
    expect(rejectedResult).toMatchObject({
      valid: false,
      trustLevel: "unverified",
      authentication: { status: "failed" }
    });

    const throwing: EnvelopeVerifier = {
      provider: "test-envelope",
      verify: () => Promise.reject(new Error("provider detail must not escape"))
    };
    const throwingResult = await verifyAuthenticatedExecutionPassport({
      ...input,
      verifier: throwing
    });
    expect(throwingResult.issues).toEqual([
      {
        path: "/authentication",
        code: "envelope-verifier-error",
        message: "The authenticated envelope verifier did not complete successfully."
      }
    ]);
  });

  it("rejects incomplete or mismatched successful verifier results", async () => {
    const input = fixture();
    const incomplete: EnvelopeVerifier = {
      provider: "test-envelope",
      verify: () => Promise.resolve({ valid: true, issues: [] })
    };
    const incompleteResult = await verifyAuthenticatedExecutionPassport({
      ...input,
      verifier: incomplete
    });
    expect(incompleteResult.issues[0]?.code).toBe("envelope-verifier-result");

    const mismatched: EnvelopeVerifier = {
      provider: "test-envelope",
      verify: () => Promise.resolve({
        valid: true,
        issues: [],
        authenticatedPayloadDigest: "0".repeat(64),
        signer: {
          issuer: "https://issuer.example",
          subjectAlternativeName: "https://identity.example/workload"
        }
      })
    };
    const mismatchedResult = await verifyAuthenticatedExecutionPassport({
      ...input,
      verifier: mismatched
    });
    expect(mismatchedResult.issues[0]?.code).toBe("envelope-payload-binding");
  });
});
