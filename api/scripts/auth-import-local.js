import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

// Called inside the caller's PostgreSQL transaction. Source is opened read-only.
// Keep account IDs/password hashes; sessions are intentionally not imported.
export async function importLocalAuth(client, path) {
  if (!existsSync(path)) return { users: 0, challenges: 0 };
  const local = new DatabaseSync(path, { readOnly: true });
  const stats = { users: 0, challenges: 0 };
  try {
    const users = local.prepare('SELECT * FROM auth_users').all();
    const columns = ['id', 'email', 'normalizedEmail', 'passwordHash', 'role', 'status', 'emailVerifiedAt', 'tokenVersion', 'createdAt'];
    for (const user of users) {
      const existing = (await client.query('SELECT normalizedemail,passwordhash FROM bep_auth.auth_users WHERE id=$1', [user.id])).rows[0];
      if (existing && (existing.normalizedemail !== user.normalizedEmail || existing.passwordhash !== user.passwordHash)) throw new Error('AUTH_IMPORT_CONFLICT');
      if (existing) continue;
      await client.query(`INSERT INTO bep_auth.auth_users(${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, columns.map(key => user[key]));
      stats.users++;
    }
    const challenges = local.prepare('SELECT * FROM activation_challenges').all();
    const fields = ['userId', 'purpose', 'otpHash', 'expiresAt', 'usedAt', 'attempts', 'lockedUntil', 'lastSentAt'];
    for (const challenge of challenges) {
      const result = await client.query(`INSERT INTO bep_auth.activation_challenges(${fields.join(',')}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')}) ON CONFLICT(userid) DO NOTHING`, fields.map(key => challenge[key]));
      stats.challenges += result.rowCount ?? result.affectedRows ?? 0;
    }
    return stats;
  } finally { local.close(); }
}
