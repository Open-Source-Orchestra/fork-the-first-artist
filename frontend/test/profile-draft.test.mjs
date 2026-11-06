import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProfileDraft, DRAFT_LIMITS } from '../public/profile-draft.mjs';

test('draft accepts international names and multiline stories, retaining only editable fields', () => {
  const result = validateProfileDraft({
    name: '  ʻOhana संगीत 🌺  ', bio: '  First line\r\nSecond line  ',
    consent: true, claimed: true, hederaAccount: '0.0.123', ensName: 'someone.eth',
  });
  assert.deepEqual(result, { errors: {}, draft: { name: 'ʻOhana संगीत 🌺', bio: 'First line\nSecond line' } });
});

test('empty or malformed drafts return field errors without a usable draft', () => {
  for (const input of [null, [], undefined, {}, { name: 1, bio: false }, { name: '  ', bio: '\n\t' }]) {
    const result = validateProfileDraft(input);
    assert.equal(result.draft, null);
    assert.deepEqual(Object.keys(result.errors), ['name', 'bio']);
  }
});

test('length limits match HTML capacity and never silently truncate', () => {
  const maximum = { name: 'n'.repeat(DRAFT_LIMITS.name), bio: 'b'.repeat(DRAFT_LIMITS.bio) };
  assert.deepEqual(validateProfileDraft(maximum).draft, maximum);
  const invalid = validateProfileDraft({ name: maximum.name + 'n', bio: maximum.bio + 'b' });
  assert.equal(invalid.draft, null);
  assert.deepEqual(Object.keys(invalid.errors), ['name', 'bio']);
  assert.ok(validateProfileDraft({ name: '🌺'.repeat(41), bio: 'Music' }).errors.name);
});

test('rejects embedded controls without excluding ordinary punctuation or bio line breaks', () => {
  for (const name of ['one\ntwo', 'one\ttwo', 'one\u0000two']) {
    assert.ok(validateProfileDraft({ name, bio: 'Music' }).errors.name);
  }
  assert.ok(validateProfileDraft({ name: 'Artist', bio: 'one\u0000two' }).errors.bio);
  assert.ok(validateProfileDraft({ name: 'A & B', bio: 'One\n\tTwo' }).draft);
});

test('markup-looking text is preserved as text, not converted into trusted HTML', () => {
  const draft = { name: '<img src=x onerror=alert(1)>', bio: '<script>alert(1)</script> & a song' };
  assert.deepEqual(validateProfileDraft(draft).draft, draft);
  // Browser rendering uses textContent; validation is not an HTML sanitizer.
});
