import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { writeJson } from "../src/adapters/documents.js";
import { createCliProgram } from "../src/cli-program.js";
import {
  canonicalize,
  digestValue,
  runConformance,
  runDemo,
  validateDocument
} from "../src/index.js";
import type { ExecutionEvidenceBinding } from "../src/index.js";

function evidenceBinding(): ExecutionEvidenceBinding {
  return {
    contractType: "ExecutionEvidenceBinding",
    role: "execution-placement",
    producer: "placement-provider",
    runIdDigest: digestValue("run-change-demo-001"),
    observedAt: "2026-07-17T11:59:59.000Z",
    authority: "observation-only",
    resource: {
      name: "execution-placement-evidence",
      digest: { sha256: digestValue({ contentFreeFixture: true }) },
      mediaType: "application/vnd.example.execution-placement+json"
    },
    disclosure: "content-free"
  };
}

describe("passport CLI", () => {
  it("writes canonical Statement bytes and verifies the installed consumer artifact set", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentic-strata-passport-cli-"));
    const logOutput = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const bundle = runDemo().bundle;
      const report = runConformance(bundle, "enterprise", {
        generatedAt: "2026-07-17T12:00:00.000Z"
      });
      const bundlePath = join(directory, "bundle.json");
      const reportPath = join(directory, "report.json");
      const oasfPath = join(directory, "external-oasf.json");
      const evidencePath = join(directory, "execution-evidence-binding.json");
      const evidenceResourcePath = join(directory, "execution-placement-evidence.json");
      const outputPath = join(directory, "passport.json");
      writeJson(bundlePath, bundle);
      writeJson(reportPath, report);
      writeJson(oasfPath, { opaqueExternalRecord: "must-not-be-embedded" });
      writeJson(evidencePath, evidenceBinding());
      writeFileSync(evidenceResourcePath, '{"contentFreeFixture":true}', "utf8");

      await createCliProgram().parseAsync(
        [
          "passport",
          bundlePath,
          "--report",
          reportPath,
          "--oasf-record",
          oasfPath,
          "--oasf-media-type",
          "application/json",
          "--execution-evidence",
          evidencePath,
          "--issued-at",
          "2026-07-17T12:00:01.000Z",
          "--output",
          outputPath
        ],
        { from: "user" }
      );

      const raw = readFileSync(outputPath, "utf8");
      const passport = JSON.parse(raw) as unknown;
      expect(raw).toBe(canonicalize(passport));
      expect(validateDocument(passport)).toEqual({ valid: true, issues: [] });
      expect(raw).not.toContain("must-not-be-embedded");
      expect(raw).not.toContain(directory);
      expect(raw.endsWith("\n")).toBe(false);

      await createCliProgram().parseAsync(
        [
          "verify-passport",
          outputPath,
          "--bundle",
          bundlePath,
          "--report",
          reportPath,
          "--oasf-record",
          oasfPath,
          "--execution-evidence-resource",
          evidenceResourcePath
        ],
        { from: "user" }
      );
      const verification = JSON.parse(
        String(logOutput.mock.calls.at(-1)?.[0])
      ) as Record<string, unknown>;
      expect(verification).toMatchObject({
        valid: true,
        verifiedSubjects: 3,
        verifiedExecutionEvidenceResources: 1
      });
    } finally {
      logOutput.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects content-bearing execution evidence at the CLI boundary", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agentic-strata-passport-cli-invalid-"));
    const previousExitCode = process.exitCode;
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const bundle = runDemo().bundle;
      const report = runConformance(bundle, "enterprise", {
        generatedAt: "2026-07-17T12:00:00.000Z"
      });
      const bundlePath = join(directory, "bundle.json");
      const reportPath = join(directory, "report.json");
      const oasfPath = join(directory, "external-oasf.json");
      const evidencePath = join(directory, "raw-execution.json");
      const binding = evidenceBinding();
      writeJson(bundlePath, bundle);
      writeJson(reportPath, report);
      writeJson(oasfPath, { opaqueExternalRecord: true });
      writeJson(evidencePath, {
        ...binding,
        resource: { ...binding.resource, content: "sensitive-output" }
      });

      await expect(
        createCliProgram().parseAsync(
          [
            "passport",
            bundlePath,
            "--report",
            reportPath,
            "--oasf-record",
            oasfPath,
            "--oasf-media-type",
            "application/json",
            "--execution-evidence",
            evidencePath,
            "--issued-at",
            "2026-07-17T12:00:01.000Z"
          ],
          { from: "user" }
        )
      ).rejects.toThrow("not a valid v2 content-free ExecutionEvidenceBinding");
    } finally {
      process.exitCode = previousExitCode;
      errorOutput.mockRestore();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
