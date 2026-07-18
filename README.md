# `@agentic-orch/drone-client`

`@agentic-orch/drone-client` is the supported Node.js client and public v1 wire-contract package for the
Drone sandbox service. It has no runtime dependencies on Drone, Effect, or a server framework.

> Status: private local workspace module; npm publication is intentionally disabled.

The package owns:

- public Drone HTTP request and response types;
- runtime decoders for provider, operation, artifact, and job responses;
- the loopback-HTTP-or-HTTPS base URL policy;
- bearer authentication, request timeouts, cancellation, and redirect rejection;
- hard deadlines that do not rely on transport abort compliance;
- bounded, uncompressed response handling with exact `Content-Length` reconciliation;
- request/response correlation and sha256 verification of downloaded artifacts.
- signed-provider admission fields and strict per-job VM execution-attestation decoding.

Drone's provider implementations, operation registry, stores, service, and HTTP server remain
server internals and are intentionally not exported here.

## Usage

```ts
import { DroneClient } from "@agentic-orch/drone-client";

const drone = new DroneClient({
  baseUrl: "http://127.0.0.1:8090",
  token: process.env.DRONE_BEARER_TOKEN,
  timeoutMs: 1_000,
});

const providers = await drone.providers();
const apple = providers.find((provider) => provider.provider_id === "apple_native");
if (apple?.mutations_available !== true || apple.attestation === undefined) {
  throw new Error("No independently attested Drone provider is ready");
}
const artifact = await drone.stageArtifact(bytes, "application/octet-stream");
const job = await drone.submitJob({
  schema_version: "1",
  operation_id: "pe.static_snapshot",
  provider_attestation_id: apple.attestation.attestation_id,
  inputs: { sample: artifact.artifact_id },
});
```

The client also exposes `operations`, `artifact`, `artifactContent`, `jobs`, `job`, and `cancelJob`.
Every JSON response is decoded before it reaches the caller. `DroneClientError.code` distinguishes
invalid local configuration or requests from transport, HTTP, size-limit, and response-contract
failures.

Provider readiness is internally correlated: `mutations_available` requires an installed, enabled,
attested provider and a signed-attestation summary. Every job carries the exact
`provider_attestation_id` admitted at submission. Callers must repeat that ID in the submission;
Drone rejects it atomically if provider admission has rotated since discovery. A succeeded job, or a
failed job with a process result, must also carry `execution_attestation_artifact_id`; queued,
running, cancelled, interrupted, and pre-execution provider failures must not fabricate one.

After downloading that artifact with `artifactContent`, pass its JSON value to
`decodeDroneExecutionAttestation`. The decoder requires the fixed Apple lightweight-VM/no-network
claims and validates the provider ID, random challenge, VM ID, and digest-pinned image reference.
Consumers still need to correlate its `provider_attestation_id` with the job they requested.

The intended high-assurance sequence is therefore: discover and approve one current provider
attestation, repeat its ID atomically in `submitJob`, wait for a terminal job, download the declared
outputs and execution-attestation artifact by content ID, decode both, then correlate provider ID,
operation, image, challenge, VM ID, input IDs, output IDs, process result, and timestamps before
releasing evidence to an application. The client validates wire shape and content identity; it does
not turn a locally issued software-measurement statement into hardware remote attestation.

The client sends `Accept-Encoding: identity`, rejects compressed responses, and cancels rejected or
over-limit response bodies without allowing cleanup failures to replace the primary error. Artifact
metadata and job records must match the ID, operation, inputs, and endpoint state requested by the
caller. `artifactContent` hashes the received bytes and compares them with the requested
`sha256_<digest>` ID before returning them.

When a response includes `Content-Length`, the declared byte count must exactly match the bytes the
client consumes; too few or too many bytes fail the response instead of returning a truncated or
ambiguous result. A missing `Content-Length` is allowed, but the streaming byte limit still applies.

Runtime decoders enforce the frozen public v1 limits exported as `DRONE_V1_LIMITS`, including
operation resources, artifact/output sizes, collection bounds, unique public identifiers and slot
names, canonical timestamps, attestation identities, and valid job-state/evidence combinations.
These are wire-contract constants, not imports from Drone's server implementation.

Plain HTTP is accepted only for `127.0.0.1`, `::1`, and `localhost`. Non-local endpoints must use
HTTPS. Base URLs with credentials, paths, queries, or fragments are rejected.

## Development and local reuse

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm pack:check
```

Consumers declare `@agentic-orch/drone-client: "workspace:*"` and include `../drone-client` in their
pnpm workspace. Templar's lock records `link:../drone-client`, so a missing or misnamed sibling fails
installation instead of falling back to a registry package. `pnpm pack:check` remains a useful
clean-room export test even though the module is private.

Version `0.2.x` is the first client line that requires attested-provider and execution-evidence
fields from Drone. The HTTP resource path remains v1 because the server response is additive for
tolerant 0.1 clients; security-sensitive consumers should upgrade client and server together.
