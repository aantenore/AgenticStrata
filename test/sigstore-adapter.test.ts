import {
  createHash,
  generateKeyPairSync,
  sign,
  verify as verifySignature
} from "node:crypto";

import type { SerializedBundle } from "@sigstore/bundle";
import { describe, expect, it } from "vitest";
import type { BundleVerifier } from "sigstore";

import {
  createSigstoreEnvelopeVerifier,
  type SigstoreIdentityPolicy
} from "../src/adapters/sigstore.js";
import {
  canonicalize,
  createExecutionPassport,
  runConformance,
  runDemo,
  verifyAuthenticatedExecutionPassport
} from "../src/index.js";

const PAYLOAD_TYPE = "application/vnd.in-toto+json";
const ISSUER = "https://issuer.example";
const SAN = "https://identity.example/workload";
const KEY_HINT = "agentic-strata-test-ed25519";
const GENERATED_AT = "2026-07-17T12:00:00.000Z";
const ISSUED_AT = "2026-07-17T12:00:01.000Z";

function pae(payloadType: string, payload: Uint8Array): Buffer {
  const type = Buffer.from(payloadType, "utf8");
  const body = Buffer.from(payload);
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${type.length} `, "utf8"),
    type,
    Buffer.from(` ${body.length} `, "utf8"),
    body
  ]);
}

function dsseBundle(
  payload: Uint8Array,
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
  payloadType = PAYLOAD_TYPE
): SerializedBundle {
  const signature = sign(null, pae(payloadType, payload), privateKey);
  return {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    verificationMaterial: {
      x509CertificateChain: undefined,
      publicKey: { hint: KEY_HINT },
      certificate: undefined,
      tlogEntries: [],
      timestampVerificationData: { rfc3161Timestamps: [] }
    },
    dsseEnvelope: {
      payload: Buffer.from(payload).toString("base64"),
      payloadType,
      signatures: [{ keyid: KEY_HINT, sig: signature.toString("base64") }]
    },
    messageSignature: undefined
  };
}

function ed25519BundleVerifier(
  publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"],
  identity: { issuer?: string; subjectAlternativeName?: string } = {
    issuer: ISSUER,
    subjectAlternativeName: SAN
  }
): BundleVerifier {
  return {
    verify: (bundle) => {
      const envelope = bundle.dsseEnvelope;
      const signature = envelope?.signatures[0];
      if (
        envelope === undefined ||
        signature === undefined ||
        !verifySignature(
          null,
          pae(envelope.payloadType, Buffer.from(envelope.payload, "base64")),
          publicKey,
          Buffer.from(signature.sig, "base64")
        )
      ) {
        throw new Error("invalid test signature");
      }
      return {
        key: publicKey,
        identity: {
          ...(identity.subjectAlternativeName === undefined
            ? {}
            : { subjectAlternativeName: identity.subjectAlternativeName }),
          ...(identity.issuer === undefined
            ? {}
            : { extensions: { issuer: identity.issuer } })
        }
      };
    }
  };
}

function exactPolicy(
  issuer = ISSUER,
  subjectAlternativeName = SAN
): SigstoreIdentityPolicy {
  return { allowedSigners: [{ issuer, subjectAlternativeName }] };
}

function passportFixture() {
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
  const payload = Buffer.from(canonicalize(passport), "utf8");
  return { bundle, report, oasfRecord, passport, payload };
}

function flipSignature(bundle: SerializedBundle): SerializedBundle {
  const changed = structuredClone(bundle);
  const signature = changed.dsseEnvelope?.signatures[0];
  if (signature === undefined) {
    throw new Error("test fixture is not DSSE");
  }
  const bytes = Buffer.from(signature.sig, "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  signature.sig = bytes.toString("base64");
  return changed;
}

describe("optional Sigstore adapter", () => {
  it("verifies an Ed25519 DSSE envelope and exact signer policy without network", async () => {
    const fixture = passportFixture();
    const keys = generateKeyPairSync("ed25519");
    const envelope = dsseBundle(fixture.payload, keys.privateKey);
    const verifier = createSigstoreEnvelopeVerifier({
      bundleVerifier: ed25519BundleVerifier(keys.publicKey),
      identityPolicy: exactPolicy(),
      thresholds: { ctLog: 1, tlog: 1 }
    });

    const result = await verifyAuthenticatedExecutionPassport({
      ...fixture,
      envelope,
      verifier
    });

    expect(result).toMatchObject({
      valid: true,
      trustLevel: "authenticated",
      authentication: {
        status: "verified",
        provider: "sigstore",
        signer: { issuer: ISSUER, subjectAlternativeName: SAN }
      }
    });
  });

  it("rejects different payload bytes and payload types before trust verification", async () => {
    const fixture = passportFixture();
    const keys = generateKeyPairSync("ed25519");
    const verifier = createSigstoreEnvelopeVerifier({
      bundleVerifier: ed25519BundleVerifier(keys.publicKey),
      identityPolicy: exactPolicy()
    });

    const changedPayload = await verifier.verify({
      envelope: dsseBundle(Buffer.from("different", "utf8"), keys.privateKey),
      expectedPayload: fixture.payload,
      expectedPayloadType: PAYLOAD_TYPE
    });
    expect(changedPayload.issues[0]?.code).toBe("sigstore-payload-binding");

    const changedType = await verifier.verify({
      envelope: dsseBundle(fixture.payload, keys.privateKey, "application/json"),
      expectedPayload: fixture.payload,
      expectedPayloadType: PAYLOAD_TYPE
    });
    expect(changedType.issues[0]?.code).toBe("sigstore-payload-type");
  });

  it("rejects signature tampering and any signature count other than one", async () => {
    const fixture = passportFixture();
    const keys = generateKeyPairSync("ed25519");
    const valid = dsseBundle(fixture.payload, keys.privateKey);
    const verifier = createSigstoreEnvelopeVerifier({
      bundleVerifier: ed25519BundleVerifier(keys.publicKey),
      identityPolicy: exactPolicy()
    });

    const tampered = await verifier.verify({
      envelope: flipSignature(valid),
      expectedPayload: fixture.payload,
      expectedPayloadType: PAYLOAD_TYPE
    });
    expect(tampered.issues[0]?.code).toBe("sigstore-verification-failed");

    for (const signatures of [
      [],
      [
        ...(valid.dsseEnvelope?.signatures ?? []),
        ...(valid.dsseEnvelope?.signatures ?? [])
      ]
    ]) {
      const changed = structuredClone(valid);
      if (changed.dsseEnvelope === undefined) {
        throw new Error("test fixture is not DSSE");
      }
      changed.dsseEnvelope.signatures = signatures;
      const result = await verifier.verify({
        envelope: changed,
        expectedPayload: fixture.payload,
        expectedPayloadType: PAYLOAD_TYPE
      });
      expect(result.issues[0]?.code).toBe("sigstore-signature-count");
    }
  });

  it("requires exact issuer and SAN values and complete verified identity", async () => {
    const fixture = passportFixture();
    const keys = generateKeyPairSync("ed25519");
    const envelope = dsseBundle(fixture.payload, keys.privateKey);
    const literalWildcard = createSigstoreEnvelopeVerifier({
      bundleVerifier: ed25519BundleVerifier(keys.publicKey),
      identityPolicy: exactPolicy(ISSUER, "https://identity.example/*")
    });
    const denied = await literalWildcard.verify({
      envelope,
      expectedPayload: fixture.payload,
      expectedPayloadType: PAYLOAD_TYPE
    });
    expect(denied.issues[0]?.code).toBe("sigstore-identity-denied");

    const missing = createSigstoreEnvelopeVerifier({
      bundleVerifier: ed25519BundleVerifier(keys.publicKey, {
        subjectAlternativeName: SAN
      }),
      identityPolicy: exactPolicy()
    });
    const missingResult = await missing.verify({
      envelope,
      expectedPayload: fixture.payload,
      expectedPayloadType: PAYLOAD_TYPE
    });
    expect(missingResult.issues[0]?.code).toBe("sigstore-identity-missing");
  });

  it("rejects disabled trust thresholds and a bare-Statement downgrade", async () => {
    const fixture = passportFixture();
    const keys = generateKeyPairSync("ed25519");
    expect(() =>
      createSigstoreEnvelopeVerifier({
        bundleVerifier: ed25519BundleVerifier(keys.publicKey),
        identityPolicy: exactPolicy(),
        thresholds: { ctLog: 0, tlog: 1 }
      })
    ).toThrow("Sigstore ctLog threshold must be a positive integer.");

    const verifier = createSigstoreEnvelopeVerifier({
      bundleVerifier: ed25519BundleVerifier(keys.publicKey),
      identityPolicy: exactPolicy()
    });
    const result = await verifyAuthenticatedExecutionPassport({
      ...fixture,
      envelope: fixture.passport,
      verifier
    });
    expect(result).toMatchObject({
      valid: false,
      trustLevel: "unverified",
      authentication: { status: "failed" },
      issues: [{ code: "sigstore-bundle-invalid" }]
    });
  });

  it("rejects empty and duplicate exact signer policies", () => {
    const keys = generateKeyPairSync("ed25519");
    const bundleVerifier = ed25519BundleVerifier(keys.publicKey);
    const allowedSigner = exactPolicy().allowedSigners[0];
    if (allowedSigner === undefined) {
      throw new Error("test policy has no signer");
    }
    expect(() =>
      createSigstoreEnvelopeVerifier({
        bundleVerifier,
        identityPolicy: { allowedSigners: [] }
      })
    ).toThrow("Sigstore identity policy must contain between 1 and 32 exact allowed signers.");
    expect(() =>
      createSigstoreEnvelopeVerifier({
        bundleVerifier,
        identityPolicy: {
          allowedSigners: [allowedSigner, allowedSigner]
        }
      })
    ).toThrow("Sigstore identity policy must not contain duplicate allowed signers.");
  });

  it("uses SHA-256 payload digests compatible with the provider-neutral core", async () => {
    const fixture = passportFixture();
    const keys = generateKeyPairSync("ed25519");
    const verifier = createSigstoreEnvelopeVerifier({
      bundleVerifier: ed25519BundleVerifier(keys.publicKey),
      identityPolicy: exactPolicy()
    });
    const result = await verifier.verify({
      envelope: dsseBundle(fixture.payload, keys.privateKey),
      expectedPayload: fixture.payload,
      expectedPayloadType: PAYLOAD_TYPE
    });
    expect(result.authenticatedPayloadDigest).toBe(
      createHash("sha256").update(fixture.payload).digest("hex")
    );
  });
});
