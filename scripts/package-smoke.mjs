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
    'import { createExecutionPassport, runConformance, runDemo, validateDocument } from "agentic-strata";',
    'const result = runDemo();',
    'const report = runConformance(result.bundle, "enterprise");',
    'const passport = createExecutionPassport({ bundle: result.bundle, report, oasfRecord: { opaqueExternalRecord: true }, oasfMediaType: "application/json" });',
    'if (report.status !== "pass" || report.runStatus !== "completed" || result.readBack !== true || !validateDocument(passport).valid || passport.subject.length !== 3) process.exit(2);',
    'console.log(JSON.stringify({ status: report.status, runStatus: report.runStatus, readBack: result.readBack, passport: "pass" }));'
  ].join("\n");
  const output = run(process.execPath, ["--input-type=module", "--eval", probe], temporary);
  process.stdout.write(output);

  const executable = join(
    temporary,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "agentic-strata.cmd" : "agentic-strata"
  );
  const version = run(executable, ["--version"], temporary).trim();
  if (version !== "0.2.0-alpha.1") {
    throw new Error(`Installed CLI reported unexpected version: ${version}`);
  }
  const cliOutput = join(temporary, "cli-demo");
  run(executable, ["demo", "--output", cliOutput, "--profile", "enterprise"], temporary);
  run(executable, ["validate", join(cliOutput, "run.bundle.json")], temporary);
  const oasfRecord = join(temporary, "external-oasf.json");
  const passportOutput = join(temporary, "execution-passport.json");
  writeFileSync(oasfRecord, '{"opaqueExternalRecord":true}\n', "utf8");
  run(
    executable,
    [
      "passport",
      join(cliOutput, "run.bundle.json"),
      "--report",
      join(cliOutput, "conformance-report.json"),
      "--oasf-record",
      oasfRecord,
      "--oasf-media-type",
      "application/json",
      "--issued-at",
      "2026-07-17T12:00:01.000Z",
      "--output",
      passportOutput
    ],
    temporary
  );
  run(executable, ["validate", passportOutput], temporary);
  console.log(
    JSON.stringify({ cliVersion: version, cliDemo: "pass", cliPassport: "pass" })
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
