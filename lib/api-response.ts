export type ApiError = {
  code: string;
  message: string;
  reason?: string;
  messageEn?: string;
};

export type ApiResponse<T> =
  | { success: true; data: T; error: null }
  | { success: false; data: null; error: ApiError };

export function ok<T extends object>(data: T, init?: ResponseInit): Response {
  // Intentionally spreads `data` after the envelope fields so callers can
  // pass `{ data: items, meta: {...} }` and have `items` and `meta` land at
  // the top of the response body (not nested under `.data`). The `satisfies
  // ApiResponse<T> & T` only verifies the envelope shape — the runtime shape
  // is `{ success, error, ...spread }` with `data: <whatever T's data field
  // is>`. The frontend regulations page relies on this flat shape (reads
  // `body.data` as the items array and `body.meta` as the meta object), so
  // do not "fix" this without updating every `ok()` caller.
  return Response.json({ success: true, data, error: null, ...data } satisfies ApiResponse<T> & T, init);
}

export function fail(error: ApiError, init?: ResponseInit): Response {
  return Response.json({ success: false, data: null, error }, init);
}

export function unwrapApiData<T>(payload: unknown): T | null {
  if (!payload || typeof payload !== "object") return null;
  const response = payload as { success?: unknown; data?: unknown };
  if (response.success === true) return response.data as T;
  return payload as T;
}
