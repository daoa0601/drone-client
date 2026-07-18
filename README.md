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
const artifact = await drone.stageArtifact(bytes, "application/octet-stream");
const job = await drone.submitJob({
  schema_version: "1",
  operation_id: "pe.static_snapshot",
  inputs: { sample: artifact.artifact_id },
});
```

The client also exposes `operations`, `artifact`, `artifactContent`, `jobs`, `job`, and `cancelJob`.
Every JSON response is decoded before it reaches the caller. `DroneClientError.code` distinguishes
invalid local configuration or requests from transport, HTTP, size-limit, and response-contract
failures.

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
names, canonical timestamps, and valid job-state field combinations. These are wire-contract
constants, not imports from Drone's server implementation.

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
