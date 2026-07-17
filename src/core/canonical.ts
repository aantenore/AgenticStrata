import { createHash } from "node:crypto";

import serialize from "canonicalize";

import type { Digest } from "../contracts/types.js";

function assertIJson(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("RFC 8785 canonicalization accepts only finite JSON numbers.");
    }
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`RFC 8785 canonicalization does not support ${typeof value}.`);
  }
  if (seen.has(value)) {
    throw new TypeError("RFC 8785 canonicalization does not support cyclic values.");
  }
  seen.add(value);
  const values = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>);
  for (const item of values) {
    assertIJson(item, seen);
  }
  seen.delete(value);
}

export function canonicalize(value: unknown): string {
  assertIJson(value);
  const result = serialize(value);
  if (result === undefined) {
    throw new TypeError("RFC 8785 canonicalization did not produce a JSON value.");
  }
  return result;
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
