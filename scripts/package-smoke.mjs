import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const project = resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(join(tmpdir(), "agentic-strata-consumer-"));

function run(command, args, cwd = project) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

try {
  const packed = JSON.parse(
    run("npm", ["pack", "--json", "--pack-destination", temporary])
  );
  const filename = packed[0]?.filename;
  if (typeof filename !== "string") {
    throw new Error("npm pack did not report an archive filename.");
  }

  writeFileSync(
    join(temporary, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
    "utf8"
  );
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(temporary, filename)],
    temporary
  );

  const probe = [
    'import { runConformance, runDemo } from "agentic-strata";',
    'const result = runDemo();',
    'const report = runConformance(result.bundle, "enterprise");',
    'if (report.status !== "pass" || result.readBack !== true) process.exit(2);',
    'console.log(JSON.stringify({ status: report.status, readBack: result.readBack }));'
  ].join("\n");
  const output = run(process.execPath, ["--input-type=module", "--eval", probe], temporary);
  process.stdout.write(output);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
