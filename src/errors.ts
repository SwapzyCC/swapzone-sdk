/**
 * Every error this SDK throws extends `SwapzoneError`, so one `instanceof`
 * check catches all of them. Aborting through your own `AbortSignal` is the
 * exception: that rejects with the signal's reason, as `fetch` does.
 */

export class SwapzoneError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SwapzoneError";
  }
}

/**
 * The API refused the request.
 *
 * Swapzone reports most refusals as HTTP 200 with `{"error":true,"message":...}`
 * (an unknown ticker, an amount out of range, a partner that declined the
 * order). Those arrive here with `status` 200. Non-2xx responses arrive here
 * too, with their own status.
 */
export class SwapzoneAPIError extends SwapzoneError {
  /** The HTTP status. Often 200: see above. */
  readonly status: number;
  /** The API's `message`, such as `"ltc currency is not found"`. Undefined when the body had none. */
  readonly apiMessage: string | undefined;
  /** The raw response body, for anything the fields above do not cover. */
  readonly body: string;

  constructor(init: { status: number; apiMessage?: string | undefined; body: string }) {
    const what = init.apiMessage || init.body.slice(0, 200) || "no body";
    super(`Swapzone API ${init.status}: ${what}`);
    this.name = "SwapzoneAPIError";
    this.status = init.status;
    this.apiMessage = init.apiMessage;
    this.body = init.body;
  }
}

/** 401 or 403: the API key is missing, wrong or not allowed to do this. */
export class SwapzoneAuthenticationError extends SwapzoneAPIError {
  constructor(init: ConstructorParameters<typeof SwapzoneAPIError>[0]) {
    super(init);
    this.name = "SwapzoneAuthenticationError";
  }
}

/** 429: over the rate limit and out of retries. */
export class SwapzoneRateLimitError extends SwapzoneAPIError {
  /** How long the API asked to wait, from `Retry-After` or `RateLimit-Reset`. Undefined when it did not say. */
  readonly retryAfterMs: number | undefined;

  constructor(init: ConstructorParameters<typeof SwapzoneAPIError>[0] & { retryAfterMs?: number | undefined }) {
    super(init);
    this.name = "SwapzoneRateLimitError";
    this.retryAfterMs = init.retryAfterMs;
  }
}

/** A request, or a `waitFor()`, ran out of time. */
export class SwapzoneTimeoutError extends SwapzoneError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SwapzoneTimeoutError";
  }
}

/** The request never got an HTTP response: DNS, TLS, a reset connection. `cause` has the original. */
export class SwapzoneConnectionError extends SwapzoneError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SwapzoneConnectionError";
  }
}
