/**
 * lib/rag-client/index.ts — barrel export.
 */
export * from "@/lib/rag-client/client";
export * from "@/lib/rag-client/errors";
export * from "@/lib/rag-client/response-schemas";
export * from "@/lib/rag-client/report-package-schema";

// Re-export generated types for convenience. The OpenAPI snapshot these are
// derived from is pinned at lib/rag-client/openapi.snapshot.json.
// To regenerate: `npm run codegen:rag-types`.
export type { paths, components, operations } from "@/lib/rag-client/types.gen";
