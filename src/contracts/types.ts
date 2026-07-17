export const API_VERSION = "agenticstrata.dev/v1" as const;
export const EVALUATOR_NAME = "agentic-strata" as const;
export const EVALUATOR_VERSION = "0.2.0-alpha.1" as const;
export const EVALUATOR_REVISION = "conformance-2026-07-17.3" as const;

export const IN_TOTO_STATEMENT_V1_TYPE = "https://in-toto.io/Statement/v1" as const;
export const EXECUTION_PASSPORT_PREDICATE_TYPE =
  "https://github.com/aantenore/AgenticStrata/tree/main/docs/spec/attestations/execution-passport/v1" as const;
export const EXECUTION_PASSPORT_SUBJECTS = {
  runBundle: "agentic-strata-run-bundle",
  conformanceReport: "agentic-strata-conformance-report",
  oasfRecord: "oasf-agent-record"
} as const;
export const EXECUTION_PASSPORT_MEDIA_TYPES = {
  runBundle: "application/vnd.aantenore.agenticstrata.run-bundle+json",
  conformanceReport: "application/vnd.aantenore.agenticstrata.conformance-report+json"
} as const;

export const STRATA = [
  "interaction",
  "intent-outcome",
  "control-orchestration",
  "collaboration",
  "capability",
  "knowledge-state",
  "model-compute"
] as const;

export const PLANES = [
  "trust-authority",
  "evidence-operations",
  "lifecycle-conformance"
] as const;

export const CONFORMANCE_PROFILES = [
  "core",
  "local-private",
  "enterprise",
  "regulated",
  "distributed"
] as const;

export type ApiVersion = typeof API_VERSION;
export type StratumId = (typeof STRATA)[number];
export type PlaneId = (typeof PLANES)[number];
export type ConformanceProfile = (typeof CONFORMANCE_PROFILES)[number];
export type Digest = string;
export type EvidenceRef = string;
export type Scalar = string | number | boolean | null;
export type ScalarMap = Record<string, Scalar>;
export type JsonValue = Scalar | JsonValue[] | { [key: string]: JsonValue };

export interface Budget {
  maxSteps: number;
  maxDurationMs: number;
  maxCostMicros: number;
  maxTokens: number;
}

export interface BudgetUsage {
  contractType: "BudgetUsage";
  apiVersion: ApiVersion;
  runId: string;
  steps: number;
  durationMs: number;
  costMicros: number;
  tokens: number;
  observedAt: string;
  digest: Digest;
}

export interface RuntimeBoundaryEvidence {
  contractType: "RuntimeBoundaryEvidence";
  apiVersion: ApiVersion;
  boundaryEvidenceId: string;
  runId: string;
  modelHosting: "local" | "private-cloud" | "managed";
  dataBoundary: "local" | "tenant" | "regional" | "global";
  networkEgressObserved: boolean;
  endpointDigest: Digest;
  producer: string;
  observationStartedAt: string;
  observedAt: string;
  digest: Digest;
}

export type PrivacyPartition = "public" | "tenant" | "private" | "restricted";

export interface SemanticFingerprint {
  algorithm: "sha256";
  specVersion: ApiVersion;
  canonicalIntentDigest: Digest;
  digest: Digest;
}

export interface OperationalFingerprint {
  algorithm: "sha256";
  specVersion: ApiVersion;
  constraintsDigest: Digest;
  authoritativeContextDigests: Digest[];
  outcomeDigest: Digest;
  policyBundleDigest: Digest;
  capabilitySetDigest: Digest;
  tenantPartitionDigest: Digest;
  privacyPartition: PrivacyPartition;
  digest: Digest;
}

export interface CompositeFingerprint {
  algorithm: "sha256";
  specVersion: ApiVersion;
  semantic: SemanticFingerprint;
  operational: OperationalFingerprint;
  cacheKey: Digest;
  digest: Digest;
}

