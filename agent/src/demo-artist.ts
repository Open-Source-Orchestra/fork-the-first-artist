/**
 * An explicitly fictional artist for offline tests and local demos.
 *
 * This constant exists so tests and scripts do not each hard-code a profile, and so
 * there is exactly one place to change the demo. It mirrors `data/artist.json`, which
 * is what the running server loads; the file is the source of truth for a deployment
 * and this constant is the in-code equivalent for offline tests.
 *
 * Typed as a mutable `ArtistProfile` (not `as const`) so tests can spread it and
 * override a single field — e.g. `{ ...DEMO_ARTIST, consent: false }` to prove the
 * consent gate — without fighting literal types.
 *
 * `consent: true` is an offline fixture value, not evidence of a verified claim.
 * The steward requires literal `true`; the profile loader never uses this
 * fixture as a fallback for missing files or missing consent.
 */
import type { ArtistProfile } from './types.ts';

export const DEMO_ARTIST: ArtistProfile = {
  name: 'Demo Artist',
  bio: 'Fictional profile for local/demo tests only; no real artist activation or verified claim.',
  songs: ['Demo Song'],
  consent: true,
};
