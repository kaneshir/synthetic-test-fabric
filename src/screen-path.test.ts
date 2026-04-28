import { normalizeScreenPath } from './screen-path';

describe('normalizeScreenPath', () => {
  // Required fixtures from #1530 spec
  it('normalizes array input with mixed case', () => {
    expect(normalizeScreenPath(['seeker', 'jobs', 'Job Detail', 'apply'])).toBe('seeker/jobs/job_detail/apply');
  });

  it('normalizes string input with mixed case', () => {
    expect(normalizeScreenPath('seeker/jobs/Job Detail/apply')).toBe('seeker/jobs/job_detail/apply');
  });

  it('replaces hyphens and special chars with underscores', () => {
    expect(normalizeScreenPath(['jobs', 'Job-Detail!'])).toBe('jobs/job_detail');
  });

  it('returns null for empty array', () => {
    expect(normalizeScreenPath([])).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizeScreenPath('')).toBeNull();
  });

  it('filters empty segments, returns remaining', () => {
    expect(normalizeScreenPath(['', 'jobs', ''])).toBe('jobs');
  });

  // Cross-side agreement: same user action produces identical string from both sides
  it('produces identical output regardless of input form (array vs string)', () => {
    const fromArray = normalizeScreenPath(['seeker', 'profile', 'Edit Profile']);
    const fromString = normalizeScreenPath('seeker/profile/Edit Profile');
    expect(fromArray).toBe(fromString);
  });

  it('returns null for null input', () => {
    expect(normalizeScreenPath(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(normalizeScreenPath(undefined)).toBeNull();
  });

  it('collapses multiple underscores from repeated specials', () => {
    expect(normalizeScreenPath('jobs/Job--Detail!!now')).toBe('jobs/job_detail_now');
  });

  it('strips leading and trailing underscores from each segment', () => {
    expect(normalizeScreenPath(['_jobs_', '  profile  '])).toBe('jobs/profile');
  });
});
