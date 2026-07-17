import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";

import {
  EXECUTION_PASSPORT_PREDICATE_TYPE,
  IN_TOTO_STATEMENT_V1_TYPE,
  type CapabilityContract,
  type ContractType,
  type SchemaDefinition,
  type ValidationIssue,
  type ValidationResult
} from "./types.js";

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

function validatorFor(schemaDefinition: SchemaDefinition): ValidateFunction {
  const cached = validators.get(schemaDefinition);
  if (cached !== undefined) {
    return cached;
  }

  const validator = ajv.compile({ $ref: `${schemaId}#/$defs/${schemaDefinition}` });
  validators.set(schemaDefinition, validator);
  return validator;
}

function toIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath || "/",
    code: error.keyword,
    message: error.message ?? "Contract validation failed."
  }));
}

export function validateAs(
  schemaDefinition: SchemaDefinition,
  document: unknown
): ValidationResult {
  const validator = validatorFor(schemaDefinition);
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

  const candidate = document as {
    _type?: unknown;
    predicateType?: unknown;
    contractType?: unknown;
  };
  if ("_type" in candidate || "predicateType" in candidate) {
    if (candidate._type !== IN_TOTO_STATEMENT_V1_TYPE) {
      return {
        valid: false,
        issues: [
          {
            path: "/_type",
            code: "const",
            message: "The in-toto Statement type is missing or unsupported."
          }
        ]
      };
    }
    if (candidate.predicateType !== EXECUTION_PASSPORT_PREDICATE_TYPE) {
      return {
        valid: false,
        issues: [
          {
            path: "/predicateType",
            code: "const",
            message: "The in-toto predicate type is missing or unsupported."
          }
        ]
      };
    }
    return validateAs("ExecutionPassport", document);
  }

  const contractType = candidate.contractType;
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

export function validateCapabilitySchemas(
  capability: CapabilityContract
): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const [name, value] of [
    ["inputSchema", capability.inputSchema],
    ["outputSchema", capability.outputSchema]
  ] as const) {
    try {
      const compiler = new Ajv2020({ strict: true, allErrors: true });
      addFormats(compiler);
      compiler.compile(value);
    } catch (error: unknown) {
      issues.push({
        path: `/capabilities/${capability.capabilityId}/${name}`,
        code: "json-schema",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return { valid: issues.length === 0, issues };
}

export const contractTypes = new Set<ContractType>([
  "ApplicationManifest",
  "IntentEnvelope",
  "OutcomeContract",
  "CriterionResult",
  "ExecutionEnvelope",
  "BudgetUsage",
  "RuntimeBoundaryEvidence",
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
