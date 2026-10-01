/**
 * The HTTP layer every resource goes through: authentication, timeouts,
 * retries and error mapping. Internal; the public surface is `Swapzone` and
 * its resources.
 */

import {
  SwapzoneAPIError,
  SwapzoneAuthenticationError,
  SwapzoneConnectionError,
  SwapzoneError,
  SwapzoneRateLimitError,
  SwapzoneTimeoutError,
} from "./errors.js";
import { VERSION } from "./version.js";

/** Options any single call accepts as its last argument. They override the client's for that call. */
export interface RequestOptions {
  /** Aborts the request, including any wait between retries. */
  signal?: AbortSignal;
  /** Per attempt, in milliseconds. */
  timeoutMs?: number;
  /** Retries after the first attempt. `0` disables them. */
  maxRetries?: number;
  /** Extra headers for this call. */
  headers?: Record<string, string>;
}

export interface TransportConfig {
  apiKey: string;
  baseUrl: string;
  fetch: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
  headers: Record<string, string>;
}

export type QueryValue = string | number | boolean | Date | readonly unknown[] | object | null | undefined;

export interface RequestSpec {
  method: "GET" | "POST";
  /** Starts with `/v1/`. */
  path: string;
  query?: Record<string, QueryValue> | undefined;
  body?: unknown;
  /**
   * Whether repeating the request is harmless. Only then are 5xx responses,
   * timeouts and dropped connections retried: any of those could have
   * happened after the server acted. A 429 is always retried, because a
   * rate-limited request was never processed.
   */
  idempotent: boolean;
  options?: RequestOptions | undefined;
}

/** A wait beyond this is not sat out; the 429 is thrown instead. */
const MAX_RETRY_AFTER_MS = 60_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;

export class Transport {
  constructor(private readonly config: TransportConfig) {}

  async request<T>(spec: RequestSpec): Promise<T> {
    const maxRetries = spec.options?.maxRetries ?? this.config.maxRetries;

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.send<T>(spec);
      } catch (error) {
        const delay = attempt < maxRetries ? retryDelay(error, spec.idempotent, attempt) : undefined;
        if (delay === undefined) throw error;
        await sleep(delay, spec.options?.signal);
      }
    }
  }

  private async send<T>(spec: RequestSpec): Promise<T> {
    const { config } = this;
    const signal = spec.options?.signal;
    signal?.throwIfAborted();

    // `set` replaces case-insensitively, so later layers win and no caller
    // header can replace the key.
    const headers = new Headers({ Accept: "application/json", "User-Agent": `swapzone-sdk-js/${VERSION}` });
    for (const layer of [config.headers, spec.options?.headers]) {
      for (const [name, value] of Object.entries(layer ?? {})) headers.set(name, value);
    }
    headers.set("x-api-key", config.apiKey);
    if (spec.body !== undefined) headers.set("Content-Type", "application/json");

    const timeoutMs = spec.options?.timeoutMs ?? config.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const forwardAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", forwardAbort, { once: true });

    let response: Response;
    let text: string;
    try {
      response = await config.fetch(buildUrl(config.baseUrl, spec.path, spec.query), {
        method: spec.method,
        headers,
        body: spec.body === undefined ? null : JSON.stringify(spec.body),
        signal: controller.signal,
      });
      // Reading the body is part of the attempt: the timeout covers it too.
      text = await response.text();
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (timedOut) {
        throw new SwapzoneTimeoutError(`${spec.method} ${spec.path} timed out after ${timeoutMs} ms`, { cause: error });
      }
      throw new SwapzoneConnectionError(`${spec.method} ${spec.path} failed: ${describe(error)}`, { cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forwardAbort);
    }

    if (!response.ok) throw toApiError(response, text);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new SwapzoneError(`Swapzone returned a ${response.status} that is not JSON: ${text.slice(0, 200)}`, {
        cause: error,
      });
    }

    // Swapzone answers most refusals with a 200 and this shape.
    if (isRecord(parsed) && parsed.error === true) {
      throw new SwapzoneAPIError({
        status: response.status,
        apiMessage: typeof parsed.message === "string" ? parsed.message : undefined,
        body: text,
      });
    }
    return parsed as T;
  }
}

export const DEFAULTS = {
  baseUrl: "https://api.swapzone.io",
  timeoutMs: 30_000,
  maxRetries: 2,
} as const;

export function buildUrl(baseUrl: string, path: string, query: RequestSpec["query"]): string {
  const url = new URL(baseUrl.replace(/\/+$/, "") + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    let text: string;
    if (value instanceof Date) text = value.toISOString();
    else if (typeof value === "number") text = decimalString(value);
    // `adapterList` and `routeId` travel as JSON in the query string.
    else if (typeof value === "object") text = JSON.stringify(value);
    else text = String(value);
    url.searchParams.set(key, text);
  }
  return url.toString();
}

/**
 * A number as plain decimal digits. `String(1e-7)` is `"1e-7"`, which the
 * API rejects as an amount.
 */
export function decimalString(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Not a finite number: ${value}`);
  const text = String(value);
  if (!/e/i.test(text)) return text;
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
}

function toApiError(response: Response, text: string): SwapzoneAPIError {
  let apiMessage: string | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && typeof parsed.message === "string") apiMessage = parsed.message;
  } catch {
    // A 401 is plain text ("Access denied"); a proxy's error page is HTML.
    const trimmed = text.trim();
    if (trimmed !== "" && trimmed.length <= 200 && !trimmed.startsWith("<")) apiMessage = trimmed;
  }

  const init = { status: response.status, apiMessage, body: text };
  if (response.status === 429) {
    return new SwapzoneRateLimitError({ ...init, retryAfterMs: retryAfterFrom(response.headers) });
  }
  if (response.status === 401 || response.status === 403) return new SwapzoneAuthenticationError(init);
  return new SwapzoneAPIError(init);
}

/** How long a 429 asked to wait: `Retry-After` when sent, else `RateLimit-Reset`. */
function retryAfterFrom(headers: Headers, now = Date.now()): number | undefined {
  return parseRetryAfter(headers.get("retry-after"), now) ?? parseRateLimitReset(headers.get("ratelimit-reset"), now);
}

/** `Retry-After` as milliseconds from now: plain seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.ceil(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

/**
 * `RateLimit-Reset` as milliseconds from now. Swapzone sends a Unix time in
 * seconds; the IETF draft header is seconds from now. Anything past 1e9 can
 * only be the former.
 */
export function parseRateLimitReset(value: string | null, now = Date.now()): number | undefined {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  const seconds = Number(value.trim());
  return seconds > 1e9 ? Math.max(0, seconds * 1000 - now) : seconds * 1000;
}

/** How long to wait before retrying `error`, or `undefined` to give up. */
function retryDelay(error: unknown, idempotent: boolean, attempt: number): number | undefined {
  if (error instanceof SwapzoneRateLimitError) {
    if (error.retryAfterMs === undefined) return backoff(attempt);
    return error.retryAfterMs <= MAX_RETRY_AFTER_MS ? error.retryAfterMs : undefined;
  }
  if (!idempotent) return undefined;
  if (error instanceof SwapzoneAPIError) {
    return error.status >= 500 || error.status === 408 ? backoff(attempt) : undefined;
  }
  if (error instanceof SwapzoneTimeoutError || error instanceof SwapzoneConnectionError) return backoff(attempt);
  return undefined;
}

/** Exponential backoff with full jitter: 0-0.5 s, then 0-1 s, 0-2 s, ... up to 8 s. */
function backoff(attempt: number): number {
  return Math.random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (${error.cause.message})` : "";
    return error.message + cause;
  }
  return String(error);
}
