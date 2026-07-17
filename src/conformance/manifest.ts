import { PLANES, STRATA } from "../contracts/types.js";
import type { ApplicationManifest, ValidationIssue, ValidationResult } from "../contracts/types.js";
import { validateAs } from "../contracts/registry.js";

export function lintManifest(manifest: ApplicationManifest): ValidationResult {
  const schema = validateAs("ApplicationManifest", manifest);
  const issues: ValidationIssue[] = [...schema.issues];
  if (!schema.valid) {
    return { valid: false, issues };
  }

  const byId = new Map(manifest.architecture.strata.map((stratum) => [stratum.id, stratum]));
  for (const [ordinal, id] of STRATA.entries()) {
    const stratum = byId.get(id);
    if (stratum === undefined) {
      issues.push({ path: "/architecture/strata", code: "missing-stratum", message: `Missing stratum ${id}.` });
      continue;
    }
    if (stratum.ordinal !== ordinal) {
      issues.push({
        path: `/architecture/strata/${ordinal}/ordinal`,
        code: "stratum-ordinal",
        message: `${id} must use ordinal ${ordinal}.`
      });
    }
    for (const dependency of stratum.dependsOn) {
      const target = byId.get(dependency as (typeof STRATA)[number]);
      if (target === undefined) {
        issues.push({
          path: `/architecture/strata/${ordinal}/dependsOn`,
          code: "unknown-dependency",
          message: `${id} references an unknown stratum: ${dependency}.`
        });
      } else if (target.ordinal <= stratum.ordinal) {
        issues.push({
          path: `/architecture/strata/${ordinal}/dependsOn`,
          code: "dependency-direction",
          message: `${id} may only depend on lower execution strata.`
        });
      }
    }
  }

  if (new Set(manifest.architecture.strata.map((stratum) => stratum.id)).size !== STRATA.length) {
    issues.push({ path: "/architecture/strata", code: "duplicate-strata", message: "Each stratum must appear exactly once." });
  }
  if (PLANES.some((plane) => !manifest.architecture.planes.includes(plane))) {
    issues.push({ path: "/architecture/planes", code: "missing-plane", message: "All cross-cutting planes are required." });
  }

  return { valid: issues.length === 0, issues };
}
