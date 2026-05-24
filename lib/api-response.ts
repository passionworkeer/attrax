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
