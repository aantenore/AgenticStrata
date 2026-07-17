# Negative fixtures

`tampered-receipt.patch.json` is an RFC 6902-style mutation description for the generated reference bundle. Applying it without recomputing the receipt and every following link must make `replay` and core conformance fail.

The automated suite performs this and additional mutations in memory: expanded delegation, detached approval, budget overrun, missing attestation, duplicate identifiers, mixed run ids, and unsafe cache partitions.
