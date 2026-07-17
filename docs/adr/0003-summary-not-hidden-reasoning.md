# ADR 0003: Decision summaries, not hidden reasoning

Status: accepted

## Context

Operators need to understand selected actions and evidence. Persisting private model reasoning is neither required for operational explainability nor appropriate as a stable contract.

## Decision

`DecisionEvidence` stores a concise summary, selected option, rejected alternatives with short reasons, confidence, and resolvable evidence references. The only supported disclosure mode is `summary-only`.

## Consequences

- Explanations remain useful to technical and non-technical reviewers.
- Telemetry avoids a fragile and sensitive internal representation.
- Applications must generate summaries that do not contain secrets or personal data.
