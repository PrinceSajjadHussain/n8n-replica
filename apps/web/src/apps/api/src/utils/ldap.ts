import ldap from 'ldapjs';
import type { LdapConfig } from '../db/sso';

export interface LdapUser {
  dn: string;
  email: string;
  displayName?: string;
  raw: Record<string, unknown>;
}

/** Authenticates a username/password against an LDAP/Active Directory
 *  server: binds as the service account, searches for the user's DN, then
 *  re-binds as that DN with the supplied password to verify it. Returns the
 *  resolved user entry on success, or null on bad credentials / not found. */
export async function authenticateLdapUser(config: LdapConfig, username: string, password: string): Promise<LdapUser | null> {
  const client = ldap.createClient({
    url: config.url,
    tlsOptions: { rejectUnauthorized: config.tlsRejectUnauthorized ?? true },
  });

  try {
    await bindAsync(client, config.bindDN, config.bindCredentials);

    const filter = config.searchFilter.replace('{{username}}', escapeLdapFilterValue(username));
    const entry = await searchOneAsync(client, config.searchBase, filter);
    if (!entry) return null;

    // Verify the password by attempting to bind as the resolved user DN.
    const userClient = ldap.createClient({ url: config.url, tlsOptions: { rejectUnauthorized: config.tlsRejectUnauthorized ?? true } });
    try {
      await bindAsync(userClient, entry.dn, password);
    } finally {
      userClient.unbind();
    }

    const attrs = entry.attributes as Record<string, unknown>;
    const email = (attrs.mail as string) || (attrs.email as string) || username;
    return { dn: entry.dn, email, displayName: attrs.displayName as string | undefined, raw: attrs };
  } finally {
    client.unbind();
  }
}

/** Service-account-only connectivity check, used by the "Test connection"
 *  button in the SSO admin UI before saving a directory config. */
export async function testLdapConnection(config: LdapConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = ldap.createClient({ url: config.url, tlsOptions: { rejectUnauthorized: config.tlsRejectUnauthorized ?? true } });
  try {
    await bindAsync(client, config.bindDN, config.bindCredentials);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'LDAP bind failed' };
  } finally {
    client.unbind();
  }
}

function bindAsync(client: ldap.Client, dn: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.bind(dn, password, (err) => (err ? reject(err) : resolve()));
  });
}

function searchOneAsync(client: ldap.Client, base: string, filter: string): Promise<{ dn: string; attributes: Record<string, unknown> } | null> {
  return new Promise((resolve, reject) => {
    client.search(base, { filter, scope: 'sub' }, (err, res) => {
      if (err) return reject(err);
      let found: { dn: string; attributes: Record<string, unknown> } | null = null;
      res.on('searchEntry', (entry) => {
        const attributes: Record<string, unknown> = {};
        for (const attr of entry.pojo.attributes) {
          attributes[attr.type] = attr.values.length === 1 ? attr.values[0] : attr.values;
        }
        found = { dn: entry.pojo.objectName ?? '', attributes };
      });
      res.on('error', (searchErr) => reject(searchErr));
      res.on('end', () => resolve(found));
    });
  });
}

function escapeLdapFilterValue(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}
