import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { InputError, transaction } from './database.mjs';

function text(value, maximum, field) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new InputError(`${field} must be nonempty single-line text within ${maximum} characters.`);
  }
  return value.trim();
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new InputError('Provide a valid record UUID.');
  }
  return value;
}

export async function issueInvite(pool, { artist, actor, ttlHours = 24 }) {
  artist = text(artist, 80, 'Artist'); actor = text(actor, 120, 'Actor');
  if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 72) throw new InputError('Invite lifetime must be an integer from 1 to 72 hours.');
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  const result = await transaction(pool, async (client) => {
    const inserted = await client.query(`INSERT INTO artist_claims.invites(id, token_hash, artist_name, issued_by, expires_at)
      VALUES($1, $2, $3, $4, clock_timestamp() + $5 * interval '1 hour') RETURNING expires_at`, [id, hash, artist, actor, ttlHours]);
    await client.query(`INSERT INTO artist_claims.audit_events(invite_id, action, actor) VALUES($1, 'invite_issued', $2)`, [id, actor]);
    return inserted.rows[0];
  });
  // Return only after commit. The raw bearer token is never stored in the DB/audit.
  return { inviteId: id, token, expiresAt: result.expires_at };
}

export async function revokeInvite(pool, { inviteId, actor, reason }) {
  uuid(inviteId); actor = text(actor, 120, 'Actor'); reason = text(reason, 500, 'Reason');
  return transaction(pool, async (client) => {
    // Future redemption must take this same row lock before checking/redeeming.
    const invite = await client.query('SELECT revoked_at FROM artist_claims.invites WHERE id = $1 FOR UPDATE', [inviteId]);
    if (!invite.rowCount) throw new InputError('Invitation not found.');
    const claim = await client.query('SELECT id FROM artist_claims.claims WHERE invite_id = $1', [inviteId]);
    if (claim.rowCount) throw new InputError('Invitation already claimed; freeze its OSO services instead.');
    if (invite.rows[0].revoked_at) return { inviteId, changed: false };
    await client.query('UPDATE artist_claims.invites SET revoked_at = clock_timestamp() WHERE id = $1', [inviteId]);
    await client.query(`INSERT INTO artist_claims.audit_events(invite_id, action, actor, reason) VALUES($1, 'invite_revoked', $2, $3)`, [inviteId, actor, reason]);
    return { inviteId, changed: true };
  });
}

export async function freezeClaim(pool, { claimId, actor, reason }) {
  uuid(claimId); actor = text(actor, 120, 'Actor'); reason = text(reason, 500, 'Reason');
  return transaction(pool, async (client) => {
    const result = await client.query(`UPDATE artist_claims.claims SET frozen_at = clock_timestamp(), frozen_by = $2, freeze_reason = $3
      WHERE id = $1 AND frozen_at IS NULL RETURNING id`, [claimId, actor, reason]);
    if (!result.rowCount) {
      const found = await client.query('SELECT id FROM artist_claims.claims WHERE id = $1', [claimId]);
      if (!found.rowCount) throw new InputError('Claim not found.');
      return { claimId, changed: false };
    }
    await client.query(`INSERT INTO artist_claims.audit_events(claim_id, action, actor, reason) VALUES($1, 'claim_frozen', $2, $3)`, [claimId, actor, reason]);
    return { claimId, changed: true };
  });
}

export async function claimStatus(pool, claimId) {
  uuid(claimId);
  const result = await pool.query('SELECT id, activation_state, frozen_at FROM artist_claims.claims WHERE id = $1', [claimId]);
  if (!result.rowCount) throw new InputError('Claim not found.');
  return result.rows[0];
}