export interface ApplicationManifest {
  contractType: "ApplicationManifest";
  apiVersion: ApiVersion;
  metadata: {
    name: string;
    version: string;
    description: string;
  };
  architecture: {
    deploymentMode: "single-process" | "modular-monolith" | "distributed";
    strata: Array<{
      id: StratumId;
      ordinal: number;
      moduleRef: string;
      dependsOn: string[];
    }>;
    planes: PlaneId[];
    externalAgentSpecifications: Array<{
      ref: string;
      digest: Digest;
      mediaType: string;
    }>;
  };
  policies: {
    policyBundleDigest: Digest;
    authorityEnforcedOutsideModel: true;
    approvalRequiredForHighRisk: boolean;
    artifactAttestationRequired: boolean;
    receiptChainRequired: boolean;
    retentionDays: number;
    defaultDataBoundary: "local" | "tenant" | "regional" | "global";
    allowedModelHosting: Array<"local" | "private-cloud" | "managed">;
  };
  capabilitySetDigest: Digest;
  conformanceProfiles: ConformanceProfile[];
}

export interface IntentEnvelope {
  contractType: "IntentEnvelope";
  apiVersion: ApiVersion;
  intentId: string;
  canonicalIntent: string;
  constraints: ScalarMap;
  ambiguity: number;
  confidence: number;
  context: Array<{
    ref: string;
    digest: Digest;
    trust: "authoritative" | "untrusted";
  }>;
  fingerprint: CompositeFingerprint;
}

export interface OutcomeContract {
  contractType: "OutcomeContract";
  apiVersion: ApiVersion;
  outcomeId: string;
  objective: string;
  acceptanceCriteria: Array<{
    id: string;
    assertion: string;
    evidenceRequired: boolean;
    evidenceRequirements: Array<{
      kind: "artifact-attestation";
      capabilityId: string;
      subjectDigest: Digest;
      evidenceRole: "observed-result" | "compensation-result";
    }>;
  }>;
  forbiddenOutcomes: string[];
  digest: Digest;
}

export interface CriterionResult {
  contractType: "CriterionResult";
  apiVersion: ApiVersion;
  resultId: string;
  runId: string;
  outcomeId: string;
  criterionId: string;
  status: "passed" | "failed" | "not-evaluated";
  summary: string;
  evidenceRefs: EvidenceRef[];
  observedAt: string;
  digest: Digest;
}

export interface ExecutionEnvelope {
  contractType: "ExecutionEnvelope";
  apiVersion: ApiVersion;
  runId: string;
  intentId: string;
  outcomeId: string;
  profile: "economy" | "balanced" | "quality" | "latency" | "privacy";
  budget: Budget;
  sla: {
    deadline: string;
    availabilityClass: "best-effort" | "standard" | "critical";
  };
  tenantPartitionDigest: Digest;
  privacyPartition: PrivacyPartition;
}

export interface AuthorityGrant {
  contractType: "AuthorityGrant";
  apiVersion: ApiVersion;
  grantId: string;
  issuer: {
    type: "human" | "identity-provider" | "service-policy";
    id: string;
  };
  subject: string;
  scopes: string[];
  resourcePatterns: string[];
  budget: Budget;
  validFrom: string;
  expiresAt: string;
  parentGrantId?: string;
  digest: Digest;
}

export interface ApprovalReceipt {
  contractType: "ApprovalReceipt";
  apiVersion: ApiVersion;
  approvalId: string;
  actionDigest: Digest;
  authorityGrantId: string;
  decision: "approved" | "rejected";
  approvedBy: {
    type: "human" | "policy-engine";
    id: string;
  };
  scope: string;
  issuedAt: string;
  expiresAt: string;
  digest: Digest;
}

export interface DelegationEnvelope {
  contractType: "DelegationEnvelope";
  apiVersion: ApiVersion;
  delegationId: string;
  parentGrantId: string;
  delegator: string;
  delegate: string;
  scopes: string[];
  resourcePatterns: string[];
  budget: Budget;
  validFrom: string;
  expiresAt: string;
  digest: Digest;
}

