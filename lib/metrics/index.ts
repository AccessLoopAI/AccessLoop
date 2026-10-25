// lib/metrics: the one source of truth for numbers (docs/domain.md §10). Pure and client-safe; the server loaders
// are lib/metrics/load.ts and lib/metrics/dashboard.ts (import them directly from server code). API: lib/metrics/README.md.
export * from "./compute";
export * from "./dashboard-period";
export * from "./deadline";
export * from "./filters";
export * from "./format";
export * from "./period";
export * from "./predicates";
export * from "./queue";
export * from "./replay";
