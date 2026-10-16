import { invalidRequest, invalidResponse } from "./errors.js";

export const DRONE_PROTOCOL_VERSION = "1" as const;
export const APPLE_NATIVE_PROVIDER_ID = "apple_native" as const;
export const APPLE_NATIVE_ATTESTATION_PROFILE = "apple_native_no_network_vm_v1" as const;

const MIB = 1024 * 1024;

/** Frozen public Drone v1 wire-contract limits. The Drone server enforces these same values. */
export const DRONE_V1_LIMITS = Object.freeze({
  maxProviders: 16,
  maxOperations: 128,
  maxJobs: 100,
  maxSlots: 16,
  maxMediaTypesPerInput: 16,
  maxArtifactBytes: 1024 * MIB,
  maxOperationOutputBytes: 256 * MIB,
  minCpus: 1,
  maxCpus: 16,
  minMemoryMb: 128,
  maxMemoryMb: 65_536,
  minRootfsMb: 128,
  maxRootfsMb: 65_536,
  minWritableMb: 16,
  maxWritableMb: 16_384,
  minOutputDiskMb: 16,
  maxOutputDiskMb: 4096,
  minTimeoutSeconds: 1,
  maxTimeoutSeconds: 3600,
  minLogBytes: 1024,
  maxLogBytes: 1024 * 1024,
  minProcesses: 1,
  maxProcesses: 1024,
  minOpenFiles: 16,
  maxOpenFiles: 4096,
  minExitCode: 0,
  maxExitCode: 255,
} as const);

export type DroneJobStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";

export interface DroneOperationInputSlot {
  readonly name: string;
  readonly required: boolean;
  readonly max_bytes: number;
  readonly media_types: ReadonlyArray<string>;
}

export interface DroneOperationOutput {
  readonly name: string;
  readonly required: boolean;
  readonly max_bytes: number;
  readonly media_type: string;
}

export interface DroneOperationResources {
  readonly cpus: number;
  readonly memory_mb: number;
  readonly rootfs_mb: number;
  readonly writable_mb: number;
  readonly output_disk_mb: number;
  readonly timeout_seconds: number;
  readonly max_log_bytes: number;
  readonly max_processes: number;
  readonly max_open_files: number;
}

export interface DronePublicOperation {
  readonly operation_id: string;
  readonly enabled: boolean;
  readonly provider: string;
  readonly architecture: "arm64" | "amd64";
  readonly network: "none";
  readonly inputs: ReadonlyArray<DroneOperationInputSlot>;
  readonly outputs: ReadonlyArray<DroneOperationOutput>;
  readonly resources: DroneOperationResources;
}

export interface DroneJobSubmission {
  readonly schema_version: "1";
  readonly operation_id: string;
  readonly provider_attestation_id: string;
  readonly inputs: Readonly<Record<string, string>>;
}

export interface DroneArtifactMetadata {
  readonly schema_version: "1";
  readonly artifact_id: string;
  readonly sha256: string;
  readonly size_bytes: number;
  readonly media_type: string;
  readonly created_at: string;
}

export interface DroneJobOutputArtifact {
  readonly name: string;
  readonly artifact_id: string;
  readonly size_bytes: number;
  readonly media_type: string;
}

export interface DroneJob {
  readonly schema_version: "1";
  readonly job_id: string;
  readonly operation_id: string;
  readonly provider_id: string;
  readonly provider_attestation_id: string;
  readonly status: DroneJobStatus;
  readonly inputs: Readonly<Record<string, string>>;
  readonly outputs: ReadonlyArray<DroneJobOutputArtifact>;
  readonly submitted_at: string;
  readonly started_at?: string;
  readonly finished_at?: string;
  readonly exit_code?: number;
  readonly timed_out?: boolean;
  readonly stdout_artifact_id?: string;
  readonly stderr_artifact_id?: string;
  readonly execution_attestation_artifact_id?: string;
  readonly error_code?: string;
}

export interface DroneProviderAttestationSummary {
  readonly attestation_id: string;
  readonly profile: typeof APPLE_NATIVE_ATTESTATION_PROFILE;
  readonly key_id: string;
  readonly issuer: string;
  readonly issued_at: string;
  readonly expires_at: string;
}

