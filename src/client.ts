import { createHash } from "node:crypto";

import {
  decodeDroneArtifactMetadata,
  decodeDroneJob,
  decodeDroneJobs,
  decodeDroneJobSubmission,
  decodeDroneProviderStatuses,
  decodeDronePublicOperations,
  DRONE_V1_LIMITS,
  isDroneArtifactId,
  isDroneJobId,
  normalizeDroneMediaType,
} from "./contracts.js";
import type {
  DroneArtifactMetadata,
  DroneJob,
  DroneJobSubmission,
  DroneProviderStatus,
  DronePublicOperation,
} from "./contracts.js";
import { DroneClientError } from "./errors.js";

export interface DroneResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: Pick<Headers, "get">;
  readonly body: ReadableStream<Uint8Array> | null;
}

export type DroneFetch = (input: string | URL, init?: RequestInit) => Promise<DroneResponse>;

export interface DroneClientOptions {
  readonly baseUrl: string;
  readonly token?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxArtifactResponseBytes?: number;
  readonly fetch?: DroneFetch;
}

export interface DroneCallOptions {
  readonly signal?: AbortSignal;
}

export interface DroneArtifactDownload {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 128 * 1024;
const DEFAULT_MAX_ARTIFACT_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_CONFIGURED_BYTES = DRONE_V1_LIMITS.maxArtifactBytes;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/u;
const TERMINAL_JOB_STATUSES = new Set<DroneJob["status"]>([
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);

function loopback(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "localhost"
  );
}

export function decodeDroneBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new DroneClientError({
      code: "INVALID_BASE_URL",
      message: "Drone base URL must be an absolute URL.",
      cause,
    });
  }
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback(url.hostname))) ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new DroneClientError({
      code: "INVALID_BASE_URL",
      message: "Drone base URL must be loopback HTTP or HTTPS without credentials or a path.",
    });
  }
  return url;
}

function positiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new DroneClientError({
      code: "INVALID_REQUEST",
      message: `${label} must be a positive integer no greater than ${maximum}.`,
    });
  }
  return value;
}

function validToken(value: string): string {
  if (value.length === 0 || value.length > 8192 || /[\r\n]/u.test(value)) {
    throw new DroneClientError({
      code: "INVALID_REQUEST",
      message: "Drone bearer token is invalid.",
    });
  }
  return value;
}

function validArtifactId(value: string): string {
  if (!isDroneArtifactId(value)) {
    throw new DroneClientError({
      code: "INVALID_REQUEST",
      message: "Drone artifact ID is invalid.",
    });
  }
  return value;
}

function validJobId(value: string): string {
  if (!isDroneJobId(value)) {
    throw new DroneClientError({ code: "INVALID_REQUEST", message: "Drone job ID is invalid." });
  }
  return value;
}

function invalidCorrelation(message: string): DroneClientError {
  return new DroneClientError({ code: "INVALID_RESPONSE", message });
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sameArtifactInputs(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([slot, artifactId]) => Object.hasOwn(right, slot) && right[slot] === artifactId,
    )
  );
}

function cancelBody(body: DroneResponse["body"]): void {
  if (body === null) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // Cleanup must never replace the response validation error.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // Cleanup must never replace the response validation or deadline error.
  }
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    // A non-compliant reader may remain locked after cancellation; the deadline still wins.
  }
}

async function boundedResponseBody(
  response: Pick<DroneResponse, "headers" | "body">,
  maximum: number,
  signal: AbortSignal,
): Promise<Buffer> {
  let declaredBytes: number | undefined;
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^[0-9]+$/u.test(declared)) {
      cancelBody(response.body);
      throw new DroneClientError({
        code: "INVALID_RESPONSE",
        message: "Drone response Content-Length is invalid.",
      });
    }
    declaredBytes = Number(declared);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maximum) {
      cancelBody(response.body);
      throw new DroneClientError({
        code: "RESPONSE_TOO_LARGE",
        message: "Drone response exceeded its configured limit.",
      });
    }
  }
  const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
  if (encoding !== undefined && encoding !== "identity") {
    cancelBody(response.body);
    throw new DroneClientError({
      code: "INVALID_RESPONSE",
      message: "Compressed Drone responses are not accepted.",
    });
  }
  if (response.body === null) {
    if (declaredBytes !== undefined && declaredBytes !== 0) {
      throw new DroneClientError({
        code: "INVALID_RESPONSE",
        message: "Drone response length does not match Content-Length.",
      });
    }
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Array<Buffer> = [];
  let total = 0;
  let cancellationRequested = false;
  const cancel = (): void => {
    if (cancellationRequested) return;
    cancellationRequested = true;
    cancelReader(reader);
  };
  let rejectAborted: (reason: unknown) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });
  const onAbort = (): void => {
    cancel();
    rejectAborted(signal.reason);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) onAbort();

  try {
    for (;;) {
      const read = reader.read();
      void read.catch(() => undefined);
      const next = await Promise.race([read, aborted]);
      if (next.done) break;
      const chunk = Buffer.from(next.value);
      total += chunk.byteLength;
      if (total > maximum) {
        cancel();
        throw new DroneClientError({
          code: "RESPONSE_TOO_LARGE",
          message: "Drone response exceeded its configured limit.",
        });
      }
      if (declaredBytes !== undefined && total > declaredBytes) {
        cancel();
        throw new DroneClientError({
          code: "INVALID_RESPONSE",
          message: "Drone response length exceeds Content-Length.",
        });
      }
      chunks.push(chunk);
    }
  } catch (cause) {
    cancel();
    throw cause;
  } finally {
    signal.removeEventListener("abort", onAbort);
    releaseReader(reader);
  }

  if (declaredBytes !== undefined && total !== declaredBytes) {
    cancel();
    throw new DroneClientError({
      code: "INVALID_RESPONSE",
      message: "Drone response length does not match Content-Length.",
    });
  }
  return Buffer.concat(chunks, total);
}

