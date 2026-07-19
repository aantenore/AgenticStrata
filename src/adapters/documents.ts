import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname } from "node:path";
import { TextDecoder } from "node:util";

import { parse, parseDocument } from "yaml";

import { canonicalize } from "../core/canonical.js";

export const MAX_DOCUMENT_BYTES = 16 * 1024 * 1024;

export function readResourceBytes(path: string): Uint8Array {
  const metadata = statSync(path);
  if (!metadata.isFile()) {
    throw new Error("Input must be a regular file.");
  }
  if (metadata.size > MAX_DOCUMENT_BYTES) {
    throw new Error(`Input exceeds the ${MAX_DOCUMENT_BYTES}-byte limit.`);
  }
  const bytes = readFileSync(path);
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw new Error(`Input exceeds the ${MAX_DOCUMENT_BYTES}-byte limit.`);
  }
  return bytes;
}

function readSource(path: string): string {
  const bytes = readResourceBytes(path);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SyntaxError("Contract input must be valid UTF-8.");
  }
}

function parseStrictJson(source: string): unknown {
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

export interface JsonDocumentWithSource {
  document: unknown;
  source: string;
}

export function readJsonDocumentWithSource(path: string): JsonDocumentWithSource {
  const extension = extname(path).toLowerCase();
  if (extension === ".yaml" || extension === ".yml") {
    throw new Error("This input must be a JSON file.");
  }
  const source = readSource(path);
  return { document: parseStrictJson(source), source };
}

export function readDocument(path: string): unknown {
  const source = readSource(path);
  const extension = extname(path).toLowerCase();
  if (extension === ".yaml" || extension === ".yml") {
    const value = parse(source, { maxAliasCount: 100, strict: true }) as unknown;
    canonicalize(value);
    return value;
  }
  return parseStrictJson(source);
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeCanonicalJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canonicalize(value), "utf8");
}

export function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}
