import type {
  AuthorityGrant,
  Budget,
  DelegationEnvelope,
  ValidationIssue,
  ValidationResult
} from "../contracts/types.js";

const budgetKeys = ["maxSteps", "maxDurationMs", "maxCostMicros", "maxTokens"] as const;

export function budgetIsAttenuated(child: Budget, parent: Budget): boolean {
  return budgetKeys.every(
    (key) =>
      Number.isFinite(child[key]) &&
      Number.isFinite(parent[key]) &&
      child[key] >= 0 &&
      parent[key] >= 0 &&
      child[key] <= parent[key]
  );
}

function isSubset(child: string[], parent: string[]): boolean {
  const allowed = new Set(parent);
  return child.every((item) => allowed.has(item));
}

export function validateDelegation(
  delegation: DelegationEnvelope,
  parent: AuthorityGrant
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (path: string, code: string, message: string): void => {
    issues.push({ path, code, message });
  };

  if (delegation.parentGrantId !== parent.grantId) {
    add("/delegation/parentGrantId", "parent-grant", "Delegation does not reference the supplied parent grant.");
  }
  if (delegation.delegator !== parent.subject) {
    add("/delegation/delegator", "delegator", "Only the parent grant subject can attenuate this authority.");
  }
  if (!isSubset(delegation.scopes, parent.scopes)) {
    add("/delegation/scopes", "scope-attenuation", "Delegated scopes must be a subset of parent scopes.");
  }
  if (!isSubset(delegation.resourcePatterns, parent.resourcePatterns)) {
    add(
      "/delegation/resourcePatterns",
      "resource-attenuation",
      "Delegated resources must be a subset of parent resources."
    );
  }
  if (!budgetIsAttenuated(delegation.budget, parent.budget)) {
    add("/delegation/budget", "budget-attenuation", "Delegated budgets cannot exceed parent budgets.");
  }

  const childStart = Date.parse(delegation.validFrom);
  const childEnd = Date.parse(delegation.expiresAt);
  const parentStart = Date.parse(parent.validFrom);
  const parentEnd = Date.parse(parent.expiresAt);
  if (
    ![childStart, childEnd, parentStart, parentEnd].every(Number.isFinite) ||
    childStart < parentStart ||
    childEnd > parentEnd ||
    childEnd <= childStart ||
    parentEnd <= parentStart
  ) {
    add("/delegation/expiresAt", "ttl-attenuation", "Delegation validity must stay inside the parent validity window.");
  }

  return { valid: issues.length === 0, issues };
}

export function validateChildGrant(
  child: AuthorityGrant,
  parent: AuthorityGrant
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (path: string, code: string, message: string): void => {
    issues.push({ path, code, message });
  };

  if (child.parentGrantId !== parent.grantId) {
    add("/authorityGrant/parentGrantId", "parent-grant", "Child grant does not reference the supplied parent grant.");
  }
  if (child.issuer.type !== "service-policy" || child.issuer.id !== parent.subject) {
    add(
      "/authorityGrant/issuer",
      "grant-issuer",
      "An attenuated child grant must be issued by the parent subject through the service policy boundary."
    );
  }
  if (!isSubset(child.scopes, parent.scopes)) {
    add("/authorityGrant/scopes", "scope-attenuation", "Child scopes must be a subset of parent scopes.");
  }
  if (!isSubset(child.resourcePatterns, parent.resourcePatterns)) {
    add(
      "/authorityGrant/resourcePatterns",
      "resource-attenuation",
      "Child resources must be a subset of parent resources."
    );
  }
  if (!budgetIsAttenuated(child.budget, parent.budget)) {
    add("/authorityGrant/budget", "budget-attenuation", "Child budgets cannot exceed parent budgets.");
  }

  const childStart = Date.parse(child.validFrom);
  const childEnd = Date.parse(child.expiresAt);
  const parentStart = Date.parse(parent.validFrom);
  const parentEnd = Date.parse(parent.expiresAt);
  if (
    ![childStart, childEnd, parentStart, parentEnd].every(Number.isFinite) ||
    childStart < parentStart ||
    childEnd > parentEnd ||
    childEnd <= childStart ||
    parentEnd <= parentStart
  ) {
    add(
      "/authorityGrant/expiresAt",
      "ttl-attenuation",
      "Child grant validity must stay inside the parent validity window."
    );
  }

  return { valid: issues.length === 0, issues };
}
