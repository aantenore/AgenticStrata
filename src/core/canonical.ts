import { createHash } from "node:crypto";

import serialize from "canonicalize";

import type { Digest } from "../contracts/types.js";

function assertUnicodeScalar(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("RFC 8785 canonicalization rejects lone Unicode surrogates.");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("RFC 8785 canonicalization rejects lone Unicode surrogates.");
    }
  }
}

function assertIJson(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === "boolean") {
    return;
  }
  if (typeof value === "string") {
    assertUnicodeScalar(value);
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
  if (Array.isArray(value)) {
    for (const item of value) {
      assertIJson(item, seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("RFC 8785 canonicalization accepts only JSON objects and arrays.");
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      assertUnicodeScalar(key);
      assertIJson(item, seen);
    }
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