export interface DroneProviderStatus {
  readonly provider_id: string;
  readonly product: string;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly mutations_available: boolean;
  readonly attested: boolean;
  readonly attestation?: DroneProviderAttestationSummary;
  readonly reason: string;
  readonly isolation: "lightweight_vm";
  readonly guest_os: ReadonlyArray<"linux">;
  readonly network_modes: ReadonlyArray<"none">;
}

export interface DroneExecutionAttestation {
  readonly schema_version: "1";
  readonly profile: typeof APPLE_NATIVE_ATTESTATION_PROFILE;
  readonly provider_attestation_id: string;
  readonly challenge: string;
  readonly container_id: string;
  readonly image_reference: string;
  readonly backend: "apple_containerization";
  readonly isolation: "lightweight_vm";
  readonly guest_os: "linux";
  readonly network_mode: "none";
  readonly ephemeral_vm: true;
  readonly read_only_root: true;
  readonly input_disk_read_only: true;
  readonly output_disk_bounded: true;
  readonly host_directory_sharing: false;
  readonly socket_sharing: false;
  readonly nested_virtualization: false;
  readonly non_root_required: true;
  readonly no_new_privileges: true;
  readonly capabilities: "none";
}

const SAFE_ID = /^[a-z][a-z0-9_.-]{0,127}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9_.-]{0,63}$/u;
const SAFE_SLOT = /^[a-z][a-z0-9_-]{0,63}$/u;
const ARTIFACT_ID = /^sha256_[a-f0-9]{64}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const JOB_ID = /^job_[a-f0-9]{32}$/u;
const ATTESTATION_ID = /^attestation\.sha256\.[a-f0-9]{64}$/u;
const ATTESTATION_KEY_ID = /^ed25519\.sha256\.[a-f0-9]{64}$/u;
const ATTESTATION_CHALLENGE = /^[a-f0-9]{64}$/u;
const CONTAINER_ID = /^drone-[a-f0-9]{24}$/u;
const IMAGE_DIGEST =
  /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?\/)?[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/u;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const JOB_STATUSES = new Set<DroneJobStatus>([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);

type UnknownRecord = Readonly<Record<string, unknown>>;

function object(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidResponse(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, expected: ReadonlyArray<string>, label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(allowed)) {
    throw invalidResponse(`${label} does not match its strict schema.`);
  }
}

function string(value: unknown, label: string, maximum = 2048): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw invalidResponse(`${label} must be a non-empty bounded string.`);
  }
  return value;
}

function containsControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw invalidResponse(`${label} must be a boolean.`);
  return value;
}

function integer(
  value: unknown,
  label: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalidResponse(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value as number;
}

function safeId(value: unknown, label: string): string {
  const decoded = string(value, label, 128);
  if (!SAFE_ID.test(decoded)) throw invalidResponse(`${label} is invalid.`);
  return decoded;
}

function providerId(value: unknown, label: string): string {
  const decoded = string(value, label, 64);
  if (!PROVIDER_ID.test(decoded)) throw invalidResponse(`${label} is invalid.`);
  return decoded;
}

function safeSlot(value: unknown, label: string): string {
  const decoded = string(value, label, 64);
  if (!SAFE_SLOT.test(decoded)) throw invalidResponse(`${label} is invalid.`);
  return decoded;
}

function artifactId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ARTIFACT_ID.test(value)) {
    throw invalidResponse(`${label} is not a content-addressed artifact ID.`);
  }
  return value;
}

function attestationId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ATTESTATION_ID.test(value)) {
    throw invalidResponse(`${label} is not a provider attestation ID.`);
  }
  return value;
}

function attestationKeyId(value: unknown, label: string): string {
  if (typeof value !== "string" || !ATTESTATION_KEY_ID.test(value)) {
    throw invalidResponse(`${label} is not an Ed25519 attestation key ID.`);
  }
  return value;
}

