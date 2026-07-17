import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";

import type { ContractType, ValidationIssue, ValidationResult } from "./types.js";

const schemaPath = fileURLToPath(
  new URL("../../schemas/v1/agentic-strata.schema.json", import.meta.url)
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Record<string, unknown>;
const rawSchemaId: unknown = schema.$id;

if (typeof rawSchemaId !== "string") {
  throw new Error("The contract bundle must define a schema identifier.");
}
const schemaId = rawSchemaId;

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const addFormats = addFormatsImport as unknown as FormatsPlugin;
addFormats(ajv);
ajv.addSchema(schema, schemaId);

const validators = new Map<string, ValidateFunction>();

function validatorFor(contractType: ContractType): ValidateFunction {
  const cached = validators.get(contractType);
  if (cached !== undefined) {
    return cached;
  }

  const validator = ajv.compile({ $ref: `${schemaId}#/$defs/${contractType}` });
  validators.set(contractType, validator);
  return validator;
}

function toIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || "/",
    code: error.keyword,
    message: error.message ?? "Contract validation failed."
  }));
}

export function validateAs(contractType: ContractType, document: unknown): ValidationResult {
  const validator = validatorFor(contractType);
  const valid = validator(document);
  return { valid, issues: valid ? [] : toIssues(validator.errors) };
}

export function validateDocument(document: unknown): ValidationResult {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return {
      valid: false,
      issues: [{ path: "/", code: "type", message: "A contract must be a JSON object." }]
    };
  }

  const contractType = (document as { contractType?: unknown }).contractType;
  if (typeof contractType !== "string" || !contractTypes.has(contractType as ContractType)) {
    return {
      valid: false,
      issues: [
        {
          path: "/contractType",
          code: "enum",
          message: "The contractType is missing or unsupported."
        }
      ]
    };
  }

  return validateAs(contractType as ContractType, document);
}

export const contractTypes = new Set<ContractType>([
  "ApplicationManifest",
  "IntentEnvelope",
  "OutcomeContract",
  "ExecutionEnvelope",
  "BudgetUsage",
  "AuthorityGrant",
  "ApprovalReceipt",
  "DelegationEnvelope",
  "CapabilityContract",
  "DecisionEvidence",
  "RuntimeArtifact",
  "ArtifactAttestation",
  "TraceEvent",
  "ConformanceReport",
  "AdapterMapping",
  "RunBundle"
]);

export function getSchemaPath(): string {
  return schemaPath;
}
