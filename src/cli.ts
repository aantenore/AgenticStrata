#!/usr/bin/env node
import { resolve } from "node:path";

import { Command, InvalidArgumentError } from "commander";

import { readDocument, writeJson, writeText } from "./adapters/documents.js";
import { validateAs, validateDocument } from "./contracts/registry.js";
import { CONFORMANCE_PROFILES } from "./contracts/types.js";
import type {
  ApplicationManifest,
  ConformanceProfile,
  RunBundle,
  ValidationResult
} from "./contracts/types.js";
import { loadProfileConfiguration } from "./conformance/config.js";
import { reportIssues, runConformance } from "./conformance/engine.js";
import { lintManifest } from "./conformance/manifest.js";
import { runDemo } from "./demo/demo.js";
import { explainRun } from "./core/explain.js";
import { evidenceIndex, verifyTraceChain } from "./core/receipts.js";

function printValidation(result: ValidationResult): void {
  if (result.valid) {
    console.log("valid");
    return;
  }
  for (const issue of result.issues) {
    console.error(`${issue.code} ${issue.path}: ${issue.message}`);
  }
  process.exitCode = 2;
}

function parseProfile(value: string): ConformanceProfile {
  if (!(CONFORMANCE_PROFILES as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`Profile must be one of: ${CONFORMANCE_PROFILES.join(", ")}.`);
  }
  return value as ConformanceProfile;
}

function requireBundle(path: string): RunBundle {
  const document = readDocument(path);
  const validation = validateAs("RunBundle", document);
  if (!validation.valid) {
    printValidation(validation);
    throw new Error("The input is not a valid RunBundle.");
  }
  return document as RunBundle;
}

const program = new Command()
  .name("agentic-strata")
  .description("Validate and explain executable AgenticStrata contracts.")
  .version("0.1.0-alpha.1");

program
  .command("validate")
  .description("Validate one JSON or YAML contract against the language-neutral schema.")
  .argument("<file>")
  .action((file: string) => {
    printValidation(validateDocument(readDocument(resolve(file))));
  });

program
  .command("lint")
  .description("Check stratum completeness, ordinals, planes, and dependency direction.")
  .argument("<manifest>")
  .action((file: string) => {
    const document = readDocument(resolve(file));
    const schema = validateAs("ApplicationManifest", document);
    if (!schema.valid) {
      printValidation(schema);
      return;
    }
    printValidation(lintManifest(document as ApplicationManifest));
  });

program
  .command("conformance")
  .description("Evaluate a manifest plus real runtime artifacts and receipt chain.")
  .argument("<bundle>")
  .option("-p, --profile <profile>", "conformance profile", parseProfile, "enterprise")
  .option("--profiles <file>", "replace the packaged profile configuration")
  .option("-o, --output <file>", "write the report as JSON")
  .action(
    (
      file: string,
      options: { profile: ConformanceProfile; profiles?: string; output?: string }
    ) => {
      const bundle = requireBundle(resolve(file));
      const configuration = loadProfileConfiguration(
        options.profiles === undefined ? undefined : resolve(options.profiles)
      );
      const report = runConformance(bundle, options.profile, { configuration });
      console.log(JSON.stringify(report, null, 2));
      if (options.output !== undefined) {
        writeJson(resolve(options.output), report);
      }
      if (report.status === "fail") {
        printValidation({ valid: false, issues: reportIssues(report) });
      }
    }
  );

program
  .command("replay")
  .description("Replay the hash-linked runtime receipt chain and detect tampering or missing evidence.")
  .argument("<bundle>")
  .action((file: string) => {
    const bundle = requireBundle(resolve(file));
    const report = verifyTraceChain(bundle.traceEvents, evidenceIndex(bundle));
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) {
      process.exitCode = 2;
    }
  });

program
  .command("explain")
  .description("Render a human-readable account of request, decisions, authority, effects, and evidence.")
  .argument("<bundle>")
  .option("-p, --profile <profile>", "conformance profile", parseProfile, "enterprise")
  .action((file: string, options: { profile: ConformanceProfile }) => {
    const bundle = requireBundle(resolve(file));
    console.log(explainRun(bundle, runConformance(bundle, options.profile)));
  });

program
  .command("demo")
  .description("Execute a neutral prepare/commit/read-back workflow with approval and evidence.")
  .option("-o, --output <directory>", "artifact directory", ".tmp/agentic-strata-demo")
  .option("-p, --profile <profile>", "conformance profile", parseProfile, "enterprise")
  .action((options: { output: string; profile: ConformanceProfile }) => {
    const result = runDemo();
    const report = runConformance(result.bundle, options.profile, {
      generatedAt: "2026-07-17T12:00:00.000Z"
    });
    const output = resolve(options.output);
    const explanation = explainRun(result.bundle, report);
    writeJson(`${output}/run.bundle.json`, result.bundle);
    writeJson(`${output}/conformance-report.json`, report);
    writeText(`${output}/explanation.md`, explanation);
    console.log(explanation);
    if (report.status === "fail" || !result.duplicateWasSuppressed) {
      process.exitCode = 2;
    }
  });

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