function mediaType(value: unknown, label: string): string {
  const decoded = string(value, label, 129);
  if (!MEDIA_TYPE.test(decoded)) throw invalidResponse(`${label} is invalid.`);
  return decoded;
}

function timestamp(value: unknown, label: string): string {
  const decoded = string(value, label, 64);
  if (!UTC_TIMESTAMP.test(decoded)) throw invalidResponse(`${label} is not a UTC timestamp.`);
  try {
    if (new Date(decoded).toISOString() !== decoded) {
      throw invalidResponse(`${label} is not a canonical UTC timestamp.`);
    }
  } catch (cause) {
    if (cause instanceof Error && "code" in cause) throw cause;
    throw invalidResponse(`${label} is not a valid UTC timestamp.`, cause);
  }
  return decoded;
}

function literalSingleton<T extends string>(value: unknown, literal: T, label: string): [T] {
  if (!Array.isArray(value) || value.length !== 1 || value[0] !== literal) {
    throw invalidResponse(`${label} must be exactly [${JSON.stringify(literal)}].`);
  }
  return [literal];
}

function assertUnique<T>(values: ReadonlyArray<T>, key: (value: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const candidate = key(value);
    if (seen.has(candidate)) throw invalidResponse(`${label} contains duplicate ${candidate}.`);
    seen.add(candidate);
  }
}

function artifactInputs(value: unknown, label: string): Readonly<Record<string, string>> {
  const record = object(value, label);
  const entries = Object.entries(record);
  if (entries.length > DRONE_V1_LIMITS.maxSlots) {
    throw invalidResponse(`${label} exceeds ${DRONE_V1_LIMITS.maxSlots} entries.`);
  }
  return Object.fromEntries(
    entries.map(([slot, id]) => [
      safeSlot(slot, `${label} key`),
      artifactId(id, `${label}.${slot}`),
    ]),
  );
}

function inputSlot(value: unknown, index: number): DroneOperationInputSlot {
  const label = `operation.inputs[${index}]`;
  const input = object(value, label);
  if (
    !Array.isArray(input.media_types) ||
    input.media_types.length === 0 ||
    input.media_types.length > DRONE_V1_LIMITS.maxMediaTypesPerInput
  ) {
    throw invalidResponse(`${label}.media_types is invalid.`);
  }
  const mediaTypes = input.media_types.map((entry, mediaIndex) =>
    mediaType(entry, `${label}.media_types[${mediaIndex}]`),
  );
  assertUnique(mediaTypes, (entry) => entry, `${label}.media_types`);
  return {
    name: safeSlot(input.name, `${label}.name`),
    required: boolean(input.required, `${label}.required`),
    max_bytes: integer(input.max_bytes, `${label}.max_bytes`, 1, DRONE_V1_LIMITS.maxArtifactBytes),
    media_types: mediaTypes,
  };
}

function operationOutput(value: unknown, index: number): DroneOperationOutput {
  const label = `operation.outputs[${index}]`;
  const output = object(value, label);
  return {
    name: safeSlot(output.name, `${label}.name`),
    required: boolean(output.required, `${label}.required`),
    max_bytes: integer(
      output.max_bytes,
      `${label}.max_bytes`,
      1,
      DRONE_V1_LIMITS.maxOperationOutputBytes,
    ),
    media_type: mediaType(output.media_type, `${label}.media_type`),
  };
}

