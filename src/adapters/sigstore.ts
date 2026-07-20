import { createHash } from "node:crypto";

import {
  bundleFromJSON,
  bundleToJSON,
  isBundleWithDsseEnvelope
} from "@sigstore/bundle";
import { createVerifier } from "sigstore";
import type { BundleVerifier, VerifyOptions } from "sigstore";

import type { ValidationIssue } from "../contracts/types.js";
import {
  EXECUTION_PASSPORT_DSSE_PAYLOAD_TYPE,
  type EnvelopeVerificationResult,
  type EnvelopeVerifier
} from "../core/authenticated-passport.js";

export interface SigstoreAllowedSigner {
  issuer: string;
  subjectAlternativeName: string;
}

export interface SigstoreIdentityPolicy {
  allowedSigners: readonly SigstoreAllowedSigner[];
}

export interface SigstoreVerificationThresholds {
  ctLog: number;
  tlog: number;
}

export const DEFAULT_SIGSTORE_VERIFICATION_THRESHOLDS = {
  ctLog: 1,
  tlog: 1
} as const satisfies SigstoreVerificationThresholds;

export interface CreateSigstoreEnvelopeVerifierInput {
  bundleVerifier: BundleVerifier;
  identityPolicy: SigstoreIdentityPolicy;
  /**
   * Thresholds already enforced by the injected BundleVerifier. Values below
   * one are rejected so authenticated-required mode cannot disable Sigstore's
   * certificate or transparency verification by configuration.
   */
  thresholds?: SigstoreVerificationThresholds;
}

export type PublicSigstoreTufOptions = Pick<
  VerifyOptions,
  | "tufMirrorURL"
  | "tufRootPath"
  | "tufCachePath"
  | "tufForceCache"
  | "timeout"
>;

export interface CreatePublicSigstoreEnvelopeVerifierInput {
  identityPolicy: SigstoreIdentityPolicy;
  thresholds?: SigstoreVerificationThresholds;
  tuf?: PublicSigstoreTufOptions;
}

export interface SigstoreEnvelopeVerifier extends EnvelopeVerifier {
  readonly thresholds: Readonly<SigstoreVerificationThresholds>;
}

const MAX_ALLOWED_SIGNERS = 32;
const MAX_IDENTITY_LENGTH = 2048;

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

function failure(path: string, code: string, message: string): EnvelopeVerificationResult {
  return { valid: false, issues: [issue(path, code, message)] };
}

function requireExactIdentityValue(label: string, value: string): void {
  if (
    value.length === 0 ||
    value.length > MAX_IDENTITY_LENGTH ||
    value.trim() !== value
  ) {
    throw new TypeError(
      `Sigstore ${label} must be a non-empty exact value without surrounding whitespace.`
    );
  }
}

function copyIdentityPolicy(policy: SigstoreIdentityPolicy): SigstoreIdentityPolicy {
  if (
    policy.allowedSigners.length === 0 ||
    policy.allowedSigners.length > MAX_ALLOWED_SIGNERS
  ) {
    throw new TypeError(
      `Sigstore identity policy must contain between 1 and ${MAX_ALLOWED_SIGNERS} exact allowed signers.`
    );
  }

  const seen = new Set<string>();
  const allowedSigners = policy.allowedSigners.map((signer) => {
    requireExactIdentityValue("issuer", signer.issuer);
    requireExactIdentityValue(
      "subject alternative name",
      signer.subjectAlternativeName
    );
    const key = `${signer.issuer}\u0000${signer.subjectAlternativeName}`;
    if (seen.has(key)) {
      throw new TypeError(
        "Sigstore identity policy must not contain duplicate allowed signers."
      );
    }
    seen.add(key);
    return {
      issuer: signer.issuer,
      subjectAlternativeName: signer.subjectAlternativeName
    };
  });

  return { allowedSigners };
}

function copyThresholds(
  thresholds: SigstoreVerificationThresholds | undefined
): SigstoreVerificationThresholds {
  const effective = thresholds ?? DEFAULT_SIGSTORE_VERIFICATION_THRESHOLDS;
  for (const [name, value] of Object.entries(effective)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`Sigstore ${name} threshold must be a positive integer.`);
    }
  }
  return { ctLog: effective.ctLog, tlog: effective.tlog };
}

function rawDsseSignatureCount(value: unknown): number | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const envelope = (value as Record<string, unknown>).dsseEnvelope;
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return undefined;
  }
  const signatures = (envelope as Record<string, unknown>).signatures;
  return Array.isArray(signatures) ? signatures.length : undefined;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

function digestBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function verifySigstoreEnvelope(
  bundleVerifier: BundleVerifier,
  identityPolicy: SigstoreIdentityPolicy,
  input: Parameters<EnvelopeVerifier["verify"]>[0]
): EnvelopeVerificationResult {
  const rawSignatureCount = rawDsseSignatureCount(input.envelope);
  if (rawSignatureCount !== undefined && rawSignatureCount !== 1) {
    return failure(
      "/authentication/envelope/dsseEnvelope/signatures",
      "sigstore-signature-count",
      "The Sigstore DSSE envelope must contain exactly one signature."
    );
  }

  let bundle;
  try {
    bundle = bundleFromJSON(input.envelope);
  } catch {
    return failure(
      "/authentication/envelope",
      "sigstore-bundle-invalid",
      "The supplied authenticated envelope is not a valid Sigstore bundle."
    );
  }

  if (!isBundleWithDsseEnvelope(bundle)) {
    return failure(
      "/authentication/envelope",
      "sigstore-dsse-required",
      "The Sigstore bundle must contain a DSSE envelope."
    );
  }

  const dsse = bundle.content.dsseEnvelope;
  if (dsse.signatures.length !== 1) {
    return failure(
      "/authentication/envelope/dsseEnvelope/signatures",
      "sigstore-signature-count",
      "The Sigstore DSSE envelope must contain exactly one signature."
    );
  }
  if (
    input.expectedPayloadType !== EXECUTION_PASSPORT_DSSE_PAYLOAD_TYPE ||
    dsse.payloadType !== input.expectedPayloadType
  ) {
    return failure(
      "/authentication/envelope/dsseEnvelope/payloadType",
      "sigstore-payload-type",
      "The Sigstore DSSE payload type must be application/vnd.in-toto+json."
    );
  }
  if (!bytesEqual(dsse.payload, input.expectedPayload)) {
    return failure(
      "/authentication/envelope/dsseEnvelope/payload",
      "sigstore-payload-binding",
      "The Sigstore DSSE payload must exactly match the canonical Execution Passport bytes."
    );
  }

  let signer;
  try {
    signer = bundleVerifier.verify(bundleToJSON(bundle));
  } catch {
    return failure(
      "/authentication/envelope/dsseEnvelope/signatures/0",
      "sigstore-verification-failed",
      "The Sigstore bundle did not pass cryptographic and trust verification."
    );
  }

  const issuer = signer.identity?.extensions?.issuer;
  const subjectAlternativeName = signer.identity?.subjectAlternativeName;
  if (issuer === undefined || subjectAlternativeName === undefined) {
    return failure(
      "/authentication/signer",
      "sigstore-identity-missing",
      "The verified Sigstore signer does not contain both issuer and subject alternative name."
    );
  }

  const allowed = identityPolicy.allowedSigners.some(
    (candidate) =>
      candidate.issuer === issuer &&
      candidate.subjectAlternativeName === subjectAlternativeName
  );
  if (!allowed) {
    return failure(
      "/authentication/signer",
      "sigstore-identity-denied",
      "The verified Sigstore signer is not allowed by the exact identity policy."
    );
  }

  return {
    valid: true,
    issues: [],
    authenticatedPayloadDigest: digestBytes(dsse.payload),
    signer: { issuer, subjectAlternativeName }
  };
}

/**
 * Wrap an enterprise, offline, or test BundleVerifier. The caller configures
 * its trust material and must ensure it enforces the declared thresholds.
 */
export function createSigstoreEnvelopeVerifier(
  input: CreateSigstoreEnvelopeVerifierInput
): SigstoreEnvelopeVerifier {
  const identityPolicy = copyIdentityPolicy(input.identityPolicy);
  const thresholds = copyThresholds(input.thresholds);
  return {
    provider: "sigstore",
    thresholds,
    verify: (verificationInput) =>
      Promise.resolve(
        verifySigstoreEnvelope(
          input.bundleVerifier,
          identityPolicy,
          verificationInput
        )
      )
  };
}

/**
 * Create a verifier backed by the Sigstore public client and its TUF trust
 * configuration. Exact signer authorization remains AgenticStrata-owned.
 */
export async function createPublicSigstoreEnvelopeVerifier(
  input: CreatePublicSigstoreEnvelopeVerifierInput
): Promise<SigstoreEnvelopeVerifier> {
  const thresholds = copyThresholds(input.thresholds);
  const bundleVerifier = await createVerifier({
    ...(input.tuf ?? {}),
    ctLogThreshold: thresholds.ctLog,
    tlogThreshold: thresholds.tlog
  });
  return createSigstoreEnvelopeVerifier({
    bundleVerifier,
    identityPolicy: input.identityPolicy,
    thresholds
  });
}
