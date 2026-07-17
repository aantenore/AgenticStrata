# Contributing

## Development gate

Use Node.js 22 or newer and start from a clean branch.

```bash
npm ci
npm run release:check
```

Changes should be atomic and explain the contract or invariant they alter. A schema change must update TypeScript types, registry coverage, documentation, examples, and adversarial tests in the same series.

## Design expectations

- Keep core contracts provider-neutral and configuration-driven.
- Prefer mapping adapters over protocol SDK dependencies in core.
- Treat model and retrieved output as untrusted data.
- Put authorization and mechanical invariants in deterministic runtime code.
- Record concise decision summaries and evidence references, never private reasoning.
- State residual risks and unsupported claims directly.

Use `Antonio Antenore <ant_ant95@hotmail.it>` for repository commits so publication maps to the personal account.