function operationResources(value: unknown): DroneOperationResources {
  const resources = object(value, "operation.resources");
  return {
    cpus: integer(
      resources.cpus,
      "operation.resources.cpus",
      DRONE_V1_LIMITS.minCpus,
      DRONE_V1_LIMITS.maxCpus,
    ),
    memory_mb: integer(
      resources.memory_mb,
      "operation.resources.memory_mb",
      DRONE_V1_LIMITS.minMemoryMb,
      DRONE_V1_LIMITS.maxMemoryMb,
    ),
    rootfs_mb: integer(
      resources.rootfs_mb,
      "operation.resources.rootfs_mb",
      DRONE_V1_LIMITS.minRootfsMb,
      DRONE_V1_LIMITS.maxRootfsMb,
    ),
    writable_mb: integer(
      resources.writable_mb,
      "operation.resources.writable_mb",
      DRONE_V1_LIMITS.minWritableMb,
      DRONE_V1_LIMITS.maxWritableMb,
    ),
    output_disk_mb: integer(
      resources.output_disk_mb,
      "operation.resources.output_disk_mb",
      DRONE_V1_LIMITS.minOutputDiskMb,
      DRONE_V1_LIMITS.maxOutputDiskMb,
    ),
    timeout_seconds: integer(
      resources.timeout_seconds,
      "operation.resources.timeout_seconds",
      DRONE_V1_LIMITS.minTimeoutSeconds,
      DRONE_V1_LIMITS.maxTimeoutSeconds,
    ),
    max_log_bytes: integer(
      resources.max_log_bytes,
      "operation.resources.max_log_bytes",
      DRONE_V1_LIMITS.minLogBytes,
      DRONE_V1_LIMITS.maxLogBytes,
    ),
    max_processes: integer(
      resources.max_processes,
      "operation.resources.max_processes",
      DRONE_V1_LIMITS.minProcesses,
      DRONE_V1_LIMITS.maxProcesses,
    ),
    max_open_files: integer(
      resources.max_open_files,
      "operation.resources.max_open_files",
      DRONE_V1_LIMITS.minOpenFiles,
      DRONE_V1_LIMITS.maxOpenFiles,
    ),
  };
}

function validateJobState(job: DroneJob): void {
  const hasStarted = job.started_at !== undefined;
  const hasFinished = job.finished_at !== undefined;
  const hasExitCode = job.exit_code !== undefined;
  const hasTimedOut = job.timed_out !== undefined;
  const hasResult = hasExitCode && hasTimedOut;
  const hasCapturedStreams =
    job.stdout_artifact_id !== undefined || job.stderr_artifact_id !== undefined;
  const hasExecutionAttestation = job.execution_attestation_artifact_id !== undefined;
  const hasError = job.error_code !== undefined;

  if (hasExitCode !== hasTimedOut) {
    throw invalidResponse("Job exit_code and timed_out must be present together.");
  }
  if (hasStarted && job.started_at! < job.submitted_at) {
    throw invalidResponse("Job started_at precedes submitted_at.");
  }
  if (hasFinished && job.finished_at! < job.submitted_at) {
    throw invalidResponse("Job finished_at precedes submitted_at.");
  }
  if (hasStarted && hasFinished && job.finished_at! < job.started_at!) {
    throw invalidResponse("Job finished_at precedes started_at.");
  }

  switch (job.status) {
    case "queued":
      if (
        hasStarted ||
        hasFinished ||
        hasResult ||
        hasCapturedStreams ||
        hasExecutionAttestation ||
        hasError ||
        job.outputs.length > 0
      ) {
        throw invalidResponse("Queued job contains terminal or execution fields.");
      }
      return;
    case "running":
      if (
        !hasStarted ||
        hasFinished ||
        hasResult ||
        hasCapturedStreams ||
        hasExecutionAttestation ||
        hasError ||
        job.outputs.length > 0
      ) {
        throw invalidResponse("Running job fields are inconsistent.");
      }
      return;
    case "succeeded":
      if (
        !hasStarted ||
        !hasFinished ||
        job.exit_code !== 0 ||
        job.timed_out !== false ||
        !hasExecutionAttestation ||
        hasError
      ) {
        throw invalidResponse("Succeeded job fields are inconsistent.");
      }
      return;
    case "failed":
      if (!hasFinished || !hasError) {
        throw invalidResponse("Failed job must include finished_at and error_code.");
      }
      if (hasResult && (!hasStarted || (job.exit_code === 0 && job.timed_out === false))) {
        throw invalidResponse("Failed job result fields are inconsistent.");
      }
      if (hasResult !== hasExecutionAttestation) {
        throw invalidResponse("Failed job execution attestation is inconsistent.");
      }
      if (!hasResult && (hasCapturedStreams || job.outputs.length > 0)) {
        throw invalidResponse("Failed job evidence requires process result fields.");
      }
      return;
    case "cancelled":
    case "interrupted":
      if (
        !hasFinished ||
        !hasError ||
        hasResult ||
        hasCapturedStreams ||
        hasExecutionAttestation ||
        job.outputs.length > 0
      ) {
        throw invalidResponse(`${job.status} job fields are inconsistent.`);
      }
  }
}