export interface CapabilityContract {
  contractType: "CapabilityContract";
  apiVersion: ApiVersion;
  capabilityId: string;
  version: string;
  description: string;
  riskClass: "low" | "medium" | "high" | "critical";
  effectClass: "read" | "draft" | "write" | "external" | "destructive";
  operations: Array<"prepare" | "commit" | "verify" | "compensate">;
  authorityScopes: string[];
  schemaDialect: "https://json-schema.org/draft/2020-12/schema";
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  sideEffectPolicy: {
    idempotencyRequired: boolean;
    verificationRequired: boolean;
    compensationRequired: boolean;
  };
  digest: Digest;
}

export interface DecisionEvidence {
  contractType: "DecisionEvidence";
  apiVersion: ApiVersion;
  decisionId: string;
  decisionType: "intent" | "planning" | "routing" | "delegation" | "policy" | "execution";
  summary: string;
  selectedOption: string;
  rejectedOptions: Array<{ option: string; reason: string }>;
  evidenceRefs: EvidenceRef[];
  confidence: number;
  reasoningDisclosure: "summary-only";
  createdAt: string;
  digest: Digest;
}

export interface RuntimeArtifact {
  contractType: "RuntimeArtifact";
  apiVersion: ApiVersion;
  artifactRef: string;
  mediaType: string;
  payload: JsonValue;
  digest: Digest;
}

export interface ArtifactAttestation {
  contractType: "ArtifactAttestation";
  apiVersion: ApiVersion;
  attestationId: string;
  artifactRef: string;
  artifactDigest: Digest;
  capabilityId?: string;
  subjectDigest?: Digest;
  evidenceRole?: "prepared-action" | "observed-result" | "compensation-result" | "generic";
  producer: string;
  createdAt: string;
  provenanceRefs: EvidenceRef[];
  digest: Digest;
}

export type TraceEventType =
  | "intent.accepted"
  | "outcome.bound"
  | "authority.checked"
  | "approval.recorded"
  | "delegation.created"
  | "capability.prepared"
  | "capability.committed"
  | "capability.verified"
  | "capability.compensated"
  | "decision.recorded"
  | "artifact.attested"
  | "run.completed"
  | "run.failed";

export interface TraceEvent {
  contractType: "TraceEvent";
  apiVersion: ApiVersion;
  eventId: string;
  runId: string;
  sequence: number;
  eventType: TraceEventType;
  stratum: StratumId;
  summary: string;
  attributes: ScalarMap;
  evidenceRefs: EvidenceRef[];
  occurredAt: string;
  previousDigest: Digest | null;
  digest: Digest;
}

export interface ConformanceCheck {
  id: string;
  status: "pass" | "fail" | "not-applicable";
  severity: "info" | "warning" | "error";
  message: string;
  evidenceRefs: EvidenceRef[];
}

export interface ConformanceReport {
  contractType: "ConformanceReport";
  apiVersion: ApiVersion;
  reportId: string;
  profile: ConformanceProfile;
  status: "pass" | "fail";
  runStatus: "completed" | "failed" | "incomplete";
  evaluator: {
    name: typeof EVALUATOR_NAME;
    version: typeof EVALUATOR_VERSION;
    revision: typeof EVALUATOR_REVISION;
    digest: Digest;
  };
  manifestDigest: Digest;
  runBundleDigest: Digest;
  profileConfigurationDigest: Digest;
  rulesDigest: Digest;
  generatedAt: string;
  checks: ConformanceCheck[];
  digest: Digest;
}

export interface ResourceDescriptor {
  name: string;
  digest: {
    sha256: Digest;
  };
  mediaType: string;
  uri?: string;
}

export interface RunBundleResourceDescriptor extends ResourceDescriptor {
  name: typeof EXECUTION_PASSPORT_SUBJECTS.runBundle;
  mediaType: typeof EXECUTION_PASSPORT_MEDIA_TYPES.runBundle;
}

