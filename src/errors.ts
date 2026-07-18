export type DroneClientErrorCode =
  | "HTTP_ERROR"
  | "INVALID_BASE_URL"
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE"
  | "REQUEST_FAILED"
  | "RESPONSE_TOO_LARGE";

export class DroneClientError extends Error {
  readonly code: DroneClientErrorCode;
  readonly status: number | undefined;

  constructor(options: {
    readonly code: DroneClientErrorCode;
    readonly message: string;
    readonly status?: number;
    readonly cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "DroneClientError";
    this.code = options.code;
    this.status = options.status;
  }
}

export function invalidRequest(message: string, cause?: unknown): DroneClientError {
  return new DroneClientError({ code: "INVALID_REQUEST", message, cause });
}

export function invalidResponse(message: string, cause?: unknown): DroneClientError {
  return new DroneClientError({ code: "INVALID_RESPONSE", message, cause });
}
