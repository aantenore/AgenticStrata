import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname } from "node:path";

import { parse } from "yaml";

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
  return extension === ".yaml" || extension === ".yml"
    ? parse(source, { maxAliasCount: 100, strict: true })
    : (JSON.parse(source) as unknown);
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}
