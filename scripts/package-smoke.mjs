import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
    'import { createExecutionPassport, createStageFabricExecutionEvidenceBinding, digestValue, runConformance, runDemo, validateDocument } from "agentic-strata";',
    'const result = runDemo();',
    'const report = runConformance(result.bundle, "enterprise");',
    'const sha256 = (value) => `sha256:${digestValue(value)}`;',
    'const identity = { stageIdDigest: sha256("stage"), targetIdDigest: sha256("target"), zoneDigest: sha256("zone"), adapterKindDigest: sha256("adapter") };',
    'const unsigned = { apiVersion: "stagefabric.dev/v1alpha1", kind: "ExecutionPlacementEvidence", producer: "stagefabric", disclosure: "content-free", authority: "observation-only", runIdDigest: sha256(result.bundle.execution.runId), observedAt: "2026-07-17T12:00:00.000Z", planDigest: sha256("plan"), bindingDigest: sha256("binding"), snapshotDigest: sha256("snapshot"), egressDigest: sha256("egress"), placements: [{ ...identity, attempt: 2, status: "succeeded", reasonCode: "completed" }], trace: [{ ...identity, attempt: 1, status: "failed", reasonCode: "retryable_pre_output_status", statusCode: 503 }, { ...identity, attempt: 2, status: "succeeded", reasonCode: "completed" }] };',
    'const executionEvidence = createStageFabricExecutionEvidenceBinding({ ...unsigned, digest: sha256(unsigned) });',
    'const passport = createExecutionPassport({ bundle: result.bundle, report, oasfRecord: { opaqueExternalRecord: true }, oasfMediaType: "application/json", executionEvidence: [executionEvidence] });',
    'if (report.status !== "pass" || report.runStatus !== "completed" || result.readBack !== true || !validateDocument(passport).valid || passport.subject.length !== 3 || passport.predicate.executionEvidence.length !== 1) process.exit(2);',
    'console.log(JSON.stringify({ status: report.status, runStatus: report.runStatus, readBack: result.readBack, stageFabricAdapter: "pass", passport: "pass" }));'
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
  if (version !== "0.3.0-alpha.1") {
    throw new Error(`Installed CLI reported unexpected version: ${version}`);
  }
  const cliOutput = join(temporary, "cli-demo");
  run(executable, ["demo", "--output", cliOutput, "--profile", "enterprise"], temporary);
  run(executable, ["validate", join(cliOutput, "run.bundle.json")], temporary);
  const installed = await import(
    pathToFileURL(
      join(temporary, "node_modules", "agentic-strata", "dist", "index.js")
    ).href
  );
  const oasfRecord = join(temporary, "external-oasf.json");
  const stageFabricEvidence = join(temporary, "stagefabric-evidence.json");
  const stageFabricBinding = join(temporary, "stagefabric-binding.json");
  const passportOutput = join(temporary, "execution-passport.json");
  writeFileSync(oasfRecord, '{"opaqueExternalRecord":true}\n', "utf8");
  const sha256 = (value) => `sha256:${installed.digestValue(value)}`;
  const identity = {
    stageIdDigest: sha256("stage"),
    targetIdDigest: sha256("target"),
    zoneDigest: sha256("zone"),
    adapterKindDigest: sha256("adapter")
  };
  const unsignedEvidence = {
    apiVersion: "stagefabric.dev/v1alpha1",
    kind: "ExecutionPlacementEvidence",
    producer: "stagefabric",
    disclosure: "content-free",
    authority: "observation-only",
    runIdDigest: sha256("run-change-demo-001"),
    observedAt: "2026-07-17T12:00:00.000Z",
    planDigest: sha256("plan"),
    bindingDigest: sha256("binding"),
    snapshotDigest: sha256("snapshot"),
    egressDigest: sha256("egress"),
    placements: [
      { ...identity, attempt: 2, status: "succeeded", reasonCode: "completed" }
    ],
    trace: [
      {
        ...identity,
        attempt: 1,
        status: "failed",
        reasonCode: "retryable_pre_output_status",
        statusCode: 503
      },
      {
        ...identity,
        attempt: 2,
        status: "succeeded",
        reasonCode: "completed"
      }
    ]
  };
  const sealedEvidence = {
    ...unsignedEvidence,
    digest: sha256(unsignedEvidence)
  };
  writeFileSync(
    stageFabricEvidence,
    installed.serializeStageFabricExecutionPlacementEvidence(sealedEvidence),
    "utf8"
  );
  run(
    executable,
    [
      "bind-stagefabric",
      stageFabricEvidence,
      "--uri",
      "urn:stagefabric:evidence:package-smoke",
      "--output",
      stageFabricBinding
    ],
    temporary
  );
  run(executable, ["validate", stageFabricBinding], temporary);
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
      "--execution-evidence",
      stageFabricBinding,
      "--issued-at",
      "2026-07-17T12:00:01.000Z",
      "--output",
      passportOutput
    ],
    temporary
  );
  run(executable, ["validate", passportOutput], temporary);
  const verification = JSON.parse(
    run(
      executable,
      [
        "verify-passport",
        passportOutput,
        "--bundle",
        join(cliOutput, "run.bundle.json"),
        "--report",
        join(cliOutput, "conformance-report.json"),
        "--oasf-record",
        oasfRecord,
        "--execution-evidence-resource",
        stageFabricEvidence
      ],
      temporary
    )
  );
  if (
    verification.valid !== true ||
    verification.verifiedSubjects !== 3 ||
    verification.verifiedExecutionEvidenceResources !== 1
  ) {
    throw new Error("Installed CLI did not verify the complete Passport artifact set.");
  }
  console.log(
    JSON.stringify({
      cliVersion: version,
      cliDemo: "pass",
      cliStageFabricBinding: "pass",
      cliPassport: "pass",
      cliPassportVerification: "pass"
    })
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
