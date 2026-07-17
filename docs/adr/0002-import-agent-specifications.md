# ADR 0002: Import agent specifications by digest

Status: accepted

## Context

Portable agent and flow definitions already have focused specifications. Recreating their fields inside an application architecture would introduce competing identities and tool declarations.

## Decision

The application manifest imports an external specification by reference, digest, and media type. AgenticStrata defines only application runtime bindings and evidence.

## Consequences

- Agent packaging can evolve independently.
- The application retains an immutable lineage pointer.
- Resolvers and signature verification remain replaceable integration concerns.
