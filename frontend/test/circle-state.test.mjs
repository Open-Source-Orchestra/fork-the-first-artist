import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { roster } from '../public/circle/artists.mjs';
import {
  ALL_DAYS,
  EVENT_DAYS,
  artistNameForSlug,
  createFilterState,
  draftUrlForArtist,
  filterArtists,
  normalizeQuery,
} from '../public/circle-state.mjs';

const { artists } = roster;
const bySlug = (slug) => artists.find((artist) => artist.slug === slug);

test('circle roster has unique slugs and explicit valid multi-day data', () => {
  assert.equal(artists.length, 40);
  assert.equal(new Set(artists.map((artist) => artist.slug)).size, artists.length);
  for (const artist of artists) {
    assert.ok(Array.isArray(artist.days), `${artist.slug} must declare days`);
    assert.equal('day' in artist, false, `${artist.slug} must not retain ambiguous day data`);
    assert.deepEqual(artist.days, [...new Set(artist.days)].sort((a, b) => a - b));
    for (const day of artist.days) assert.ok(EVENT_DAYS.includes(day), `${artist.slug}: invalid day ${day}`);
  }
  assert.deepEqual(bySlug('0xmentalist').days, [3, 4, 5, 6]);
  for (const slug of ['open-source-orchestra', 'shaka', 'ohana', 'amogh']) {
    assert.deepEqual(bySlug(slug).days, [3, 4, 5, 6]);
  }
});

test('day and name use one combined state instead of overwriting each other', () => {
  const alaska = bySlug('alaska-x-subcult');
  assert.equal(alaska.days.includes(4), true);
  assert.equal(alaska.days.includes(3), false);
  assert.deepEqual(filterArtists(artists, { day: 3, query: 'Alaska' }), []);
  assert.deepEqual(filterArtists(artists, { day: 4, query: 'Alaska' }), [alaska]);
  assert.deepEqual(filterArtists(artists, { day: 4, query: '  aLaSkA  ' }), [alaska]);
  assert.deepEqual(filterArtists(artists, { day: 4, query: 'not an artist' }), []);
});

test('genuine multi-day artists match every declared day and no others', () => {
  for (const day of EVENT_DAYS) {
    const matches = filterArtists(artists, { day, query: '0xmentalist' });
    assert.deepEqual(matches, [bySlug('0xmentalist')], `Nov ${day}`);
  }
  assert.deepEqual(filterArtists(artists, { day: 2, query: '0xmentalist' }), []);
});

test('undated garden entries do not acquire a contradictory schedule day', () => {
  for (const slug of ['colorfly', 'atharv', 'even-notes', '4ni4']) {
    assert.deepEqual(bySlug(slug).days, []);
    for (const day of EVENT_DAYS) {
      assert.deepEqual(filterArtists(artists, { day, query: bySlug(slug).name }), [], `${slug} on Nov ${day}`);
    }
    assert.ok(filterArtists(artists, createFilterState()).includes(bySlug(slug)));
  }
});

test('reset restores both controls state and the complete result set', () => {
  const filtered = { day: 3, query: 'Alaska' };
  assert.deepEqual(filterArtists(artists, filtered), []);
  const reset = createFilterState();
  assert.deepEqual(reset, { day: ALL_DAYS, query: '' });
  assert.equal(filterArtists(artists, reset).length, artists.length);
  assert.equal(normalizeQuery(reset.query), '');
});

test('draft handoff accepts only an exact public roster slug', () => {
  const alaska = bySlug('alaska-x-subcult');
  assert.equal(draftUrlForArtist(alaska), '/draft?artist=alaska-x-subcult');
  assert.equal(artistNameForSlug('alaska-x-subcult', artists), alaska.name);
  assert.equal(artistNameForSlug('ALASKA-X-SUBCULT', artists), '');
  assert.equal(artistNameForSlug('<img src=x onerror=alert(1)>', artists), '');
  assert.equal(artistNameForSlug('', artists), '');
  assert.equal(artistNameForSlug(null, artists), '');
  assert.throws(() => draftUrlForArtist({ slug: 'not valid!' }), TypeError);
  assert.throws(() => draftUrlForArtist({}), TypeError);
});

test('static HTML keeps native semantics, control order, and a 40-name no-JS fallback', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/circle.css', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(html, /role="listitem"/);
  assert.match(html, /<ul class="ring" id="ring"><\/ul>/);
  assert.ok(html.indexOf('id="finder"') < html.indexOf('id="ring"'));
  assert.ok(html.indexOf('id="pills"') < html.indexOf('id="ring"'));
  assert.match(html, /<label for="find">Find an artist by name<\/label>/);
  assert.doesNotMatch(css, /\.finder label\s*\{[^}]*display\s*:\s*none/s);
  assert.doesNotMatch(css, /\.finder\s*\{[^}]*position\s*:\s*fixed/s);
  assert.doesNotMatch(html, /keeps every cent|Claim this seat/);
  const noScript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '';
  const fallbackItems = noScript.match(/<li>/g) ?? [];
  assert.equal(fallbackItems.length, artists.length);
  for (const artist of artists) assert.ok(noScript.includes(artist.name), `no-JS fallback omits ${artist.name}`);
  assert.match(noScript, /https:\/\/opensourceorchestra\.org\/garden\/circle\//);
  assert.doesNotMatch(noScript, /0\s*\/\s*0|0 of 0/);
});
