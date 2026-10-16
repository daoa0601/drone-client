import { describe, expect, it } from "vitest";

import {
  decodeDroneArtifactMetadata,
  decodeDroneExecutionAttestation,
  decodeDroneJob,
  decodeDroneJobs,
  decodeDroneJobSubmission,
  decodeDroneProviderStatuses,
  decodeDronePublicOperations,
  DRONE_V1_LIMITS,
  APPLE_NATIVE_ATTESTATION_PROFILE,
  APPLE_NATIVE_PROVIDER_ID,
  DroneClientError,
  isDroneArtifactId,
  isDroneAttestationChallenge,
  isDroneAttestationId,
  isDroneAttestationKeyId,
  isDroneContainerId,
  isDroneImageReference,
  isDroneJobId,
  isDroneMediaType,
  isDroneOperationId,
  isDroneSlotName,
  normalizeDroneMediaType,
} from "../src/index.js";
import {
  ARTIFACT_ID,
  artifactMetadata,
  JOB_ID,
  PROVIDER_ATTESTATION_ID,
  job,
  providerStatus,
  publicOperation,
} from "./fixtures.js";

describe("Drone public contracts", () => {
  it("normalizes a valid submission and rejects unsafe operation, slot, and artifact IDs", () => {
    expect(
      decodeDroneJobSubmission({
        schema_version: "1",
        operation_id: "pe.static_snapshot",
        provider_attestation_id: PROVIDER_ATTESTATION_ID,
        inputs: { sample: ARTIFACT_ID },
        ignored_client_field: true,
      }),
    ).toEqual({
      schema_version: "1",
      operation_id: "pe.static_snapshot",
      provider_attestation_id: PROVIDER_ATTESTATION_ID,
      inputs: { sample: ARTIFACT_ID },
    });

    for (const input of [
      {
        schema_version: "2",
        operation_id: "pe.static_snapshot",
        provider_attestation_id: PROVIDER_ATTESTATION_ID,
        inputs: {},
      },
      {
        schema_version: "1",
        operation_id: "../escape",
        provider_attestation_id: PROVIDER_ATTESTATION_ID,
        inputs: {},
      },
      {
        schema_version: "1",
        operation_id: "pe.static_snapshot",
        provider_attestation_id: PROVIDER_ATTESTATION_ID,
        inputs: { "../x": ARTIFACT_ID },
      },
      {
        schema_version: "1",
        operation_id: "pe.static_snapshot",
        provider_attestation_id: PROVIDER_ATTESTATION_ID,
        inputs: { sample: "mutable-file-name" },
      },
    ]) {
      expect(() => decodeDroneJobSubmission(input)).toThrowError(
        expect.objectContaining({ code: "INVALID_REQUEST" }),
      );
    }
  });

  it("decodes provider capabilities and rejects widened isolation claims", () => {
    expect(decodeDroneProviderStatuses([providerStatus()])).toEqual([providerStatus()]);
    expect(() =>
      decodeDroneProviderStatuses([{ ...providerStatus(), network_modes: ["bridge"] }]),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
    expect(() => decodeDroneProviderStatuses(Array.from({ length: 17 }, providerStatus))).toThrow();
    expect(() => decodeDroneProviderStatuses([providerStatus(), providerStatus()])).toThrowError(
      /duplicate/iu,
    );
    expect(() =>
      decodeDroneProviderStatuses([providerStatus({ installed: false, enabled: true })]),
    ).toThrowError(/inconsistent/iu);
    expect(() =>
      decodeDroneProviderStatuses([providerStatus({ enabled: false, mutations_available: true })]),
    ).toThrowError(/inconsistent/iu);
    expect(() =>
      decodeDroneProviderStatuses([
        providerStatus({ attested: false, mutations_available: false }),
      ]),
    ).toThrowError(/inconsistent/iu);
    expect(() =>
      decodeDroneProviderStatuses([
        providerStatus({
          mutations_available: false,
          attestation: {
            ...providerStatus().attestation!,
            expires_at: "2026-07-17T08:00:00.000Z",
          },
        }),
      ]),
    ).toThrowError(/validity interval/iu);
    expect(() =>
      decodeDroneProviderStatuses([{ ...providerStatus(), guest_os: ["linux", "linux"] }]),
    ).toThrow();
  });

  it("strictly decodes no-network per-job VM execution evidence", () => {
    const evidence = {
      schema_version: "1",
      profile: APPLE_NATIVE_ATTESTATION_PROFILE,
      provider_attestation_id: PROVIDER_ATTESTATION_ID,
      challenge: "e".repeat(64),
      container_id: `drone-${"f".repeat(24)}`,
      image_reference: `registry.example/drone/tool@sha256:${"a".repeat(64)}`,
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
    expect(decodeDroneExecutionAttestation(evidence)).toEqual(evidence);
    expect(() =>
      decodeDroneExecutionAttestation({ ...evidence, network_mode: "bridge" }),
    ).toThrowError(/isolation claims/iu);
    expect(() =>
      decodeDroneExecutionAttestation({ ...evidence, undocumented_claim: true }),
    ).toThrowError(/strict schema/iu);
  });

  it("decodes public operations and enforces bounded declared structures", () => {
    expect(decodeDronePublicOperations([publicOperation()])).toEqual([publicOperation()]);
    expect(() =>
      decodeDronePublicOperations([publicOperation({ network: "bridge" as "none" })]),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
    expect(() =>
      decodeDronePublicOperations([
        publicOperation({
          inputs: Array.from({ length: 17 }, () => publicOperation().inputs[0]!),
        }),
      ]),
    ).toThrow();
    expect(() => decodeDronePublicOperations([publicOperation(), publicOperation()])).toThrowError(
      /duplicate/iu,
    );
    expect(() =>
      decodeDronePublicOperations([
        publicOperation({
          inputs: [publicOperation().inputs[0]!, publicOperation().inputs[0]!],
        }),
      ]),
    ).toThrowError(/duplicate/iu);
    expect(() =>
      decodeDronePublicOperations([
        publicOperation({
          inputs: [
            {
              ...publicOperation().inputs[0]!,
              media_types: ["application/json", "application/json"],
            },
          ],
        }),
      ]),
    ).toThrowError(/duplicate/iu);
    expect(() =>
      decodeDronePublicOperations([
        publicOperation({
          outputs: [publicOperation().outputs[0]!, publicOperation().outputs[0]!],
        }),
      ]),
    ).toThrowError(/duplicate/iu);
  });

  it.each([
    ["cpus", DRONE_V1_LIMITS.minCpus, DRONE_V1_LIMITS.maxCpus],
    ["memory_mb", DRONE_V1_LIMITS.minMemoryMb, DRONE_V1_LIMITS.maxMemoryMb],
    ["rootfs_mb", DRONE_V1_LIMITS.minRootfsMb, DRONE_V1_LIMITS.maxRootfsMb],
    ["writable_mb", DRONE_V1_LIMITS.minWritableMb, DRONE_V1_LIMITS.maxWritableMb],
    ["output_disk_mb", DRONE_V1_LIMITS.minOutputDiskMb, DRONE_V1_LIMITS.maxOutputDiskMb],
    ["timeout_seconds", DRONE_V1_LIMITS.minTimeoutSeconds, DRONE_V1_LIMITS.maxTimeoutSeconds],
    ["max_log_bytes", DRONE_V1_LIMITS.minLogBytes, DRONE_V1_LIMITS.maxLogBytes],
    ["max_processes", DRONE_V1_LIMITS.minProcesses, DRONE_V1_LIMITS.maxProcesses],
    ["max_open_files", DRONE_V1_LIMITS.minOpenFiles, DRONE_V1_LIMITS.maxOpenFiles],
  ] as const)("enforces the v1 %s range", (field, minimum, maximum) => {
    const operation = publicOperation();
    const withValue = (value: number) =>
      publicOperation({ resources: { ...operation.resources, [field]: value } });
    expect(() => decodeDronePublicOperations([withValue(minimum)])).not.toThrow();
    expect(() => decodeDronePublicOperations([withValue(maximum)])).not.toThrow();
    expect(() => decodeDronePublicOperations([withValue(minimum - 1)])).toThrow();
    expect(() => decodeDronePublicOperations([withValue(maximum + 1)])).toThrow();
  });

  it("enforces v1 artifact/output maxima and the bounded output disk", () => {
    const operation = publicOperation();
    expect(Object.isFrozen(DRONE_V1_LIMITS)).toBe(true);
    expect(() =>
      decodeDronePublicOperations([
        publicOperation({
          inputs: [
            {
              ...operation.inputs[0]!,
              max_bytes: DRONE_V1_LIMITS.maxArtifactBytes + 1,
            },
          ],
        }),
      ]),
    ).toThrow();
    expect(() =>
      decodeDronePublicOperations([
        publicOperation({
          outputs: [
            {
              ...operation.outputs[0]!,
              max_bytes: DRONE_V1_LIMITS.maxOperationOutputBytes + 1,
            },
          ],
        }),
      ]),
    ).toThrow();
    expect(() =>
      decodeDronePublicOperations([
        publicOperation({
          outputs: [{ ...operation.outputs[0]!, max_bytes: 16 * 1024 * 1024 }],
          resources: { ...operation.resources, output_disk_mb: 16 },
        }),
      ]),
    ).toThrowError(/output disk/iu);
  });

  it("checks content-addressed artifact metadata for digest consistency", () => {
    expect(decodeDroneArtifactMetadata(artifactMetadata())).toEqual(artifactMetadata());
    expect(() =>
      decodeDroneArtifactMetadata(artifactMetadata({ sha256: "c".repeat(64) })),
    ).toThrowError(expect.objectContaining({ code: "INVALID_RESPONSE" }));
    expect(() =>
      decodeDroneArtifactMetadata(artifactMetadata({ created_at: "yesterday" })),
    ).toThrow();
    expect(() =>
      decodeDroneArtifactMetadata(
        artifactMetadata({ size_bytes: DRONE_V1_LIMITS.maxArtifactBytes + 1 }),
      ),
    ).toThrow();
    expect(() =>
      decodeDroneArtifactMetadata(artifactMetadata({ created_at: "2026-99-18T08:30:00.000Z" })),
    ).toThrow();
  });

  it("decodes full job records including terminal evidence", () => {
    const terminal = job({
      status: "failed",
      outputs: [
        {
          name: "report",
          artifact_id: ARTIFACT_ID,
          size_bytes: 12,
          media_type: "application/json",
        },
      ],
      started_at: "2026-07-18T08:31:01.000Z",
      finished_at: "2026-07-18T08:31:02.000Z",
      exit_code: 7,
      timed_out: false,
      stdout_artifact_id: ARTIFACT_ID,
      stderr_artifact_id: ARTIFACT_ID,
      execution_attestation_artifact_id: ARTIFACT_ID,
      error_code: "SANDBOX_EXIT_NONZERO",
    });
    expect(decodeDroneJob(terminal)).toEqual(terminal);
    expect(decodeDroneJobs([terminal])).toEqual([terminal]);
    expect(() => decodeDroneJob(job({ status: "unknown" as "queued" }))).toThrow();
    expect(() => decodeDroneJob(job({ error_code: "unsafe value" }))).toThrow();
    expect(() => decodeDroneJobs(Array.from({ length: 101 }, job))).toThrow();
    expect(() => decodeDroneJobs([job(), job()])).toThrowError(/duplicate/iu);
    expect(() =>
      decodeDroneJob(
        job({
          status: "failed",
          exit_code: DRONE_V1_LIMITS.maxExitCode + 1,
          timed_out: false,
        }),
      ),
    ).toThrow();
    expect(() =>
      decodeDroneJob(
        job({
          status: "failed",
          outputs: [
            {
              name: "report",
              artifact_id: ARTIFACT_ID,
              size_bytes: DRONE_V1_LIMITS.maxOperationOutputBytes + 1,
              media_type: "application/json",
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it("enforces job state, field, chronology, and output-name invariants", () => {
    for (const status of [
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "interrupted",
    ] as const) {
      expect(decodeDroneJob(job({ status }))).toEqual(job({ status }));
    }

    const invalid = [
      job({ status: "queued", started_at: "2026-07-18T08:31:01.000Z" }),
      { ...job({ status: "running" }), started_at: undefined },
      job({ status: "succeeded", exit_code: 1, timed_out: false }),
      { ...job({ status: "failed" }), error_code: undefined },
      job({ status: "failed", exit_code: 0, timed_out: false }),
      job({ status: "cancelled", exit_code: 1, timed_out: false }),
      { ...job({ status: "succeeded" }), execution_attestation_artifact_id: undefined },
      {
        ...job({ status: "failed" }),
        execution_attestation_artifact_id: undefined,
      },
      job({
        status: "interrupted",
        outputs: [
          {
            name: "report",
            artifact_id: ARTIFACT_ID,
            size_bytes: 1,
            media_type: "application/json",
          },
        ],
      }),
      job({ status: "running", started_at: "2026-07-18T08:29:00.000Z" }),
      {
        ...job({ status: "failed" }),
        outputs: [
          {
            name: "report",
            artifact_id: ARTIFACT_ID,
            size_bytes: 1,
            media_type: "application/json",
          },
          {
            name: "report",
            artifact_id: ARTIFACT_ID,
            size_bytes: 1,
            media_type: "application/json",
          },
        ],
      },
    ];
    for (const record of invalid) expect(() => decodeDroneJob(record)).toThrow();
  });

  it("exposes identifier and artifact-media-type guards", () => {
    expect(isDroneArtifactId(ARTIFACT_ID)).toBe(true);
    expect(isDroneArtifactId("sha256_latest")).toBe(false);
    expect(isDroneJobId(JOB_ID)).toBe(true);
    expect(isDroneJobId("job_latest")).toBe(false);
    expect(normalizeDroneMediaType("Application/Octet-Stream; charset=binary")).toBe(
      "application/octet-stream",
    );
    expect(() => normalizeDroneMediaType("application/json")).toThrowError(DroneClientError);
  });

  it("exposes the public v1 identifier syntax shared with the Drone server", () => {
    expect(APPLE_NATIVE_PROVIDER_ID).toBe("apple_native");
    expect(isDroneOperationId("pe.static_snapshot")).toBe(true);
    expect(isDroneOperationId("PE.snapshot")).toBe(false);
    expect(isDroneOperationId(` pe.static_snapshot`)).toBe(false);
    expect(isDroneSlotName("sample-input")).toBe(true);
    expect(isDroneSlotName("sample.input")).toBe(false);
    expect(isDroneAttestationId(PROVIDER_ATTESTATION_ID)).toBe(true);
    expect(isDroneAttestationId(`attestation.sha256.${"A".repeat(64)}`)).toBe(false);
    expect(isDroneAttestationKeyId(`ed25519.sha256.${"c".repeat(64)}`)).toBe(true);
    expect(isDroneAttestationKeyId(`rsa.sha256.${"c".repeat(64)}`)).toBe(false);
    expect(isDroneAttestationChallenge("d".repeat(64))).toBe(true);
    expect(isDroneAttestationChallenge("d".repeat(63))).toBe(false);
    expect(isDroneContainerId(`drone-${"e".repeat(24)}`)).toBe(true);
    expect(isDroneContainerId(`drone-${"e".repeat(23)}`)).toBe(false);
    expect(isDroneImageReference(`registry.example/tools@sha256:${"f".repeat(64)}`)).toBe(true);
    expect(isDroneImageReference("registry.example/tools:latest")).toBe(false);
    expect(isDroneMediaType("application/vnd.microsoft.portable-executable")).toBe(true);
    expect(isDroneMediaType("Application/Octet-Stream")).toBe(false);
    expect(isDroneMediaType("application/octet-stream; charset=binary")).toBe(false);
  });
});
