// Types for the roster → steward generator, so the TypeScript tests can import its pure helpers.
export interface CleanLink { label: string; url: string }
export interface CleanProfile {
  slug: string; name: string; role: string; status: string; set: string;
  tagline: string; headline: string; links: CleanLink[]; profile: string | null;
}
export const ROSTER_PATH: string;
export const OUT_PATH: string;
export const EXCLUDED: readonly string[];
export const HAND_WRITTEN: readonly string[];
export function cleanText(value: unknown, max?: number): string;
export function cleanName(value: unknown): string;
export function httpsUrl(value: unknown): string | null;
export function cleanLinks(raw: unknown): CleanLink[];
export function buildProfiles(roster: unknown): CleanProfile[];
export function render(profiles: CleanProfile[]): string;
export function generate(rosterPath?: string): string;
