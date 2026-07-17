import { createHash } from "node:crypto";

import type { Digest } from "../contracts/types.js";

function normalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Only finite numbers can be canonicalized.");
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalize(item));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    for (const [key, item] of entries) {
      result[key] = normalize(item);
    }
    return result;
  }

  throw new TypeError(`Unsupported canonical value: ${typeof value}`);
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function digestValue(value: unknown): Digest {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export function omitDigest<T extends object>(value: T): Omit<T, "digest"> {
  const unsigned = { ...value };
  Reflect.deleteProperty(unsigned, "digest");
  return unsigned;
}

export function seal<T extends object>(value: T): T & { digest: Digest } {
  return { ...value, digest: digestValue(value) };
}

export function verifySeal<T extends object & { digest: Digest }>(value: T): boolean {
  return digestValue(omitDigest(value)) === value.digest;
}
