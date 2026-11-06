import { parseArgs } from 'node:util';
import { createPool, migrate, InputError } from './database.mjs';
import { issueInvite, revokeInvite, freezeClaim, claimStatus } from './steward.mjs';

const usage = `Steward CLI (trusted backend operators only)
  migrate
  invite --artist NAME --actor STEWARD [--ttl-hours 24]
  revoke-invite --invite UUID --actor STEWARD --reason REASON
  freeze --claim UUID --actor STEWARD --reason REASON
  status --claim UUID

Set DATABASE_URL in claims/.env or the environment. Invite output contains a
private bearer token; deliver it privately and do not paste it into public logs.
Freeze records a service flag only: it never changes ENS ownership or payouts.`;

let pool;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean' }, artist: { type: 'string' }, actor: { type: 'string' },
    'ttl-hours': { type: 'string' }, invite: { type: 'string' }, claim: { type: 'string' }, reason: { type: 'string' },
  } });
  if (values.help || !positionals.length) {
    console.log(usage);
  } else {
    const command = positionals[0];
    const allowed = { migrate: [], invite: ['artist', 'actor', 'ttl-hours'], 'revoke-invite': ['invite', 'actor', 'reason'], freeze: ['claim', 'actor', 'reason'], status: ['claim'] };
    if (positionals.length !== 1 || !Object.hasOwn(allowed, command) || Object.keys(values).some((key) => !allowed[command].includes(key))) {
      throw new InputError('Invalid command or options. Use --help.');
    }
    pool = createPool();
    let result;
    if (command === 'migrate') result = await migrate(pool);
    if (command === 'invite') result = await issueInvite(pool, { artist: values.artist, actor: values.actor, ttlHours: values['ttl-hours'] === undefined ? 24 : Number(values['ttl-hours']) });
    if (command === 'revoke-invite') result = await revokeInvite(pool, { inviteId: values.invite, actor: values.actor, reason: values.reason });
    if (command === 'freeze') result = await freezeClaim(pool, { claimId: values.claim, actor: values.actor, reason: values.reason });
    if (command === 'status') result = await claimStatus(pool, values.claim);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error instanceof InputError ? error.message : 'Command failed. Check arguments, database configuration, connectivity, and migration status.');
  process.exitCode = 1;
} finally {
  await pool?.end();
}
