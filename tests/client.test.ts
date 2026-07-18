import { describe, expect, it, vi } from "vitest";

import { decodeDroneBaseUrl, DroneClient } from "../src/index.js";
import {
  ARTIFACT_ID,
  ARTIFACT_SHA256,
  artifactMetadata,
  JOB_ID,
  job,
  PROVIDER_ATTESTATION_ID,
  providerStatus,
  publicOperation,
} from "./fixtures.js";

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("DroneClient", () => {
  it("allows only loopback HTTP or pathless HTTPS base URLs", () => {
    expect(decodeDroneBaseUrl("http://127.0.0.1:8090").origin).toBe("http://127.0.0.1:8090");
    expect(decodeDroneBaseUrl("http://[::1]:8090").origin).toBe("http://[::1]:8090");
    expect(decodeDroneBaseUrl("https://drone.example").origin).toBe("https://drone.example");
    expect(() => decodeDroneBaseUrl("relative/path")).toThrowError(
      expect.objectContaining({ code: "INVALID_BASE_URL" }),
    );
    expect(() => decodeDroneBaseUrl("http://drone.example")).toThrow(/loopback HTTP/iu);
    expect(() => decodeDroneBaseUrl("https://user:secret@drone.example")).toThrow();
    expect(() => decodeDroneBaseUrl("https://drone.example/api")).toThrow();
    expect(() => decodeDroneBaseUrl("https://drone.example?tenant=one")).toThrow();
  });

  it("authenticates, rejects redirects, and decodes provider and operation responses", async () => {
    const request = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer local-token");
      expect(new Headers(init?.headers).get("accept-encoding")).toBe("identity");
      expect(init?.redirect).toBe("error");
      const pathname = new URL(input).pathname;
      if (pathname === "/v1/providers") return json([providerStatus()]);
      if (pathname === "/v1/operations") return json([publicOperation()]);
      throw new Error(`Unexpected path: ${pathname}`);
    });
    const client = new DroneClient({
      baseUrl: "http://127.0.0.1:8090",
      token: "local-token",
      timeoutMs: 100,
      fetch: request,
    });

    await expect(client.providers()).resolves.toEqual([providerStatus()]);
    await expect(client.operations()).resolves.toEqual([publicOperation()]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("stages, inspects, and downloads artifacts through bounded routes", async () => {
    const request = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const pathname = new URL(input).pathname;
      if (pathname === "/v1/artifacts" && init?.method === "POST") {
        expect(new Headers(init.headers).get("content-type")).toBe("application/octet-stream");
        expect(Buffer.from(init.body as Uint8Array).toString("utf8")).toBe("specimen");
        return json(artifactMetadata(), { status: 201 });
      }
      if (pathname.endsWith("/content")) {
        return new Response("specimen", {
          headers: { "Content-Type": "application/octet-stream" },
        });
      }
      return json(artifactMetadata());
    });
    const client = new DroneClient({
      baseUrl: "http://127.0.0.1:8090",
      fetch: request,
      maxArtifactResponseBytes: 32,
    });

    await expect(
      client.stageArtifact(Buffer.from("specimen"), "Application/Octet-Stream"),
    ).resolves.toEqual(artifactMetadata());
    await expect(client.artifact(ARTIFACT_ID)).resolves.toEqual(artifactMetadata());
    await expect(client.artifactContent(ARTIFACT_ID)).resolves.toEqual({
      bytes: Buffer.from("specimen"),
      mediaType: "application/octet-stream",
    });
    await expect(client.artifact("mutable-name")).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(
      client.stageArtifact(new Uint8Array(), "application/octet-stream"),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
  });

  it("submits, lists, inspects, and cancels jobs with runtime validation", async () => {
    const request = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const pathname = new URL(input).pathname;
      if (pathname === "/v1/jobs" && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({
          schema_version: "1",
          operation_id: "pe.static_snapshot",
          provider_attestation_id: PROVIDER_ATTESTATION_ID,
          inputs: { sample: ARTIFACT_ID },
        });
        return json(job(), { status: 202 });
      }
      if (pathname === "/v1/jobs") return json([job()]);
      if (pathname.endsWith("/cancel")) return json(job({ status: "cancelled" }));
      return json(job());
    });
    const client = new DroneClient({ baseUrl: "http://localhost:8090", fetch: request });

    await expect(
      client.submitJob({
        schema_version: "1",
        operation_id: "pe.static_snapshot",
        provider_attestation_id: PROVIDER_ATTESTATION_ID,
        inputs: { sample: ARTIFACT_ID },
      }),
    ).resolves.toEqual(job());
    await expect(client.jobs()).resolves.toEqual([job()]);
    await expect(client.job(JOB_ID)).resolves.toEqual(job());
    await expect(client.cancelJob(JOB_ID)).resolves.toEqual(job({ status: "cancelled" }));
    await expect(client.job("job_latest")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      client.submitJob({
        schema_version: "1",
        operation_id: "../escape",
        provider_attestation_id: PROVIDER_ATTESTATION_ID,
        inputs: {},
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("binds artifact and job responses to the originating request", async () => {
    const otherArtifact = `sha256_${"c".repeat(64)}`;
    const otherJob = `job_${"d".repeat(32)}`;
    const client = (response: unknown): DroneClient =>
      new DroneClient({
        baseUrl: "http://127.0.0.1:8090",
        fetch: async () => json(response),
      });

    await expect(
      client(
        artifactMetadata({
          artifact_id: otherArtifact,
          sha256: "c".repeat(64),
        }),
      ).stageArtifact(Buffer.from("specimen"), "application/octet-stream"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      client(
        artifactMetadata({
          artifact_id: otherArtifact,
          sha256: "c".repeat(64),
        }),
      ).artifact(ARTIFACT_ID),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      client(job({ inputs: {} })).submitJob({
        schema_version: "1",
        operation_id: "pe.static_snapshot",
        provider_attestation_id: PROVIDER_ATTESTATION_ID,
        inputs: { sample: ARTIFACT_ID },
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(client(job({ job_id: otherJob })).job(JOB_ID)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    await expect(
      client(job({ job_id: otherJob, status: "cancelled" })).cancelJob(JOB_ID),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(client(job({ status: "running" })).cancelJob(JOB_ID)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("hashes downloaded artifact bytes against the requested content address", async () => {
    expect(ARTIFACT_ID).toBe(`sha256_${ARTIFACT_SHA256}`);
    const client = new DroneClient({
      baseUrl: "http://127.0.0.1:8090",
      fetch: async () =>
        new Response("tampered", {
          headers: { "Content-Type": "application/octet-stream" },
        }),
    });
    await expect(client.artifactContent(ARTIFACT_ID)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it.each([
    ["HTTP error", new Response(null, { status: 503 }), "HTTP_ERROR"],
    [
      "wrong content type",
      new Response("{}", { headers: { "Content-Type": "text/plain" } }),
      "INVALID_RESPONSE",
    ],
    [
      "declared oversized response",
      new Response("[]", {
        headers: { "Content-Type": "application/json", "Content-Length": "999999" },
      }),
      "RESPONSE_TOO_LARGE",
    ],
    [
      "compressed response",
      new Response("[]", {
        headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
      }),
      "INVALID_RESPONSE",
    ],
    [
      "invalid JSON",
      new Response("not-json", { headers: { "Content-Type": "application/json" } }),
      "INVALID_RESPONSE",
    ],
  ])("fails closed on %s", async (_label, response, code) => {
    const client = new DroneClient({
      baseUrl: "http://127.0.0.1:8090",
      maxResponseBytes: 32,
      fetch: async () => response,
    });
    await expect(client.providers()).rejects.toMatchObject({ code });
  });

  it("bounds streamed bodies even without Content-Length", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.alloc(20));
        controller.enqueue(Buffer.alloc(20));
        controller.close();
      },
    });
    const client = new DroneClient({
      baseUrl: "http://127.0.0.1:8090",
      maxResponseBytes: 32,
      fetch: async () => new Response(body, { headers: { "Content-Type": "application/json" } }),
    });
    await expect(client.providers()).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it.each([
    ["short", "[]", "3"],
    ["long", "[]", "1"],
  ])("rejects %s bodies that disagree with Content-Length", async (_label, body, length) => {
    const client = new DroneClient({
      baseUrl: "http://127.0.0.1:8090",
      fetch: async () =>
        new Response(body, {
          headers: { "Content-Type": "application/json", "Content-Length": length },
        }),
    });
    await expect(client.providers()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("cancels response bodies on status and header rejection without masking the primary error", async () => {
    const cases = [
      {
        expected: "HTTP_ERROR",
        response: { ok: false, status: 503, headers: new Headers() },
      },
      {
        expected: "INVALID_RESPONSE",
        response: {
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Type": "text/plain" }),
        },
      },
      {
        expected: "INVALID_RESPONSE",
        response: {
          ok: true,
          status: 200,
          headers: new Headers({
            "Content-Type": "application/json",
            "Content-Length": "invalid",
          }),
        },
      },
      {
        expected: "INVALID_RESPONSE",
        response: {
          ok: true,
          status: 200,
          headers: new Headers({
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
          }),
        },
      },
    ] as const;

    for (const testCase of cases) {
      const cancel = vi.fn(async () => {
        throw new Error("cleanup failure must be suppressed");
      });
      const body = { cancel } as unknown as ReadableStream<Uint8Array>;
      const client = new DroneClient({
        baseUrl: "http://127.0.0.1:8090",
        fetch: async () => ({ ...testCase.response, body }),
      });
      await expect(client.providers()).rejects.toMatchObject({ code: testCase.expected });
      expect(cancel).toHaveBeenCalledOnce();
    }
  });

  it("turns fetch failures, timeouts, and caller cancellation into transport errors", async () => {
    const failed = new DroneClient({
      baseUrl: "http://127.0.0.1:8090",
      fetch: async () => {
        throw new Error("socket details must remain in cause");
      },
    });
    await expect(failed.providers()).rejects.toMatchObject({ code: "REQUEST_FAILED" });

    const hangingFetch = async (): Promise<Response> => new Promise(() => undefined);
    const timed = new DroneClient({
      baseUrl: "http://127.0.0.1:8090",
      timeoutMs: 5,
      fetch: hangingFetch,
    });
    const started = Date.now();
    await expect(timed.providers()).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      message: "Drone request timed out.",
    });
    expect(Date.now() - started).toBeLessThan(250);

    const controller = new AbortController();
    controller.abort(new Error("caller cancelled"));
    const cancelled = new DroneClient({
      baseUrl: "http://127.0.0.1:8090",
      fetch: hangingFetch,
    });
    await expect(cancelled.providers({ signal: controller.signal })).rejects.toMatchObject({
      code: "REQUEST_FAILED",
    });
  });

  it("enforces its deadline and cancels a body reader even when the transport ignores abort", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const reader = {
      read: () => new Promise<never>(() => undefined),
      cancel,
      releaseLock: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;
    const body = {
      getReader: () => reader,
      cancel: vi.fn(() => new Promise<void>(() => undefined)),
    } as unknown as ReadableStream<Uint8Array>;
    const client = new DroneClient({
      baseUrl: "http://127.0.0.1:8090",
      timeoutMs: 10,
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ "Content-Type": "application/json" }),
        body,
      }),
    });

    const started = Date.now();
    await expect(client.providers()).rejects.toMatchObject({
      code: "REQUEST_FAILED",
      message: "Drone request timed out.",
    });
    expect(Date.now() - started).toBeLessThan(250);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects unsafe client configuration", () => {
    expect(() => new DroneClient({ baseUrl: "http://127.0.0.1", token: "" })).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
    expect(() => new DroneClient({ baseUrl: "http://127.0.0.1", timeoutMs: 0 })).toThrow();
    expect(
      () => new DroneClient({ baseUrl: "http://127.0.0.1", maxResponseBytes: 2 ** 40 }),
    ).toThrow();
  });
});
