import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { CONFORMANCE_PROFILES } from "../contracts/types.js";
import type { ConformanceProfile } from "../contracts/types.js";

export interface ProfileDefinition {
  extends: ConformanceProfile[];
  rules: string[];
}

export interface ProfileConfiguration {
  apiVersion: string;
  profiles: Record<ConformanceProfile, ProfileDefinition>;
}

export const defaultProfileConfigPath = fileURLToPath(
  new URL("../../config/conformance.profiles.yaml", import.meta.url)
);

function isProfile(value: unknown): value is ConformanceProfile {
  return (
    typeof value === "string" &&
    (CONFORMANCE_PROFILES as readonly string[]).includes(value)
  );
}

export function loadProfileConfiguration(path = defaultProfileConfigPath): ProfileConfiguration {
  const raw = parse(readFileSync(path, "utf8")) as unknown;
  if (raw === null || typeof raw !== "object") {
    throw new Error("Conformance profile configuration must be an object.");
  }
  const candidate = raw as { apiVersion?: unknown; profiles?: unknown };
  if (candidate.apiVersion !== "agenticstrata.dev/v1" || candidate.profiles === null || typeof candidate.profiles !== "object") {
    throw new Error("Conformance profile configuration has an unsupported shape or version.");
  }

  const result = {} as Record<ConformanceProfile, ProfileDefinition>;
  for (const profile of CONFORMANCE_PROFILES) {
    const definition = (candidate.profiles as Record<string, unknown>)[profile];
    if (definition === null || typeof definition !== "object") {
      throw new Error(`Missing conformance profile: ${profile}`);
    }
    const values = definition as { extends?: unknown; rules?: unknown };
    if (!Array.isArray(values.extends) || !values.extends.every(isProfile)) {
      throw new Error(`Invalid inheritance for conformance profile: ${profile}`);
    }
    if (
      !Array.isArray(values.rules) ||
      !values.rules.every((item): item is string => typeof item === "string" && item.length > 0)
    ) {
      throw new Error(`Invalid rules for conformance profile: ${profile}`);
    }
    result[profile] = {
      extends: values.extends,
      rules: values.rules
    };
  }

  return { apiVersion: candidate.apiVersion, profiles: result };
}

export function resolveProfileRules(
  profile: ConformanceProfile,
  configuration: ProfileConfiguration
): string[] {
  const resolved: string[] = [];
  const visited = new Set<ConformanceProfile>();
  const active = new Set<ConformanceProfile>();

  const visit = (current: ConformanceProfile): void => {
    if (active.has(current)) {
      throw new Error(`Cyclic conformance profile inheritance at ${current}.`);
    }
    if (visited.has(current)) {
      return;
    }
    active.add(current);
    for (const parent of configuration.profiles[current].extends) {
      visit(parent);
    }
    for (const rule of configuration.profiles[current].rules) {
      if (!resolved.includes(rule)) {
        resolved.push(rule);
      }
    }
    active.delete(current);
    visited.add(current);
  };

  visit(profile);
  return resolved;
}