export function isDroneArtifactId(value: string): boolean {
  return ARTIFACT_ID.test(value);
}

export function isDroneJobId(value: string): boolean {
  return JOB_ID.test(value);
}

export function isDroneOperationId(value: string): boolean {
  return SAFE_ID.test(value);
}

export function isDroneSlotName(value: string): boolean {
  return SAFE_SLOT.test(value);
}

export function isDroneAttestationId(value: string): boolean {
  return ATTESTATION_ID.test(value);
}

export function isDroneAttestationKeyId(value: string): boolean {
  return ATTESTATION_KEY_ID.test(value);
}

export function isDroneAttestationChallenge(value: string): boolean {
  return ATTESTATION_CHALLENGE.test(value);
}

export function isDroneContainerId(value: string): boolean {
  return CONTAINER_ID.test(value);
}

/** True for an OCI reference pinned to an exact sha256 digest. */
export function isDroneImageReference(value: string): boolean {
  return IMAGE_DIGEST.test(value);
}

/** True for a canonical lowercase `type/subtype` without parameters. */
export function isDroneMediaType(value: string): boolean {
  return MEDIA_TYPE.test(value);
}

export function normalizeDroneMediaType(value: string): string {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!MEDIA_TYPE.test(normalized) || normalized === "application/json") {
    throw invalidRequest("Artifact media type is invalid or reserved for the JSON API.");
  }
  return normalized;
}

export function decodeDroneJobSubmission(value: unknown): DroneJobSubmission {
  try {
    const input = object(value, "Job submission");
    if (input.schema_version !== "1") {
      throw invalidResponse("Job submission schema_version must be 1.");
    }
    return {
      schema_version: "1",
      operation_id: safeId(input.operation_id, "Job submission operation_id"),
      provider_attestation_id: attestationId(
        input.provider_attestation_id,
        "Job submission provider_attestation_id",
      ),
      inputs: artifactInputs(input.inputs, "Job submission inputs"),
    };
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "INVALID_RESPONSE") {
      throw invalidRequest(cause.message, cause);
    }
    throw cause;
  }
}

