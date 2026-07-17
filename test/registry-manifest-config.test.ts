import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { readDocument } from "../src/adapters/documents.js";
import {
  createExecutionPassport,
  defaultProfileConfigPath,
  getSchemaPath,
  lintManifest,
  loadProfileConfiguration,
  resolveProfileRules,
  runConformance,
  validateAs,
  validateDocument
} from "../src/index.js";
import type { ApplicationManifest, ProfileConfiguration } from "../src/index.js";
import { runDemo } from "../src/demo/demo.js";

function manifest(): ApplicationManifest {
  return structuredClone(runDemo().bundle.manifest);
}

describe("language-neutral contract registry", () => {
  it("validates every document through its declared contract type", () => {
    const bundle = runDemo().bundle;
    expect(validateAs("RunBundle", bundle).valid).toBe(true);
    expect(validateDocument(bundle)).toEqual({ valid: true, issues: [] });
    expect(readFileSync(getSchemaPath(), "utf8")).toContain('"$schema"');
  });

  it("rejects non-object and unknown contract input", () => {
    expect(validateDocument(null).issues[0]?.code).toBe("type");
    expect(validateDocument({ contractType: "Unknown" }).issues[0]?.code).toBe("enum");
  });

  it("reports schema paths for invalid contracts", () => {
    const invalid = { ...runDemo().bundle.execution, profile: "impossible" };
    const result = validateAs("ExecutionEnvelope", invalid);
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.path === "/profile")).toBe(true);
  });

  it("dispatches the supported in-toto predicate without a contractType", () => {
    const bundle = runDemo().bundle;
    const report = runConformance(bundle, "enterprise", {
      generatedAt: "2026-07-17T12:00:00.000Z"
    });
    const passport = createExecutionPassport({
      bundle,
      report,
      oasfRecord: { opaqueExternalRecord: true },
      oasfMediaType: "application/json",
      issuedAt: "2026-07-17T12:00:01.000Z"
    });
    expect(validateDocument(passport)).toEqual({ valid: true, issues: [] });
    expect(
      validateDocument({ ...passport, predicateType: "https://example.test/unknown" })
        .issues[0]
    ).toMatchObject({ path: "/predicateType", code: "const" });
    expect(validateDocument({ ...passport, _type: "https://example.test/unknown" }).issues[0])
      .toMatchObject({ path: "/_type", code: "const" });
  });

  it("validates the OASF and placement-provider loss mappings", () => {
    for (const path of ["adapters/oasf.mapping.yaml", "adapters/stagefabric.mapping.yaml"]) {
      expect(validateAs("AdapterMapping", readDocument(resolve(path)))).toEqual({
        valid: true,
        issues: []
      });
    }
  });
});

describe("manifest dependency lint", () => {
  it("accepts the complete reference layering", () => {
    expect(lintManifest(manifest())).toEqual({ valid: true, issues: [] });
  });

  it("rejects reversed, unknown, and misnumbered dependencies", () => {
    const value = manifest();
    const intent = value.architecture.strata.find((item) => item.id === "intent-outcome");
    const interaction = value.architecture.strata.find((item) => item.id === "interaction");
    if (intent === undefined || interaction === undefined) throw new Error("demo strata missing");
    intent.dependsOn = ["interaction", "not-a-stratum"];
    interaction.ordinal = 6;
    const codes = lintManifest(value).issues.map((issue) => issue.code);
    expect(codes).toEqual(
      expect.arrayContaining(["dependency-direction", "unknown-dependency", "stratum-ordinal"])
    );
  });

  it("rejects duplicate strata even when the schema shape remains valid", () => {
    const value = manifest();
    const first = value.architecture.strata[0];
    if (first === undefined) throw new Error("demo strata missing");
    value.architecture.strata[1] = structuredClone(first);
    expect(lintManifest(value).issues.map((issue) => issue.code)).toContain("duplicate-strata");
  });
});

describe("configurable conformance profiles", () => {
  it("loads the packaged profiles and resolves inheritance once", () => {
    const configuration = loadProfileConfiguration();
    const rules = resolveProfileRules("regulated", configuration);
    expect(defaultProfileConfigPath).toContain("conformance.profiles.yaml");
    expect(rules).toContain("schema.bundle");
    expect(rules).toContain("policy.enterprise-controls");
    expect(rules).toContain("policy.regulated-controls");
    expect(new Set(rules).size).toBe(rules.length);
  });

  it("rejects malformed profiles", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentic-strata-profile-"));
    const path = join(directory, "profiles.yaml");
    writeFileSync(path, "apiVersion: wrong\nprofiles: {}\n", "utf8");
    expect(() => loadProfileConfiguration(path)).toThrow("unsupported shape");
  });

  it("detects cyclic inheritance", () => {
    const configuration: ProfileConfiguration = {
      apiVersion: "agenticstrata.dev/v1",
      profiles: {
        core: { extends: ["enterprise"], rules: [] },
        "local-private": { extends: ["core"], rules: [] },
        enterprise: { extends: ["core"], rules: [] },
        regulated: { extends: ["enterprise"], rules: [] },
        distributed: { extends: ["enterprise"], rules: [] }
      }
    };
    expect(() => resolveProfileRules("core", configuration)).toThrow("Cyclic");
  });
});
