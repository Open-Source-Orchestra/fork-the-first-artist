import { parseArgs } from 'node:util';
import { connect } from './arkiv.mjs';
import { InputError, CHAIN_ID } from './config.mjs';
import { issueInvite, revokeInvite, freezeClaim, claimStatus, inviteStatus } from './steward.mjs';

const usage = `Steward CLI (trusted backend operators only, Arkiv Rabdi testnet)
  check
  invite --artist NAME --actor STEWARD [--ttl-hours 24]
  invite-status --invite UUID
  revoke-invite --invite UUID --actor STEWARD --reason REASON
  freeze --claim UUID --actor STEWARD --reason REASON
  status --claim UUID

Configure ARKIV_* settings in claims/.env (see .env.example). No SQL migration.
Invite output contains a private bearer token: deliver privately, never log it.
Freeze records service state only; existing services do not yet enforce it.
Arkiv writes spend test GLM. Unconfirmed writes must be reconciled before retry.`;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: 'boolean' }, artist: { type: 'string' }, actor: { type: 'string' },
    'ttl-hours': { type: 'string' }, invite: { type: 'string' }, claim: { type: 'string' }, reason: { type: 'string' },
  } });
  if (values.help || !positionals.length) console.log(usage);
  else {
    const command = positionals[0];
    const allowed = { check: [], invite: ['artist', 'actor', 'ttl-hours'], 'invite-status': ['invite'], 'revoke-invite': ['invite', 'actor', 'reason'], freeze: ['claim', 'actor', 'reason'], status: ['claim'] };
    if (positionals.length !== 1 || !Object.hasOwn(allowed, command) || Object.keys(values).some((key) => !allowed[command].includes(key))) throw new InputError('Invalid command or options. Use --help.');
    const store = connect();
    let result;
    if (command === 'check') {
      const head = await store.check();
      result = { chainId: CHAIN_ID, writer: store.owner, namespace: store.namespace, block: String(head.currentBlock) };
    }
    if (command === 'invite') result = await issueInvite(store, { artist: values.artist, actor: values.actor, ttlHours: values['ttl-hours'] === undefined ? 24 : Number(values['ttl-hours']) });
    if (command === 'invite-status') result = await inviteStatus(store, values.invite);
    if (command === 'revoke-invite') result = await revokeInvite(store, { inviteId: values.invite, actor: values.actor, reason: values.reason });
    if (command === 'freeze') result = await freezeClaim(store, { claimId: values.claim, actor: values.actor, reason: values.reason });
    if (command === 'status') result = await claimStatus(store, values.claim);
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error instanceof InputError ? error.message : 'Command failed. Check local Arkiv configuration, RPC availability, and test wallet funding.');
  process.exitCode = 1;
}
