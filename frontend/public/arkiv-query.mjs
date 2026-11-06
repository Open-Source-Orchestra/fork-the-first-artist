const HEX_32 = /^0x[0-9a-fA-F]{64}$/;
const HEX_20 = /^0x[0-9a-fA-F]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateProofConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid proof configuration');
  const c = value;
  if (c.schema !== 'oso.claims.v1' || !/^[a-z0-9-]+$/.test(c.namespace)) throw new Error('Invalid proof scope');
  if (!HEX_20.test(c.writer) || !HEX_32.test(c.entityKey) || !HEX_32.test(c.issueTx) || !HEX_32.test(c.revokeTx)) throw new Error('Invalid public proof identifier');
  if (!UUID.test(c.inviteId) || c.rpc !== 'https://rpc.rabdi.db-chain.testnet.arkiv.network') throw new Error('Invalid proof route');
  return c;
}

export function buildQuery(config) {
  const c = validateProofConfig(config);
  return `arkiv.schema = str('${c.schema}') AND $owner = addr(${c.writer}) AND $creator = addr(${c.writer}) AND namespace = str('${c.namespace}') AND kind = str('invite') AND id = str('${c.inviteId}')`;
}

export function publicQueryOptions(config) {
  return {
    select: {
      key: true,
      owner: true,
      creator: true,
      createdAt: true,
      expiresAt: true,
      creationFlags: true,
      attributes: { namespace: true, kind: true, id: true },
      count: true,
    },
    limit: '0x2',
  };
}

function hexNumber(value, label) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`Missing ${label}`);
  const n = Number(BigInt(value));
  if (!Number.isSafeInteger(n)) throw new Error(`${label} is too large`);
  return n;
}

export function parsePublicQuery(payload, config) {
  const c = validateProofConfig(config);
  if (!payload || typeof payload !== 'object' || payload.error) throw new Error('Arkiv query failed');
  const result = payload.result;
  if (!result || typeof result !== 'object' || !Array.isArray(result.data)) throw new Error('Malformed Arkiv response');
  const count = hexNumber(result.count, 'entity count');
  if (count !== 1 || result.data.length !== 1) throw new Error(`Expected one current entity, received ${count}`);
  const entity = result.data[0];
  if (!entity || typeof entity !== 'object') throw new Error('Malformed entity');
  if (String(entity.key).toLowerCase() !== c.entityKey.toLowerCase()) throw new Error('Unexpected entity key');
  if (String(entity.owner).toLowerCase() !== c.writer.toLowerCase() || String(entity.creator).toLowerCase() !== c.writer.toLowerCase()) throw new Error('Unexpected entity writer');
  if (entity.creationFlags?.readonly !== true) throw new Error('Entity is not readonly');
  if (!Array.isArray(entity.attributes)) throw new Error('Malformed entity attributes');
  const attributes = {};
  for (const attribute of entity.attributes) {
    if (!attribute || typeof attribute.name !== 'string' || attribute.type !== 'str' || typeof attribute.value !== 'string') throw new Error('Malformed entity attribute');
    if (!['namespace', 'kind', 'id'].includes(attribute.name) || Object.hasOwn(attributes, attribute.name)) throw new Error('Unexpected or duplicate entity attribute');
    attributes[attribute.name] = attribute.value;
  }
  if (attributes.namespace !== c.namespace || attributes.kind !== 'invite' || attributes.id !== c.inviteId || entity.attributes.length !== 3) throw new Error('Unexpected entity attributes');
  if ('sealed' in entity) throw new Error('Refusing encrypted payload in the public viewer');
  return {
    blockNumber: hexNumber(result.blockNumber, 'query block'),
    count,
    key: entity.key,
    owner: entity.owner,
    creator: entity.creator,
    createdAt: hexNumber(entity.createdAt, 'creation block'),
    expiresAt: hexNumber(entity.expiresAt, 'expiry block'),
    readonly: true,
    attributes: { namespace: attributes.namespace, kind: attributes.kind, id: attributes.id },
  };
}
