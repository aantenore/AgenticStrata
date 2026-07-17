import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const canonicalName = "Antonio Antenore";
const canonicalEmail = "ant_ant95@hotmail.it";
const blockedFragments = [
  ["re", "ply"].join(""),
  ["users", ".invalid"].join(""),
  ["aantenore", "re", "ply"].join(""),
  ["no", "re", "ply"].join("")
];
const configuredHistoryRef = process.env.AGENTIC_STRATA_AUDIT_HISTORY_REF?.trim() ?? "";

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

function assertClean(label, value) {
  const normalized = value.toLowerCase();
  const found = blockedFragments.find((fragment) => normalized.includes(fragment));
  if (found !== undefined) {
    throw new Error(`${label} contains a blocked identity fragment.`);
  }
}

const files = git(["ls-files", "--cached", "--others", "--exclude-standard"])
  .split("\n")
  .filter(Boolean);

for (const path of files) {
  assertClean(`path ${path}`, path);
  const content = readFileSync(path);
  if (!content.includes(0)) {
    assertClean(`file ${path}`, content.toString("utf8"));
  }
}

let hasHistory = true;
try {
  git(["rev-parse", "--verify", "HEAD"]);
} catch {
  hasHistory = false;
}

if (hasHistory) {
  const historyRevision = configuredHistoryRef === "" ? ["--all"] : [configuredHistoryRef];
  if (configuredHistoryRef !== "") {
    if (!/^[a-f0-9]{40,64}$/i.test(configuredHistoryRef)) {
      throw new Error("Configured audit history ref must be a full commit object id.");
    }
    try {
      git(["cat-file", "-e", `${configuredHistoryRef}^{commit}`]);
    } catch {
      throw new Error("Configured audit history ref is not an available commit.");
    }
  }
  const metadata = git([
    "log",
    "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%s",
    ...historyRevision
  ]);
  assertClean("reachable commit metadata", metadata);
  for (const row of metadata.split("\n").filter(Boolean)) {
    const [sha, authorName, authorEmail, committerName, committerEmail] = row.split("\0");
    if (
      authorName !== canonicalName ||
      authorEmail !== canonicalEmail ||
      committerName !== canonicalName ||
      committerEmail !== canonicalEmail
    ) {
      throw new Error(`Commit ${sha ?? "unknown"} does not use the canonical personal identity.`);
    }
  }

  const tags = git([
    "for-each-ref",
    "--format=%(refname)%00%(taggername)%00%(taggeremail)%00%(subject)",
    "refs/tags"
  ]);
  assertClean("tag metadata", tags);
  for (const row of tags.split("\n").filter(Boolean)) {
    const [ref, taggerName, rawTaggerEmail] = row.split("\0");
    if (taggerName === "" && rawTaggerEmail === "") continue;
    const taggerEmail = rawTaggerEmail?.replace(/^<|>$/g, "");
    if (taggerName !== canonicalName || taggerEmail !== canonicalEmail) {
      throw new Error(`Tag ${ref ?? "unknown"} does not use the canonical personal identity.`);
    }
  }

  const reachableObjects = git(["rev-list", "--objects", ...historyRevision])
    .split("\n")
    .filter(Boolean);
  const visited = new Set();
  for (const row of reachableObjects) {
    const separator = row.indexOf(" ");
    const objectId = separator === -1 ? row : row.slice(0, separator);
    const path = separator === -1 ? "" : row.slice(separator + 1);
    if (path !== "") {
      assertClean(`historical path ${path}`, path);
    }
    if (visited.has(objectId) || git(["cat-file", "-t", objectId]).trim() !== "blob") {
      continue;
    }
    visited.add(objectId);
    const size = Number.parseInt(git(["cat-file", "-s", objectId]).trim(), 10);
    if (!Number.isSafeInteger(size) || size > 16 * 1024 * 1024) {
      continue;
    }
    const content = git(["cat-file", "blob", objectId], { encoding: "buffer" });
    if (!content.includes(0)) {
      assertClean(`historical blob ${objectId}`, content.toString("utf8"));
    }
  }
}

console.log(
  JSON.stringify(
    {
      filesScanned: files.length,
      historyScanned: hasHistory,
      historyScope: configuredHistoryRef === "" ? "all refs" : configuredHistoryRef,
      historyBlobsScanned: hasHistory ? "all reachable text blobs up to 16 MiB" : "none",
      canonicalIdentity: `${canonicalName} <${canonicalEmail}>`
    },
    null,
    2
  )
);
