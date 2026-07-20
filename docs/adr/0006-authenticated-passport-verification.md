# ADR 0006: Provider-neutral authenticated Passport verification

Status: accepted for v0.4

## Context

Execution Passport v2 and `verifyExecutionPassport` establish deterministic
binding across the supplied Statement, run bundle, conformance report, OASF
record, and external execution-evidence bytes. They intentionally do not prove
who produced a wholly self-consistent artifact set. Consumers that require
authenticity need a fail-closed composition without coupling the contract core
to Sigstore, a public trust root, or one identity provider.

## Decision

The root export provides `verifyAuthenticatedExecutionPassport` and a generic
`EnvelopeVerifier` port. Artifact-set verification always runs first. The port
receives the exact RFC 8785 UTF-8 Passport bytes and fixed payload type
`application/vnd.in-toto+json`; a final authenticated result requires a complete
verified signer and a matching authenticated-payload digest. Exceptions,
missing evidence, failed verification, and a bare Statement remain unverified.
There is no automatic unsigned fallback.

Sigstore support is isolated behind the optional `agentic-strata/sigstore`
subpath. `sigstore` and `@sigstore/bundle` are optional peer dependencies and
the root index never imports the adapter. The adapter supports either an
injected, caller-trusted `BundleVerifier` for enterprise or offline trust
material, or a factory using the public Sigstore client and TUF options. Only
the public factory owns and wires configured CT/Rekor thresholds; an injected
verifier's trust enforcement is explicitly caller-owned.

The Sigstore boundary requires:

- DSSE rather than a message signature;
- exactly one signature;
- exact payload type and byte equality with the canonical Passport;
- CT-log and Rekor thresholds of at least one when using the public factory;
- a cryptographically verified signer containing both issuer and SAN; and
- literal equality with one configured issuer-plus-SAN pair.

Identity policy has no regular-expression, wildcard, or issuer-only mode.

## Consequences

- Core consumers can integrate other authenticated-envelope systems without a
  Sigstore dependency.
- Installing and importing the root package does not install or load Sigstore.
- Removing or replacing a DSSE envelope cannot silently downgrade an
  authenticated-required decision.
- Private trust material and public TUF trust can use the same adapter surface.
- The adapter performs verification only. Signing, OIDC token acquisition, key
  custody, root distribution and refresh, revocation, and trusted timestamping
  remain deployment responsibilities.
- Sigstore 5 currently supports one signature in a bundle; multi-party or
  threshold-signature policy requires a future, separately versioned design.
