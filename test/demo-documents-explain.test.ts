import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import packageMetadata from "../package.json" with { type: "json" };

import { describe, expect, it } from "vitest";

import {
  MockChangeCapability,
  explainRun,
  runConformance,
  runDemo
} from "../src/index.js";
import { readDocument, writeJson, writeText } from "../src/adapters/documents.js";

describe("executable enterprise change example", () => {
  it("prepares, commits once, reads back, and explains evidence", () => {
    const result = runDemo();
    const report = runConformance(result.bundle, "enterprise", {
      generatedAt: "2026-07-17T12:01:00.000Z"
    });
    const explanation = explainRun(result.bundle, report);
    expect(result.readBack).toBe(true);
    expect(result.duplicateWasSuppressed).toBe(true);
    expect(explanation).toContain("Replay integrity: valid");
    expect(explanation).toContain(`Evaluator: ${report.evaluator.name} ${report.evaluator.version}`);
    expect(explanation).toContain("not private model reasoning");
    expect(report.evaluator.version).toBe(packageMetadata.version);
  });

  it("fails closed when an idempotency key is reused for another action", () => {
    const demo = runDemo().bundle;
    const authority = demo.authorityGrants[0];
    const approval = demo.approvals[0];
    if (authority === undefined || approval === undefined) throw new Error("demo authority missing");
    const capability = new MockChangeCapability();
    const resource = "configuration://workspace/sample-feature";
    capability.seed(resource, "enabled", false);
    const first = capability.prepare({ resource, key: "enabled", value: true });
    const context = {
      actorId: authority.subject,
      idempotencyKey: "stable-key",
      occurredAt: "2026-07-17T12:00:00.000Z",
      authority,
      approval
    };
    capability.commit(first, context);
    expect(() =>
      capability.commit(
        capability.prepare({ resource, key: "enabled", value: false }),
        context
      )
    ).toThrow("cannot be reused");
  });

  it("denies unauthorized commits and supports bounded compensation", () => {
    const demo = runDemo().bundle;
    const authority = demo.authorityGrants[0];
    const approval = demo.approvals[0];
    if (authority === undefined || approval === undefined) throw new Error("demo authority missing");
    const capability = new MockChangeCapability();
    const resource = "configuration://workspace/sample-feature";
    capability.seed(resource, "enabled", false);
    const prepared = capability.prepare({ resource, key: "enabled", value: true });
    const context = {
      actorId: authority.subject,
      idempotencyKey: "compensate-key",
      occurredAt: "2026-07-17T12:00:00.000Z",
      authority,
      approval
    };
    expect(() => capability.commit(prepared, { ...context, actorId: "model-output" })).toThrow(
      "Commit denied"
    );
    const receipt = capability.commit(prepared, context);
    expect(capability.verify(prepared).verified).toBe(true);
    expect(capability.compensate(prepared, receipt, context).restored).toBe(false);
    expect(capability.readBack(resource, "enabled")).toBe(false);
    expect(() =>
      capability.compensate(prepared, receipt, { ...context, actorId: "model-output" })
    ).toThrow("Compensation denied");
  });
});

describe("JSON and YAML document boundary", () => {
  it("reads both formats and writes stable newline-terminated output", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentic-strata-documents-"));
    const jsonPath = join(directory, "value.json");
    const yamlPath = join(directory, "value.yaml");
    const textPath = join(directory, "note.md");
    writeJson(jsonPath, { enabled: true });
    writeFileSync(yamlPath, "enabled: true\n", "utf8");
    writeText(textPath, "evidence");
    expect(readDocument(jsonPath)).toEqual({ enabled: true });
    expect(readDocument(yamlPath)).toEqual({ enabled: true });
    expect(readFileSync(jsonPath, "utf8").endsWith("\n")).toBe(true);
    expect(readFileSync(textPath, "utf8")).toBe("evidence\n");
    expect(() => readDocument(directory)).toThrow("regular file");
  });

  it("rejects duplicate JSON member names and non-I-JSON strings", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentic-strata-strict-json-"));
    const duplicatePath = join(directory, "duplicate.json");
    const escapedDuplicatePath = join(directory, "escaped-duplicate.json");
    const surrogatePath = join(directory, "surrogate.json");
    writeFileSync(duplicatePath, '{"scope":"deny","scope":"allow"}\n', "utf8");
    writeFileSync(
      escapedDuplicatePath,
      '{"\\u0073cope":"deny","scope":"allow"}\n',
      "utf8"
    );
    writeFileSync(surrogatePath, '{"value":"\\ud800"}\n', "utf8");
    expect(() => readDocument(duplicatePath)).toThrow("unique object member names");
    expect(() => readDocument(escapedDuplicatePath)).toThrow("unique object member names");
    expect(() => readDocument(surrogatePath)).toThrow("lone Unicode surrogates");
  });
});
