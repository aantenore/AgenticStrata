# StageFabric interoperability golden

`execution-placement-evidence.json` was emitted with StageFabric `0.7.0-alpha.1` by its exported `sealExecutionPlacementEvidence` and `canonicalJson` functions; that producer tree is publicly reachable on `main` at commit `9c6bac4`. The successful-run contract finalized at commit `743752e`; this fixture remains byte-for-byte compatible because its only failed event is an allowed pre-output retry with status `503`. It covers that retry followed by fallback success, a second successful stage, and the minute-precision timestamp accepted by the StageFabric contract.

- Producer seal over evidence content without `digest`: `sha256:8bedc2e796afff222dbb15c35eb2f07f4dde50d97e49d669d813e06950fb0c79`
- SHA-256 over exact emitted file bytes, including trailing LF: `aa0d03a6af7b6e5e03afd1d43530077578d8e67cba58295f7d86c88bd2fad632`

The AgenticStrata tests must consume these bytes without rebuilding the fixture through AgenticStrata helpers. They also reject terminal failure reasons, retry statuses outside `429`, `502`, `503`, and `504`, a retry without `statusCode`, and a completed event with `statusCode`. Regenerate the fixture from StageFabric when its evidence contract changes.
