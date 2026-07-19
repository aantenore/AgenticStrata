import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";

import {
  EXECUTION_PASSPORT_PREDICATE_TYPE,
  EXECUTION_PASSPORT_V1_PREDICATE_TYPE,
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

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function createLegacyPassportSchema(): {
  id: string;
  schema: Record<string, unknown>;
} {
  const legacy = structuredClone(schema);
  const id = `${schemaId}/execution-passport-v1`;
  legacy.$id = id;
  const definitions = requireRecord(legacy.$defs, "Schema definitions");
  const binding = requireRecord(
    definitions.ExecutionEvidenceBinding,
    "ExecutionEvidenceBinding definition"
  );
  const bindingProperties = requireRecord(
    binding.properties,
    "ExecutionEvidenceBinding properties"
  );
  for (const property of ["contractType", "runIdDigest", "observedAt", "authority"]) {
    Reflect.deleteProperty(bindingProperties, property);
  }
  if (!Array.isArray(binding.required)) {
    throw new Error("ExecutionEvidenceBinding required fields must be an array.");
  }
  binding.required = binding.required.filter(
    (field): field is string =>
      typeof field === "string" &&
      !["contractType", "runIdDigest", "observedAt", "authority"].includes(field)
  );

  const passport = requireRecord(
    definitions.ExecutionPassport,
    "ExecutionPassport definition"
  );
  const passportProperties = requireRecord(
    passport.properties,
    "ExecutionPassport properties"
  );
  const predicateType = requireRecord(
    passportProperties.predicateType,
    "ExecutionPassport predicateType"
  );
  predicateType.const = EXECUTION_PASSPORT_V1_PREDICATE_TYPE;
  return { id, schema: legacy };
}

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
const addFormats = addFormatsImport as unknown as FormatsPlugin;
addFormats(ajv);
ajv.addSchema(schema, schemaId);
const legacyPassportSchema = createLegacyPassportSchema();
ajv.addSchema(legacyPassportSchema.schema, legacyPassportSchema.id);

const validators = new Map<string, ValidateFunction>();
const legacyPassportValidator = ajv.compile({
  $ref: `${legacyPassportSchema.id}#/$defs/ExecutionPassport`
});

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
    if (candidate.predicateType === EXECUTION_PASSPORT_PREDICATE_TYPE) {
      return validateAs("ExecutionPassport", document);
    }
    if (candidate.predicateType === EXECUTION_PASSPORT_V1_PREDICATE_TYPE) {
      const valid = legacyPassportValidator(document);
      return {
        valid,
        issues: valid ? [] : toIssues(legacyPassportValidator.errors)
      };
    }
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
  "ExecutionEvidenceBinding",
  "AdapterMapping",
  "RunBundle"
]);

export function getSchemaPath(): string {
  return schemaPath;
}