export interface ConformanceReportResourceDescriptor extends ResourceDescriptor {
  name: typeof EXECUTION_PASSPORT_SUBJECTS.conformanceReport;
  mediaType: typeof EXECUTION_PASSPORT_MEDIA_TYPES.conformanceReport;
}

export interface OasfRecordResourceDescriptor extends ResourceDescriptor {
  name: typeof EXECUTION_PASSPORT_SUBJECTS.oasfRecord;
}

export interface ExecutionEvidenceBinding {
  role: "execution-placement";
  producer: string;
  resource: ResourceDescriptor;
  disclosure: "content-free";
}

export interface ExecutionPassportPredicate {
  apiVersion: ApiVersion;
  kind: "ExecutionPassport";
  runId: string;
  profile: ConformanceProfile;
  runStatus: ConformanceReport["runStatus"];
  conformanceStatus: ConformanceReport["status"];
  evaluatorDigest: Digest;
  terminalReceiptDigest: Digest | null;
  issuedAt: string;
  executionEvidence: ExecutionEvidenceBinding[];
}

export interface ExecutionPassport {
  _type: typeof IN_TOTO_STATEMENT_V1_TYPE;
  subject: [
    RunBundleResourceDescriptor,
    ConformanceReportResourceDescriptor,
    OasfRecordResourceDescriptor
  ];
  predicateType: typeof EXECUTION_PASSPORT_PREDICATE_TYPE;
  predicate: ExecutionPassportPredicate;
}

export interface AdapterMapping {
  contractType: "AdapterMapping";
  apiVersion: ApiVersion;
  mappingId: string;
  protocol:
    | "ag-ui"
    | "a2a"
    | "mcp"
    | "opentelemetry-genai"
    | "cloudevents"
    | "policy-engine"
    | "oasf"
    | "stagefabric";
  protocolVersion: string;
  direction: "inbound" | "outbound" | "bidirectional";
  contractBindings: Array<{
    strataContract: string;
    protocolObject: string;
    notes: string;
  }>;
  lossPolicy: "lossless" | "explicit-loss";
  extensionPoint: boolean;
}

export interface RunBundle {
  contractType: "RunBundle";
  apiVersion: ApiVersion;
  manifest: ApplicationManifest;
  intent: IntentEnvelope;
  outcome: OutcomeContract;
  execution: ExecutionEnvelope;
  budgetUsage: BudgetUsage;
  runtimeBoundaries: RuntimeBoundaryEvidence[];
  criterionResults: CriterionResult[];
  authorityGrants: AuthorityGrant[];
  approvals: ApprovalReceipt[];
  delegations: DelegationEnvelope[];
  capabilities: CapabilityContract[];
  decisions: DecisionEvidence[];
  artifacts: RuntimeArtifact[];
  attestations: ArtifactAttestation[];
  traceEvents: TraceEvent[];
}

export type ContractType =
  | ApplicationManifest["contractType"]
  | IntentEnvelope["contractType"]
  | OutcomeContract["contractType"]
  | CriterionResult["contractType"]
  | ExecutionEnvelope["contractType"]
  | BudgetUsage["contractType"]
  | RuntimeBoundaryEvidence["contractType"]
  | AuthorityGrant["contractType"]
  | ApprovalReceipt["contractType"]
  | DelegationEnvelope["contractType"]
  | CapabilityContract["contractType"]
  | DecisionEvidence["contractType"]
  | RuntimeArtifact["contractType"]
  | ArtifactAttestation["contractType"]
  | TraceEvent["contractType"]
  | ConformanceReport["contractType"]
  | AdapterMapping["contractType"]
  | RunBundle["contractType"];

export type SchemaDefinition =
  | ContractType
  | "ResourceDescriptor"
  | "ExecutionEvidenceBinding"
  | "ExecutionPassport";

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}
