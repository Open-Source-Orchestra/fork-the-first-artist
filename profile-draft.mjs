// UI limits only. This is not a claim, consent record, or server-side authority.
// Lengths use UTF-16 code units, matching HTML maxlength.
export const DRAFT_LIMITS = Object.freeze({ name: 80, bio: 1200 });

export function validateProfileDraft(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  const bio = typeof source.bio === 'string' ? source.bio.replace(/\r\n?/g, '\n').trim() : '';
  const errors = {};

  if (!name) errors.name = 'Enter your artist name.';
  else if (name.length > DRAFT_LIMITS.name) errors.name = 'Use 80 characters or fewer for your name.';
  else if (/[\u0000-\u001f\u007f]/u.test(name)) errors.name = 'Use a single line without control characters for your name.';

  if (!bio) errors.bio = 'Write a short introduction to your music.';
  else if (bio.length > DRAFT_LIMITS.bio) errors.bio = 'Use 1,200 characters or fewer for your story.';
  else if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(bio)) errors.bio = 'Remove control characters from your story.';

  // Whitelist fields; never carry through consent, claimed status or destinations.
  return Object.keys(errors).length ? { errors, draft: null } : { errors, draft: { name, bio } };
}
