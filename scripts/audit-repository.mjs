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
  const metadata = git([
    "log",
    "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%s",
    "--all"
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
}

console.log(
  JSON.stringify(
    {
      filesScanned: files.length,
      historyScanned: hasHistory,
      canonicalIdentity: `${canonicalName} <${canonicalEmail}>`
    },
    null,
    2
  )
);
