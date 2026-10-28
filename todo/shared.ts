// Kept apart from contract.ts so the app bundle does not pull in zod.

/** Realtime channel the server publishes on after every write. */
export const CHANGED_CHANNEL = "changed";

/** Longest to-do text; the list is single-line notes, not documents. */
export const MAX_TEXT_LENGTH = 2_000;
