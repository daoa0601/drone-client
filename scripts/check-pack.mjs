import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceManifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const temporary = await mkdtemp(path.join(os.tmpdir(), "drone-client-pack-"));

function run(command, arguments_, options = {}) {
  return execFileSync(command, arguments_, {
    cwd: options.cwd ?? packageRoot,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
}

try {
  run("pnpm", ["pack", "--pack-destination", temporary]);
  const archives = (await readdir(temporary)).filter((entry) => entry.endsWith(".tgz"));
  if (archives.length !== 1) throw new Error("Expected exactly one packed archive.");
  const archive = path.join(temporary, archives[0]);
  const entries = run("tar", ["-tzf", archive]).trim().split("\n");
  for (const required of [
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/dist/index.js",
    "package/dist/index.d.ts",
  ]) {
    if (!entries.includes(required)) throw new Error(`Packed archive is missing ${required}.`);
  }
  for (const forbidden of ["package/src/", "package/tests/", "package/node_modules/"]) {
    if (entries.some((entry) => entry.startsWith(forbidden))) {
      throw new Error(`Packed archive unexpectedly contains ${forbidden}.`);
    }
  }

  const consumer = path.join(temporary, "consumer");
  await writeFile(
    path.join(temporary, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", archive], {
    cwd: temporary,
  });
  await writeFile(
    `${consumer}.mjs`,
    [
      'import { DroneClient, DroneClientError } from "@agentic-orch/drone-client";',
      'if (typeof DroneClient !== "function" || typeof DroneClientError !== "function") {',
      '  throw new Error("Packed runtime exports are unavailable.");',
      "}",
      'new DroneClient({ baseUrl: "http://127.0.0.1:8090" });',
      "",
    ].join("\n"),
  );
  run("node", [`${consumer}.mjs`], { cwd: temporary, stdio: "inherit" });

  await writeFile(
    `${consumer}.ts`,
    [
      'import { DroneClient, type DroneJobSubmission } from "@agentic-orch/drone-client";',
      "const submission: DroneJobSubmission = {",
      '  schema_version: "1",',
      '  operation_id: "test.inspect",',
      '  provider_attestation_id: `attestation.sha256.${"b".repeat(64)}`,',
      '  inputs: { sample: `sha256_${"a".repeat(64)}` },',
      "};",
      'const client = new DroneClient({ baseUrl: "http://127.0.0.1:8090" });',
      "void client.submitJob(submission);",
      "",
    ].join("\n"),
  );
  run(
    path.join(packageRoot, "node_modules", ".bin", "tsc"),
    [
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--target",
      "ES2023",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--lib",
      "ES2023,DOM,DOM.Iterable",
      `${consumer}.ts`,
    ],
    { cwd: temporary },
  );

  const installedManifest = JSON.parse(
    await readFile(
      path.join(temporary, "node_modules", "@agentic-orch", "drone-client", "package.json"),
      "utf8",
    ),
  );
  if (
    installedManifest.name !== "@agentic-orch/drone-client" ||
    installedManifest.version !== sourceManifest.version ||
    installedManifest.private !== true ||
    installedManifest.publishConfig !== undefined
  ) {
    throw new Error("Packed manifest must remain a private local workspace package.");
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
