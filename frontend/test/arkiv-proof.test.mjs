import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildQuery, publicQueryOptions, parsePublicQuery, validateProofConfig } from '../public/arkiv-query.mjs';

const config = JSON.parse(await readFile(new URL('../public/arkiv-proof.json', import.meta.url), 'utf8'));

function validResponse() {
  return {
    result: {
      blockNumber: '0x49a6e',
      count: '0x1',
      data: [{
        key: config.entityKey,
        owner: config.writer,
        creator: config.writer,
        createdAt: '0x49a2d',
        expiresAt: '0x73d2d',
        creationFlags: { readonly: true },
        attributes: [
          { name: 'id', type: 'str', value: config.inviteId },
          { name: 'kind', type: 'str', value: 'invite' },
          { name: 'namespace', type: 'str', value: config.namespace },
        ],
      }],
    },
  };
}

test('Arkiv public proof config and query are scoped to the synthetic entity', () => {
  assert.equal(validateProofConfig(config), config);
  const query = buildQuery(config);
  assert.match(query, /arkiv\.schema = str\('oso\.claims\.v1'\)/);
  assert.match(query, /kind = str\('invite'\)/);
  assert.match(query, new RegExp(config.inviteId));
  const options = publicQueryOptions(config);
  assert.equal(options.limit, '0x2');
  assert.equal('sealed' in options.select, false);
  assert.deepEqual(Object.keys(options.select.attributes), ['namespace', 'kind', 'id']);
});

test('Arkiv public response parser returns only current safe metadata', () => {
  const parsed = parsePublicQuery(validResponse(), config);
  assert.equal(parsed.blockNumber, 301678);
  assert.equal(parsed.count, 1);
  assert.equal(parsed.key, config.entityKey);
  assert.equal(parsed.createdAt, 301613);
  assert.equal(parsed.expiresAt, 474413);
  assert.equal(parsed.readonly, true);
  assert.equal('sealed' in parsed, false);
});

test('Arkiv public response rejects ambiguity, wrong writer, non-readonly and sealed data', () => {
  for (const mutate of [
    (r) => { r.result.count = '0x2'; },
    (r) => { r.result.data[0].owner = '0x0000000000000000000000000000000000000000'; },
    (r) => { r.result.data[0].creationFlags.readonly = false; },
    (r) => { r.result.data[0].attributes.push({ name: 'sealed', type: 'str', value: 'not-allowed' }); },
  ]) {
    const response = validResponse();
    mutate(response);
    assert.throws(() => parsePublicQuery(response, config));
  }
});

test('Arkiv proof config rejects invalid scope and identifiers without interpolation', () => {
  assert.throws(() => buildQuery({ ...config, namespace: "x') OR kind = str('claim" }));
  assert.throws(() => buildQuery({ ...config, writer: 'not-an-address' }));
  assert.throws(() => buildQuery({ ...config, inviteId: 'not-a-uuid' }));
  assert.throws(() => buildQuery({ ...config, rpc: 'https://example.com' }));
});
