import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadArtist } from '../src/index.ts';

const profile = { name: 'Test artist', bio: 'Approved test biography', songs: ['Test song'] };

test('artist: an absent profile must not activate the demo artist', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'oso-artist-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(loadArtist(join(dir, 'missing.json')), { code: 'ENOENT' });
});

test('artist: consent and optional identity fields are never inherited', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'oso-artist-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'artist.json');
  await writeFile(file, JSON.stringify(profile));
  const artist = await loadArtist(file);
  assert.equal(artist.consent, undefined);
  assert.equal(artist.ensName, undefined);
  assert.equal(artist.hederaAccount, undefined);
  assert.deepEqual(artist, profile);
});

test('artist: explicit boolean consent is preserved', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'oso-artist-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'artist.json');
  for (const consent of [true, false]) {
    await writeFile(file, JSON.stringify({ ...profile, consent }));
    assert.equal((await loadArtist(file)).consent, consent);
  }
});

test('artist: malformed profiles fail validation without echoing profile content', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'oso-artist-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'artist.json');
  const invalid = [
    null, [], 'private profile text', {},
    { ...profile, name: ' ' },
    { ...profile, bio: 7 },
    { ...profile, songs: 'private profile text' },
    { ...profile, songs: [null] },
    { ...profile, consent: 'true' },
    { ...profile, consent: null },
    { ...profile, ensName: 12 },
    { ...profile, hederaAccount: {} },
  ];
  for (const value of invalid) {
    await writeFile(file, JSON.stringify(value));
    await assert.rejects(loadArtist(file), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /invalid artist profile/);
      assert.doesNotMatch(error.message, /private profile text/);
      return true;
    });
  }
  await writeFile(file, '{"bio": "private profile text');
  await assert.rejects(loadArtist(file), { message: 'invalid artist profile: expected valid JSON' });
});
