import { API_VERSION } from "../contracts/types.js";
import type {
  CompositeFingerprint,
  Digest,
  IntentEnvelope,
  OperationalFingerprint,
  SemanticFingerprint,
  ValidationIssue,
  ValidationResult
} from "../contracts/types.js";
import { canonicalize, digestValue, omitDigest, verifySeal } from "./canonical.js";

export interface FingerprintInput {
  canonicalIntent: string;
  constraints: IntentEnvelope["constraints"];
  authoritativeContextDigests: Digest[];
  outcomeDigest: Digest;
  policyBundleDigest: Digest;
  capabilitySetDigest: Digest;
  tenantPartitionDigest: Digest;
  privacyPartition: OperationalFingerprint["privacyPartition"];
}

export interface CacheAdmissionDecision {
  admitted: boolean;
  semanticEquivalent: boolean;
  operationalEquivalent: boolean;
  reason: "equivalent" | "semantic-mismatch" | "operational-mismatch" | "invalid-fingerprint";
}

function normalizedAuthoritativeDigests(digests: Digest[]): Digest[] {
  return [...new Set(digests)].sort();
}

export function createSafeCacheKey(input: FingerprintInput): Digest {
  return digestValue({
    specVersion: API_VERSION,
    canonicalIntent: input.canonicalIntent,
    constraints: input.constraints,
    authoritativeContextDigests: normalizedAuthoritativeDigests(
      input.authoritativeContextDigests
    ),
    outcomeDigest: input.outcomeDigest,
    policyBundleDigest: input.policyBundleDigest,
    capabilitySetDigest: input.capabilitySetDigest,
    privacyPartition: input.privacyPartition,
    tenantPartitionDigest: input.tenantPartitionDigest
  });
}

export function createCompositeFingerprint(input: FingerprintInput): CompositeFingerprint {
  const semanticUnsigned: Omit<SemanticFingerprint, "digest"> = {
    algorithm: "sha256",
    specVersion: API_VERSION,
    canonicalIntentDigest: digestValue(input.canonicalIntent)
  };
  const semantic: SemanticFingerprint = {
    ...semanticUnsigned,
    digest: digestValue(semanticUnsigned)
  };

  const operationalUnsigned: Omit<OperationalFingerprint, "digest"> = {
    algorithm: "sha256",
    specVersion: API_VERSION,
    constraintsDigest: digestValue(input.constraints),
    authoritativeContextDigests: normalizedAuthoritativeDigests(
      input.authoritativeContextDigests
    ),
    outcomeDigest: input.outcomeDigest,
    policyBundleDigest: input.policyBundleDigest,
    capabilitySetDigest: input.capabilitySetDigest,
    tenantPartitionDigest: input.tenantPartitionDigest,
    privacyPartition: input.privacyPartition
  };
  const operational: OperationalFingerprint = {
    ...operationalUnsigned,
    digest: digestValue(operationalUnsigned)
  };

  const unsigned: Omit<CompositeFingerprint, "digest"> = {
    algorithm: "sha256",
    specVersion: API_VERSION,
    semantic,
    operational,
    cacheKey: createSafeCacheKey(input)
  };
  return { ...unsigned, digest: digestValue(unsigned) };
}

export function validateCompositeFingerprint(intent: IntentEnvelope): ValidationResult {
  const authoritativeContextDigests = intent.context
    .filter((item) => item.trust === "authoritative")
    .map((item) => item.digest);
  const fingerprint = intent.fingerprint;
  const expected = createCompositeFingerprint({
    canonicalIntent: intent.canonicalIntent,
    constraints: intent.constraints,
    authoritativeContextDigests,
    outcomeDigest: fingerprint.operational.outcomeDigest,
    policyBundleDigest: fingerprint.operational.policyBundleDigest,
    capabilitySetDigest: fingerprint.operational.capabilitySetDigest,
    tenantPartitionDigest: fingerprint.operational.tenantPartitionDigest,
    privacyPartition: fingerprint.operational.privacyPartition
  });

  const issues: ValidationIssue[] = [];
  if (canonicalize(fingerprint.semantic) !== canonicalize(expected.semantic)) {
    issues.push({
      path: "/intent/fingerprint/semantic",
      code: "semantic-fingerprint",
      message: "The semantic fingerprint does not bind the canonical intent."
    });
  }
  if (canonicalize(fingerprint.operational) !== canonicalize(expected.operational)) {
    issues.push({
      path: "/intent/fingerprint/operational",
      code: "operational-fingerprint",
      message:
        "The operational fingerprint does not bind constraints and authoritative context."
    });
  }
  if (fingerprint.cacheKey !== expected.cacheKey) {
    issues.push({
      path: "/intent/fingerprint/cacheKey",
      code: "cache-key",
      message: "The cache key does not bind every semantic, policy, capability, and partition input."
    });
  }
  if (
    !verifySeal(fingerprint.semantic) ||
    !verifySeal(fingerprint.operational) ||
    digestValue(omitDigest(fingerprint)) !== fingerprint.digest
  ) {
    issues.push({
      path: "/intent/fingerprint/digest",
      code: "fingerprint-digest",
      message: "At least one fingerprint digest is invalid."
    });
  }
  return { valid: issues.length === 0, issues };
}

export function evaluateCacheAdmission(
  candidate: CompositeFingerprint,
  cached: CompositeFingerprint
): CacheAdmissionDecision {
  const valid =
    verifySeal(candidate.semantic) &&
    verifySeal(candidate.operational) &&
    verifySeal(candidate) &&
    verifySeal(cached.semantic) &&
    verifySeal(cached.operational) &&
    verifySeal(cached);
  if (!valid) {
    return {
      admitted: false,
      semanticEquivalent: false,
      operationalEquivalent: false,
      reason: "invalid-fingerprint"
    };
  }

  const semanticEquivalent = canonicalize(candidate.semantic) === canonicalize(cached.semantic);
  const operationalEquivalent =
    canonicalize(candidate.operational) === canonicalize(cached.operational) &&
    candidate.cacheKey === cached.cacheKey;
  return {
    admitted: semanticEquivalent && operationalEquivalent,
    semanticEquivalent,
    operationalEquivalent,
    reason: !semanticEquivalent
      ? "semantic-mismatch"
      : !operationalEquivalent
        ? "operational-mismatch"
        : "equivalent"
  };
}