export class DroneClient {
  readonly #baseUrl: URL;
  readonly #token: string | undefined;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #maxArtifactResponseBytes: number;
  readonly #fetch: DroneFetch;

  constructor(options: DroneClientOptions) {
    this.#baseUrl = decodeDroneBaseUrl(options.baseUrl);
    this.#token = options.token === undefined ? undefined : validToken(options.token);
    this.#timeoutMs = positiveInteger(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "Drone timeoutMs",
      3_600_000,
    );
    this.#maxResponseBytes = positiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "Drone maxResponseBytes",
      MAX_CONFIGURED_BYTES,
    );
    this.#maxArtifactResponseBytes = positiveInteger(
      options.maxArtifactResponseBytes ?? DEFAULT_MAX_ARTIFACT_RESPONSE_BYTES,
      "Drone maxArtifactResponseBytes",
      MAX_CONFIGURED_BYTES,
    );
    this.#fetch = options.fetch ?? fetch;
  }

  async providers(options: DroneCallOptions = {}): Promise<ReadonlyArray<DroneProviderStatus>> {
    return decodeDroneProviderStatuses(
      await this.#json("/v1/providers", { method: "GET" }, options),
    );
  }

  async operations(options: DroneCallOptions = {}): Promise<ReadonlyArray<DronePublicOperation>> {
    return decodeDronePublicOperations(
      await this.#json("/v1/operations", { method: "GET" }, options),
    );
  }

  async stageArtifact(
    bytes: Uint8Array,
    mediaType: string,
    options: DroneCallOptions = {},
  ): Promise<DroneArtifactMetadata> {
    if (bytes.byteLength === 0 || bytes.byteLength > DRONE_V1_LIMITS.maxArtifactBytes) {
      throw new DroneClientError({
        code: "INVALID_REQUEST",
        message: `Drone artifact must contain 1-${DRONE_V1_LIMITS.maxArtifactBytes} bytes.`,
      });
    }
    const normalizedType = normalizeDroneMediaType(mediaType);
    const digest = sha256(bytes);
    const value = await this.#json(
      "/v1/artifacts",
      {
        method: "POST",
        headers: { "Content-Type": normalizedType },
        body: Buffer.from(bytes),
      },
      options,
    );
    const metadata = decodeDroneArtifactMetadata(value);
    if (
      metadata.artifact_id !== `sha256_${digest}` ||
      metadata.sha256 !== digest ||
      metadata.size_bytes !== bytes.byteLength ||
      metadata.media_type !== normalizedType
    ) {
      throw invalidCorrelation("Drone artifact response does not match the staged bytes.");
    }
    return metadata;
  }

  async artifact(
    artifactId: string,
    options: DroneCallOptions = {},
  ): Promise<DroneArtifactMetadata> {
    const id = validArtifactId(artifactId);
    const metadata = decodeDroneArtifactMetadata(
      await this.#json(`/v1/artifacts/${id}`, { method: "GET" }, options),
    );
    if (metadata.artifact_id !== id) {
      throw invalidCorrelation("Drone artifact response does not match the requested artifact.");
    }
    return metadata;
  }

  async artifactContent(
    artifactId: string,
    options: DroneCallOptions = {},
  ): Promise<DroneArtifactDownload> {
    const id = validArtifactId(artifactId);
    return this.#withDeadline(options, async (signal) => {
      const response = await this.#response(
        `/v1/artifacts/${id}/content`,
        { method: "GET" },
        signal,
      );
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType === undefined || !MEDIA_TYPE.test(contentType)) {
        cancelBody(response.body);
        throw new DroneClientError({
          code: "INVALID_RESPONSE",
          message: "Drone artifact response has an invalid Content-Type.",
        });
      }
      const bytes = await boundedResponseBody(response, this.#maxArtifactResponseBytes, signal);
      if (sha256(bytes) !== id.slice("sha256_".length)) {
        throw invalidCorrelation("Drone artifact bytes do not match the requested sha256 ID.");
      }
      return { bytes, mediaType: contentType };
    });
  }

  async submitJob(input: DroneJobSubmission, options: DroneCallOptions = {}): Promise<DroneJob> {
    const submission = decodeDroneJobSubmission(input);
    const value = await this.#json(
      "/v1/jobs",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission),
      },
      options,
    );
    const job = decodeDroneJob(value);
    if (
      job.status !== "queued" ||
      job.operation_id !== submission.operation_id ||
      !sameArtifactInputs(job.inputs, submission.inputs)
    ) {
      throw invalidCorrelation("Drone job response does not match the submitted job.");
    }
    return job;
  }

  async jobs(options: DroneCallOptions = {}): Promise<ReadonlyArray<DroneJob>> {
    return decodeDroneJobs(await this.#json("/v1/jobs", { method: "GET" }, options));
  }

  async job(jobId: string, options: DroneCallOptions = {}): Promise<DroneJob> {
    const id = validJobId(jobId);
    const job = decodeDroneJob(await this.#json(`/v1/jobs/${id}`, { method: "GET" }, options));
    if (job.job_id !== id) {
      throw invalidCorrelation("Drone job response does not match the requested job.");
    }
    return job;
  }

  async cancelJob(jobId: string, options: DroneCallOptions = {}): Promise<DroneJob> {
    const id = validJobId(jobId);
    const job = decodeDroneJob(
      await this.#json(`/v1/jobs/${id}/cancel`, { method: "POST" }, options),
    );
    if (job.job_id !== id || !TERMINAL_JOB_STATUSES.has(job.status)) {
      throw invalidCorrelation("Drone cancellation response does not match the requested job.");
    }
    return job;
  }

  async #json(pathname: string, init: RequestInit, options: DroneCallOptions): Promise<unknown> {
    return this.#withDeadline(options, async (signal) => {
      const response = await this.#response(pathname, init, signal);
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/json") {
        cancelBody(response.body);
        throw new DroneClientError({
          code: "INVALID_RESPONSE",
          message: "Drone response is not JSON.",
        });
      }
      const bytes = await boundedResponseBody(response, this.#maxResponseBytes, signal);
      try {
        return JSON.parse(bytes.toString("utf8")) as unknown;
      } catch (cause) {
        throw new DroneClientError({
          code: "INVALID_RESPONSE",
          message: "Drone response is not valid JSON.",
          cause,
        });
      }
    });
  }

  async #response(
    pathname: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<DroneResponse> {
    if (signal.aborted) throw signal.reason;
    const headers = new Headers(init.headers);
    headers.set("Accept-Encoding", "identity");
    if (this.#token !== undefined) headers.set("Authorization", `Bearer ${this.#token}`);
    let response: DroneResponse;
    try {
      response = await this.#fetch(new URL(pathname, this.#baseUrl), {
        ...init,
        headers,
        redirect: "error",
        signal,
      });
    } catch (cause) {
      if (cause instanceof DroneClientError) throw cause;
      throw new DroneClientError({
        code: "REQUEST_FAILED",
        message: "Drone request failed before a response was received.",
        cause,
      });
    }
    if (signal.aborted) {
      cancelBody(response.body);
      throw signal.reason;
    }
    if (!response.ok) {
      cancelBody(response.body);
      throw new DroneClientError({
        code: "HTTP_ERROR",
        message: `Drone request failed with HTTP ${response.status}.`,
        status: response.status,
      });
    }
    return response;
  }

  async #withDeadline<A>(
    options: DroneCallOptions,
    operation: (signal: AbortSignal) => Promise<A>,
  ): Promise<A> {
    const controller = new AbortController();
    let timedOut = false;
    let rejectDeadline: (error: DroneClientError) => void = () => undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const rejectOnAbort = (): void => {
      rejectDeadline(
        new DroneClientError({
          code: "REQUEST_FAILED",
          message: timedOut ? "Drone request timed out." : "Drone request was aborted.",
          cause: controller.signal.reason,
        }),
      );
    };
    controller.signal.addEventListener("abort", rejectOnAbort, { once: true });

    const forwardAbort = (): void => controller.abort(options.signal?.reason);
    if (options.signal?.aborted === true) forwardAbort();
    else options.signal?.addEventListener("abort", forwardAbort, { once: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Drone request deadline exceeded."));
    }, this.#timeoutMs);

    const pending = Promise.resolve()
      .then(() => operation(controller.signal))
      .catch((cause: unknown) => {
        if (cause instanceof DroneClientError) throw cause;
        throw new DroneClientError({
          code: "REQUEST_FAILED",
          message: controller.signal.aborted
            ? "Drone request was aborted."
            : "Drone request failed.",
          cause,
        });
      });
    void pending.catch(() => undefined);

    try {
      return await Promise.race([pending, deadline]);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", rejectOnAbort);
      options.signal?.removeEventListener("abort", forwardAbort);
    }
  }
}
