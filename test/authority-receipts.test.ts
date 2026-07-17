import { describe, expect, it } from "vitest";

import {
  API_VERSION,
  appendTraceEvent,
  budgetIsAttenuated,
  digestValue,
  evidenceIndex,
  seal,
  validateChildGrant,
  validateDelegation,
  verifyTraceChain
} from "../src/index.js";
import type { AuthorityGrant, DelegationEnvelope, TraceEvent } from "../src/index.js";
import { runDemo } from "../src/demo/demo.js";

describe("authority attenuation", () => {
  const { authorityGrants, delegations } = runDemo().bundle;
  const parent = authorityGrants[0] as AuthorityGrant;
  const delegation = delegations[0] as DelegationEnvelope;

  it("accepts narrower budgets and delegations", () => {
    expect(budgetIsAttenuated(delegation.budget, parent.budget)).toBe(true);
    expect(validateDelegation(delegation, parent)).toEqual({ valid: true, issues: [] });
  });

  it.each([
    ["parent", { parentGrantId: "grant-other" }],
    ["delegator", { delegator: "agent-other" }],
    ["scope", { scopes: ["change:unknown"] }],
    ["resource", { resourcePatterns: ["configuration://other"] }],
    ["budget", { budget: { ...delegation.budget, maxTokens: parent.budget.maxTokens + 1 } }],
    ["time", { expiresAt: "2027-07-17T12:05:00.000Z" }]
  ])("rejects %s expansion", (_label, change) => {
    expect(validateDelegation({ ...delegation, ...change }, parent).valid).toBe(false);
  });

  it("rejects invalid numeric budgets and time windows even before schema validation", () => {
    expect(
      budgetIsAttenuated({ ...delegation.budget, maxSteps: Number.NaN }, parent.budget)
    ).toBe(false);
    expect(validateDelegation({ ...delegation, validFrom: "not-a-time" }, parent).valid).toBe(
      false
    );
  });

  it("validates an issued child grant and rejects a model-like issuer", () => {
    const child: AuthorityGrant = seal({
      contractType: "AuthorityGrant",
      apiVersion: API_VERSION,
      grantId: "grant-child-001",
      issuer: { type: "service-policy", id: parent.subject },
      subject: "agent-child",
      scopes: ["change:verify"],
      resourcePatterns: [...parent.resourcePatterns],
      budget: { maxSteps: 1, maxDurationMs: 1000, maxCostMicros: 0, maxTokens: 100 },
      validFrom: parent.validFrom,
      expiresAt: "2026-07-17T12:05:00.000Z",
      parentGrantId: parent.grantId
    });
    expect(validateChildGrant(child, parent).valid).toBe(true);
    expect(
      validateChildGrant(
        { ...child, issuer: { type: "service-policy", id: "model-output" } },
        parent
      ).valid
    ).toBe(false);
  });
});

describe("runtime receipt replay", () => {
  const bundle = runDemo().bundle;

  it("replays a valid chain against independently indexed evidence", () => {
    const result = verifyTraceChain(bundle.traceEvents, evidenceIndex(bundle));
    expect(result.valid).toBe(true);
    expect(result.eventsReplayed).toBe(bundle.traceEvents.length);
    expect(result.finalDigest).toBe(bundle.traceEvents.at(-1)?.digest);
  });

  it("creates a genesis receipt with a null predecessor", () => {
    const event = appendTraceEvent(undefined, {
      eventId: "event-genesis",
      runId: "run-genesis",
      sequence: 0,
      eventType: "intent.accepted",
      stratum: "intent-outcome",
      summary: "Accepted.",
      attributes: {},
      evidenceRefs: [],
      occurredAt: "2026-07-17T12:00:00.000Z"
    });
    expect(event.previousDigest).toBeNull();
    expect(verifyTraceChain([event]).valid).toBe(true);
  });

  it("reports tampering, broken links, mixed runs, gaps, and unknown evidence", () => {
    const events: TraceEvent[] = structuredClone(bundle.traceEvents);
    events[1] = {
      ...(events[1] as TraceEvent),
      sequence: 4,
      runId: "run-other",
      previousDigest: digestValue("wrong-link"),
      summary: "tampered",
      evidenceRefs: ["urn:agentic-strata:event:missing"]
    };
    const result = verifyTraceChain(events, evidenceIndex(bundle));
    expect(result.valid).toBe(false);
    expect(new Set(result.issues.map((issue) => issue.code))).toEqual(
      new Set(["sequence", "run-id", "chain-link", "tamper-detected", "missing-evidence"])
    );
  });

  it("rejects self and future receipt evidence", () => {
    const events: TraceEvent[] = structuredClone(bundle.traceEvents);
    const first = events[0];
    const second = events[1];
    if (first === undefined || second === undefined) throw new Error("demo events missing");
    events[0] = {
      ...first,
      evidenceRefs: [`urn:agentic-strata:event:${second.eventId}`]
    };
    const result = verifyTraceChain(events, evidenceIndex(bundle));
    expect(result.issues.map((issue) => issue.code)).toContain("future-evidence");
  });

  it("rejects invalid and backwards receipt time", () => {
    const events: TraceEvent[] = structuredClone(bundle.traceEvents);
    const second = events[1];
    const third = events[2];
    if (second === undefined || third === undefined) throw new Error("demo events missing");
    events[1] = { ...second, occurredAt: "2020-01-01T00:00:00.000Z" };
    events[2] = { ...third, occurredAt: "not-a-time" };
    const codes = verifyTraceChain(events).issues.map((issue) => issue.code);
    expect(codes).toContain("timestamp");
    expect(codes).toContain("time-order");
    expect(codes).toContain("tamper-detected");
  });
});
