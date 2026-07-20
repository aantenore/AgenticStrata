import { createHash } from "node:crypto";

import type {
  Digest,
  ValidationIssue,
  ValidationResult
} from "../contracts/types.js";
import { canonicalize } from "./canonical.js";
import {
  verifyExecutionPassport,
  type ExecutionPassportVerificationResult,
  type VerifyExecutionPassportInput
} from "./passport.js";

export const EXECUTION_PASSPORT_DSSE_PAYLOAD_TYPE =
  "application/vnd.in-toto+json" as const;

export interface AuthenticatedSignerIdentity {
  issuer: string;
  subjectAlternativeName: string;
}

export interface EnvelopeVerificationResult extends ValidationResult {
  authenticatedPayloadDigest?: Digest;
  signer?: AuthenticatedSignerIdentity;
}

export interface EnvelopeVerifier {
  readonly provider: string;
  verify(input: {
    envelope: unknown;
    expectedPayload: Uint8Array;
    expectedPayloadType: typeof EXECUTION_PASSPORT_DSSE_PAYLOAD_TYPE;
  }): Promise<EnvelopeVerificationResult>;
}

export type AuthenticationVerification =
  | {
      status: "not-evaluated";
      provider: string;
      issues: [];
    }
  | {
      status: "failed";
      provider: string;
      issues: ValidationIssue[];
    }
  | {
      status: "verified";
      provider: string;
      authenticatedPayloadDigest: Digest;
      signer: AuthenticatedSignerIdentity;
      issues: [];
    };

export interface VerifyAuthenticatedExecutionPassportInput
  extends VerifyExecutionPassportInput {
  envelope: unknown;
  verifier: EnvelopeVerifier;
}

export interface AuthenticatedExecutionPassportVerificationResult
  extends ValidationResult {
  trustLevel: "authenticated" | "unverified";
  artifactSet: ExecutionPassportVerificationResult;
  authentication: AuthenticationVerification;
}

function digestBytes(value: Uint8Array): Digest {
  return createHash("sha256").update(value).digest("hex");
}

function failedAuthentication(
  provider: string,
  issues: ValidationIssue[]
): AuthenticationVerification {
  return { status: "failed", provider, issues };
}

function isEnvelopeVerificationResult(
  value: unknown
): value is EnvelopeVerificationResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.valid !== "boolean" || !Array.isArray(candidate.issues)) {
    return false;
  }
  const issuesAreStructured = candidate.issues.every(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      typeof (item as Record<string, unknown>).path === "string" &&
      typeof (item as Record<string, unknown>).code === "string" &&
      typeof (item as Record<string, unknown>).message === "string"
  );
  return issuesAreStructured && (candidate.valid || candidate.issues.length > 0);
}

/**
 * Verify a complete Execution Passport artifact set and require an external,
 * authenticated envelope over the exact canonical Statement bytes. The core
 * owns composition and downgrade prevention; the injected verifier owns the
 * trust system, signer policy, and signature verification.
 */
export async function verifyAuthenticatedExecutionPassport(
  input: VerifyAuthenticatedExecutionPassportInput
): Promise<AuthenticatedExecutionPassportVerificationResult> {
  const artifactSet = verifyExecutionPassport(input);
  if (!artifactSet.valid) {
    return {
      valid: false,
      issues: artifactSet.issues,
      trustLevel: "unverified",
      artifactSet,
      authentication: {
        status: "not-evaluated",
        provider: input.verifier.provider,
        issues: []
      }
    };
  }

  const expectedPayload = new TextEncoder().encode(canonicalize(input.passport));
  const expectedPayloadDigest = digestBytes(expectedPayload);

  let verified: EnvelopeVerificationResult;
  try {
    verified = await input.verifier.verify({
      envelope: input.envelope,
      expectedPayload,
      expectedPayloadType: EXECUTION_PASSPORT_DSSE_PAYLOAD_TYPE
    });
  } catch {
    const issues: ValidationIssue[] = [
      {
        path: "/authentication",
        code: "envelope-verifier-error",
        message: "The authenticated envelope verifier did not complete successfully."
      }
    ];
    return {
      valid: false,
      issues,
      trustLevel: "unverified",
      artifactSet,
      authentication: failedAuthentication(input.verifier.provider, issues)
    };
  }

  if (!isEnvelopeVerificationResult(verified)) {
    const issues: ValidationIssue[] = [
      {
        path: "/authentication",
        code: "envelope-verifier-result",
        message:
          "The authenticated envelope verifier did not return a well-formed verification result."
      }
    ];
    return {
      valid: false,
      issues,
      trustLevel: "unverified",
      artifactSet,
      authentication: failedAuthentication(input.verifier.provider, issues)
    };
  }

  if (!verified.valid) {
    return {
      valid: false,
      issues: verified.issues,
      trustLevel: "unverified",
      artifactSet,
      authentication: failedAuthentication(input.verifier.provider, verified.issues)
    };
  }

  const signer = verified.signer;
  if (
    verified.issues.length !== 0 ||
    signer === undefined ||
    signer === null ||
    typeof signer !== "object" ||
    typeof signer.issuer !== "string" ||
    signer.issuer.length === 0 ||
    typeof signer.subjectAlternativeName !== "string" ||
    signer.subjectAlternativeName.length === 0 ||
    typeof verified.authenticatedPayloadDigest !== "string"
  ) {
    const issues: ValidationIssue[] = [
      {
        path: "/authentication",
        code: "envelope-verifier-result",
        message:
          "The authenticated envelope verifier did not return a complete signer and payload binding."
      }
    ];
    return {
      valid: false,
      issues,
      trustLevel: "unverified",
      artifactSet,
      authentication: failedAuthentication(input.verifier.provider, issues)
    };
  }

  if (verified.authenticatedPayloadDigest !== expectedPayloadDigest) {
    const issues: ValidationIssue[] = [
      {
        path: "/authentication/payload",
        code: "envelope-payload-binding",
        message:
          "The authenticated envelope payload digest does not match the canonical Execution Passport."
      }
    ];
    return {
      valid: false,
      issues,
      trustLevel: "unverified",
      artifactSet,
      authentication: failedAuthentication(input.verifier.provider, issues)
    };
  }

  return {
    valid: true,
    issues: [],
    trustLevel: "authenticated",
    artifactSet,
    authentication: {
      status: "verified",
      provider: input.verifier.provider,
      authenticatedPayloadDigest: expectedPayloadDigest,
      signer: {
        issuer: signer.issuer,
        subjectAlternativeName: signer.subjectAlternativeName
      },
      issues: []
    }
  };
}
