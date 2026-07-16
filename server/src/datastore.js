// Thin façade over the single data layer (db.js — PostgreSQL). Re-exports its full public API as the
// stable import surface every consumer (server.js, reset.js, tests) uses, so db.js's filename or
// internals can change without touching them. (Was a runtime SQLite/Postgres selector — DECISIONS §67.)
export * from './db.js';

// A datastore-level constant (not a db.js export): read by /api/health (server.js) and reset.js's log.
export const backend = 'postgres';
