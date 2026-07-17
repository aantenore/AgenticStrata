import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname } from "node:path";

import { parse, parseDocument } from "yaml";

import { canonicalize } from "../core/canonical.js";

export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

export function readDocument(path: string): unknown {
  const metadata = statSync(path);
  if (!metadata.isFile()) {
    throw new Error("Contract input must be a regular file.");
  }
  if (metadata.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`Contract input exceeds the ${MAX_DOCUMENT_BYTES}-byte limit.`);
  }
  const source = readFileSync(path, "utf8");
  const extension = extname(path).toLowerCase();
  if (extension === ".yaml" || extension === ".yml") {
    const value = parse(source, { maxAliasCount: 100, strict: true }) as unknown;
    canonicalize(value);
    return value;
  }

  const value = JSON.parse(source) as unknown;
  const duplicateCheck = parseDocument(source, {
    schema: "json",
    strict: true,
    uniqueKeys: true
  });
  if (duplicateCheck.errors.some((error) => error.code === "DUPLICATE_KEY")) {
    throw new SyntaxError("JSON input must use unique object member names.");
  }
  if (duplicateCheck.errors.length > 0) {
    throw new SyntaxError("JSON input is not valid strict JSON.");
  }
  canonicalize(value);
  return value;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}
