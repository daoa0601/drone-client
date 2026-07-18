import type {
  DroneArtifactMetadata,
  DroneJob,
  DroneProviderStatus,
  DronePublicOperation,
} from "../src/index.js";

export const ARTIFACT_SHA256 = "3c6a8279d628d16065388481df6c286915f0dbe13d6d73cb763a8ac729ecb362";
export const ARTIFACT_ID = `sha256_${ARTIFACT_SHA256}`;
export const JOB_ID = `job_${"b".repeat(32)}`;

export function artifactMetadata(
  override: Partial<DroneArtifactMetadata> = {},
): DroneArtifactMetadata {
  return {
    schema_version: "1",
    artifact_id: ARTIFACT_ID,
    sha256: ARTIFACT_SHA256,
    size_bytes: 8,
    media_type: "application/octet-stream",
    created_at: "2026-07-18T08:30:00.000Z",
    ...override,
  };
}

export function providerStatus(override: Partial<DroneProviderStatus> = {}): DroneProviderStatus {
  return {
    provider_id: "apple_native",
    product: "Apple Containerization",
    installed: true,
    enabled: true,
    mutations_available: true,
    reason: "ready",
    isolation: "lightweight_vm",
    guest_os: ["linux"],
    network_modes: ["none"],
    ...override,
  };
}

export function publicOperation(
  override: Partial<DronePublicOperation> = {},
): DronePublicOperation {
  return {
    operation_id: "pe.static_snapshot",
    enabled: true,
    provider: "apple_native",
    architecture: "arm64",
    network: "none",
    inputs: [
      {
        name: "sample",
        required: true,
        max_bytes: 1_048_576,
        media_types: ["application/octet-stream"],
      },
    ],
    outputs: [
      {
        name: "report",
        required: true,
        max_bytes: 65_536,
        media_type: "application/json",
      },
    ],
    resources: {
      cpus: 2,
      memory_mb: 2048,
      rootfs_mb: 4096,
      writable_mb: 256,
      output_disk_mb: 32,
      timeout_seconds: 120,
      max_log_bytes: 262_144,
      max_processes: 64,
      max_open_files: 256,
    },
    ...override,
  };
}

export function job(override: Partial<DroneJob> = {}): DroneJob {
  const status = override.status ?? "queued";
  const state: Partial<DroneJob> =
    status === "running"
      ? { started_at: "2026-07-18T08:31:01.000Z" }
      : status === "succeeded"
        ? {
            started_at: "2026-07-18T08:31:01.000Z",
            finished_at: "2026-07-18T08:31:02.000Z",
            exit_code: 0,
            timed_out: false,
          }
        : status === "failed"
          ? {
              started_at: "2026-07-18T08:31:01.000Z",
              finished_at: "2026-07-18T08:31:02.000Z",
              exit_code: 1,
              timed_out: false,
              error_code: "SANDBOX_EXIT_NONZERO",
            }
          : status === "cancelled" || status === "interrupted"
            ? {
                finished_at: "2026-07-18T08:31:02.000Z",
                error_code: status === "cancelled" ? "CANCELLED_BY_OPERATOR" : "SERVICE_RESTARTED",
              }
            : {};
  return {
    schema_version: "1",
    job_id: JOB_ID,
    operation_id: "pe.static_snapshot",
    provider_id: "apple_native",
    status,
    inputs: { sample: ARTIFACT_ID },
    outputs: [],
    submitted_at: "2026-07-18T08:31:00.000Z",
    ...state,
    ...override,
  };
}