function decodeProviderAttestationSummary(value: unknown): DroneProviderAttestationSummary {
  const summary = object(value, "Provider attestation summary");
  if (summary.profile !== APPLE_NATIVE_ATTESTATION_PROFILE) {
    throw invalidResponse("Provider attestation profile is invalid.");
  }
  const issuer = string(summary.issuer, "Provider attestation issuer", 128);
  if (containsControl(issuer)) {
    throw invalidResponse("Provider attestation issuer is invalid.");
  }
  const issuedAt = timestamp(summary.issued_at, "Provider attestation issued_at");
  const expiresAt = timestamp(summary.expires_at, "Provider attestation expires_at");
  if (expiresAt <= issuedAt) {
    throw invalidResponse("Provider attestation validity interval is invalid.");
  }
  return {
    attestation_id: attestationId(summary.attestation_id, "Provider attestation attestation_id"),
    profile: APPLE_NATIVE_ATTESTATION_PROFILE,
    key_id: attestationKeyId(summary.key_id, "Provider attestation key_id"),
    issuer,
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
}

export function decodeDroneProviderStatus(value: unknown): DroneProviderStatus {
  const status = object(value, "Provider status");
  const reason = status.reason;
  if (typeof reason !== "string" || reason.length > 128) {
    throw invalidResponse("Provider status reason is invalid.");
  }
  const installed = boolean(status.installed, "Provider status installed");
  const enabled = boolean(status.enabled, "Provider status enabled");
  const mutationsAvailable = boolean(
    status.mutations_available,
    "Provider status mutations_available",
  );
  const attested = boolean(status.attested, "Provider status attested");
  const attestation =
    status.attestation === undefined
      ? undefined
      : decodeProviderAttestationSummary(status.attestation);
  if (
    (enabled && !installed) ||
    attested !== (attestation !== undefined) ||
    (mutationsAvailable && (!enabled || !attested))
  ) {
    throw invalidResponse("Provider availability flags are inconsistent.");
  }
  return {
    provider_id: providerId(status.provider_id, "Provider status provider_id"),
    product: string(status.product, "Provider status product", 128),
    installed,
    enabled,
    mutations_available: mutationsAvailable,
    attested,
    ...(attestation === undefined ? {} : { attestation }),
    reason,
    isolation:
      status.isolation === "lightweight_vm"
        ? "lightweight_vm"
        : (() => {
            throw invalidResponse("Provider status isolation is invalid.");
          })(),
    guest_os: literalSingleton(status.guest_os, "linux", "Provider status guest_os"),
    network_modes: literalSingleton(status.network_modes, "none", "Provider status network_modes"),
  };
}

export function decodeDroneProviderStatuses(value: unknown): ReadonlyArray<DroneProviderStatus> {
  if (!Array.isArray(value) || value.length > DRONE_V1_LIMITS.maxProviders) {
    throw invalidResponse(
      `Provider status response must contain at most ${DRONE_V1_LIMITS.maxProviders} entries.`,
    );
  }
  const statuses = value.map(decodeDroneProviderStatus);
  assertUnique(statuses, (status) => status.provider_id, "Provider status response");
  return statuses;
}

export function decodeDroneExecutionAttestation(value: unknown): DroneExecutionAttestation {
  const evidence = object(value, "Execution attestation");
  exactKeys(
    evidence,
    [
      "schema_version",
      "profile",
      "provider_attestation_id",
      "challenge",
      "container_id",
      "image_reference",
      "backend",
      "isolation",
      "guest_os",
      "network_mode",
      "ephemeral_vm",
      "read_only_root",
      "input_disk_read_only",
      "output_disk_bounded",
      "host_directory_sharing",
      "socket_sharing",
      "nested_virtualization",
      "non_root_required",
      "no_new_privileges",
      "capabilities",
    ],
    "Execution attestation",
  );
  if (
    evidence.schema_version !== "1" ||
    evidence.profile !== APPLE_NATIVE_ATTESTATION_PROFILE ||
    evidence.backend !== "apple_containerization" ||
    evidence.isolation !== "lightweight_vm" ||
    evidence.guest_os !== "linux" ||
    evidence.network_mode !== "none" ||
    evidence.ephemeral_vm !== true ||
    evidence.read_only_root !== true ||
    evidence.input_disk_read_only !== true ||
    evidence.output_disk_bounded !== true ||
    evidence.host_directory_sharing !== false ||
    evidence.socket_sharing !== false ||
    evidence.nested_virtualization !== false ||
    evidence.non_root_required !== true ||
    evidence.no_new_privileges !== true ||
    evidence.capabilities !== "none"
  ) {
    throw invalidResponse("Execution attestation isolation claims are invalid.");
  }
  if (typeof evidence.challenge !== "string" || !ATTESTATION_CHALLENGE.test(evidence.challenge)) {
    throw invalidResponse("Execution attestation challenge is invalid.");
  }
  if (typeof evidence.container_id !== "string" || !CONTAINER_ID.test(evidence.container_id)) {
    throw invalidResponse("Execution attestation container_id is invalid.");
  }
  if (
    typeof evidence.image_reference !== "string" ||
    !IMAGE_DIGEST.test(evidence.image_reference)
  ) {
    throw invalidResponse("Execution attestation image_reference is invalid.");
  }
  return {
    schema_version: "1",
    profile: APPLE_NATIVE_ATTESTATION_PROFILE,
    provider_attestation_id: attestationId(
      evidence.provider_attestation_id,
      "Execution attestation provider_attestation_id",
    ),
    challenge: evidence.challenge,
    container_id: evidence.container_id,
    image_reference: evidence.image_reference,
    backend: "apple_containerization",
    isolation: "lightweight_vm",
    guest_os: "linux",
    network_mode: "none",
    ephemeral_vm: true,
    read_only_root: true,
    input_disk_read_only: true,
    output_disk_bounded: true,
    host_directory_sharing: false,
    socket_sharing: false,
    nested_virtualization: false,
    non_root_required: true,
    no_new_privileges: true,
    capabilities: "none",
  };
}

export function decodeDronePublicOperation(value: unknown): DronePublicOperation {
  const operation = object(value, "Operation");
  if (!Array.isArray(operation.inputs) || operation.inputs.length > DRONE_V1_LIMITS.maxSlots) {
    throw invalidResponse("Operation inputs are invalid.");
  }
  if (!Array.isArray(operation.outputs) || operation.outputs.length > DRONE_V1_LIMITS.maxSlots) {
    throw invalidResponse("Operation outputs are invalid.");
  }
  if (operation.architecture !== "arm64" && operation.architecture !== "amd64") {
    throw invalidResponse("Operation architecture is invalid.");
  }
  if (operation.network !== "none") throw invalidResponse("Operation network is invalid.");

  const inputs = operation.inputs.map(inputSlot);
  const outputs = operation.outputs.map(operationOutput);
  const resources = operationResources(operation.resources);
  assertUnique(inputs, (input) => input.name, "Operation inputs");
  assertUnique(outputs, (output) => output.name, "Operation outputs");
  const outputBytes = outputs.reduce((total, output) => total + output.max_bytes, 0);
  if (outputBytes > (resources.output_disk_mb - 1) * MIB) {
    throw invalidResponse("Operation outputs exceed the bounded output disk.");
  }

  return {
    operation_id: safeId(operation.operation_id, "Operation operation_id"),
    enabled: boolean(operation.enabled, "Operation enabled"),
    provider: providerId(operation.provider, "Operation provider"),
    architecture: operation.architecture,
    network: "none",
    inputs,
    outputs,
    resources,
  };
}

export function decodeDronePublicOperations(value: unknown): ReadonlyArray<DronePublicOperation> {
  if (!Array.isArray(value) || value.length > DRONE_V1_LIMITS.maxOperations) {
    throw invalidResponse(
      `Operation response must contain at most ${DRONE_V1_LIMITS.maxOperations} entries.`,
    );
  }
  const operations = value.map(decodeDronePublicOperation);
  assertUnique(operations, (operation) => operation.operation_id, "Operation response");
  return operations;
}

export function decodeDroneArtifactMetadata(value: unknown): DroneArtifactMetadata {
  const metadata = object(value, "Artifact metadata");
  if (metadata.schema_version !== "1") {
    throw invalidResponse("Artifact metadata schema_version must be 1.");
  }
  const decodedArtifactId = artifactId(metadata.artifact_id, "Artifact metadata artifact_id");
  const digest = string(metadata.sha256, "Artifact metadata sha256", 64);
  if (!SHA256.test(digest) || decodedArtifactId !== `sha256_${digest}`) {
    throw invalidResponse("Artifact metadata digest is inconsistent.");
  }
  return {
    schema_version: "1",
    artifact_id: decodedArtifactId,
    sha256: digest,
    size_bytes: integer(
      metadata.size_bytes,
      "Artifact metadata size_bytes",
      1,
      DRONE_V1_LIMITS.maxArtifactBytes,
    ),
    media_type: mediaType(metadata.media_type, "Artifact metadata media_type"),
    created_at: timestamp(metadata.created_at, "Artifact metadata created_at"),
  };
}

function jobOutput(value: unknown, index: number): DroneJobOutputArtifact {
  const label = `Job outputs[${index}]`;
  const output = object(value, label);
  return {
    name: safeSlot(output.name, `${label}.name`),
    artifact_id: artifactId(output.artifact_id, `${label}.artifact_id`),
    size_bytes: integer(
      output.size_bytes,
      `${label}.size_bytes`,
      1,
      DRONE_V1_LIMITS.maxOperationOutputBytes,
    ),
    media_type: mediaType(output.media_type, `${label}.media_type`),
  };
}

export function decodeDroneJob(value: unknown): DroneJob {
  const job = object(value, "Job");
  if (job.schema_version !== "1") throw invalidResponse("Job schema_version must be 1.");
  if (typeof job.job_id !== "string" || !JOB_ID.test(job.job_id)) {
    throw invalidResponse("Job job_id is invalid.");
  }
  if (typeof job.status !== "string" || !JOB_STATUSES.has(job.status as DroneJobStatus)) {
    throw invalidResponse("Job status is invalid.");
  }
  if (!Array.isArray(job.outputs) || job.outputs.length > DRONE_V1_LIMITS.maxSlots) {
    throw invalidResponse("Job outputs are invalid.");
  }

  const optionalTimestamp = (key: "started_at" | "finished_at"): string | undefined =>
    job[key] === undefined ? undefined : timestamp(job[key], `Job ${key}`);
  const optionalArtifact = (
    key: "stdout_artifact_id" | "stderr_artifact_id" | "execution_attestation_artifact_id",
  ): string | undefined =>
    job[key] === undefined ? undefined : artifactId(job[key], `Job ${key}`);
  const optionalErrorCode = (): string | undefined => {
    if (job.error_code === undefined) return undefined;
    if (typeof job.error_code !== "string" || !ERROR_CODE.test(job.error_code)) {
      throw invalidResponse("Job error_code is invalid.");
    }
    return job.error_code;
  };
  const startedAt = optionalTimestamp("started_at");
  const finishedAt = optionalTimestamp("finished_at");
  const stdoutArtifactId = optionalArtifact("stdout_artifact_id");
  const stderrArtifactId = optionalArtifact("stderr_artifact_id");
  const executionAttestationArtifactId = optionalArtifact("execution_attestation_artifact_id");
  const errorCode = optionalErrorCode();
  const exitCode =
    job.exit_code === undefined
      ? undefined
      : integer(
          job.exit_code,
          "Job exit_code",
          DRONE_V1_LIMITS.minExitCode,
          DRONE_V1_LIMITS.maxExitCode,
        );
  const timedOut =
    job.timed_out === undefined ? undefined : boolean(job.timed_out, "Job timed_out");
  const outputs = job.outputs.map(jobOutput);
  assertUnique(outputs, (output) => output.name, "Job outputs");

  const decoded: DroneJob = {
    schema_version: "1",
    job_id: job.job_id,
    operation_id: safeId(job.operation_id, "Job operation_id"),
    provider_id: providerId(job.provider_id, "Job provider_id"),
    provider_attestation_id: attestationId(
      job.provider_attestation_id,
      "Job provider_attestation_id",
    ),
    status: job.status as DroneJobStatus,
    inputs: artifactInputs(job.inputs, "Job inputs"),
    outputs,
    submitted_at: timestamp(job.submitted_at, "Job submitted_at"),
    ...(startedAt === undefined ? {} : { started_at: startedAt }),
    ...(finishedAt === undefined ? {} : { finished_at: finishedAt }),
    ...(exitCode === undefined ? {} : { exit_code: exitCode }),
    ...(timedOut === undefined ? {} : { timed_out: timedOut }),
    ...(stdoutArtifactId === undefined ? {} : { stdout_artifact_id: stdoutArtifactId }),
    ...(stderrArtifactId === undefined ? {} : { stderr_artifact_id: stderrArtifactId }),
    ...(executionAttestationArtifactId === undefined
      ? {}
      : { execution_attestation_artifact_id: executionAttestationArtifactId }),
    ...(errorCode === undefined ? {} : { error_code: errorCode }),
  };
  validateJobState(decoded);
  return decoded;
}

export function decodeDroneJobs(value: unknown): ReadonlyArray<DroneJob> {
  if (!Array.isArray(value) || value.length > DRONE_V1_LIMITS.maxJobs) {
    throw invalidResponse(`Job response must contain at most ${DRONE_V1_LIMITS.maxJobs} entries.`);
  }
  const jobs = value.map(decodeDroneJob);
  assertUnique(jobs, (job) => job.job_id, "Job response");
  return jobs;
}
