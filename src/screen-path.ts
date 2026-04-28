/**
 * Canonical screen path normalizer — single source of truth for both sim-side recorder
 * and browser-side explorer. Both import from this module. Duplication is forbidden.
 *
 * Stored type: TEXT, e.g. "seeker/jobs/job_detail/apply"
 * Input may be a string ("seeker/jobs/Job Detail/apply") or array (["seeker","jobs","Job Detail","apply"]).
 * Returns null for empty / null / undefined inputs.
 */
export function normalizeScreenPath(input: string | string[] | null | undefined): string | null {
  if (!input) return null;
  const parts = Array.isArray(input) ? input : input.split('/');
  const normalized = parts
    .map(p =>
      p
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
    )
    .filter(Boolean);
  return normalized.length > 0 ? normalized.join('/') : null;
}
