import { SAML } from '@node-saml/node-saml';
import type { SamlConfig } from '../db/sso';

/** Builds a node-saml client from a stored SsoConnection config. Kept as a
 *  thin factory rather than a singleton because each workspace may point at
 *  a different IdP. */
export function buildSamlClient(config: SamlConfig): SAML {
  return new SAML({
    entryPoint: config.entryPoint,
    issuer: config.issuer,
    cert: config.cert,
    callbackUrl: config.callbackUrl,
    wantAssertionsSigned: config.wantAssertionsSigned ?? true,
    identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  });
}

/** Generates the SP metadata XML an IdP admin pastes into their SAML app
 *  config (Okta, Azure AD, OneLogin, etc). Exposed at
 *  GET /auth/sso/:connectionId/metadata. */
export function generateServiceProviderMetadata(config: SamlConfig): string {
  const saml = buildSamlClient(config);
  return saml.generateServiceProviderMetadata(null, null);
}

/** Builds the redirect URL that starts the IdP-initiated login handshake. */
export async function getSamlLoginUrl(config: SamlConfig, relayState?: string): Promise<string> {
  const saml = buildSamlClient(config);
  return saml.getAuthorizeUrlAsync(relayState ?? '', undefined, {});
}

export interface SamlProfile {
  email: string;
  nameID: string;
  attributes: Record<string, unknown>;
}

/** Validates the POSTed SAMLResponse from the IdP's assertion consumer
 *  service (ACS) callback and extracts the user's email. Throws on invalid
 *  signature/expired assertion — callers should treat that as a 401. */
export async function validateSamlResponse(config: SamlConfig, body: Record<string, string>): Promise<SamlProfile> {
  const saml = buildSamlClient(config);
  const { profile } = await saml.validatePostResponseAsync(body);
  if (!profile) throw new Error('SAML assertion contained no profile');
  const email = (profile.email as string | undefined) ?? profile.nameID;
  if (!email) throw new Error('SAML assertion did not include an email or nameID');
  return { email, nameID: profile.nameID, attributes: (profile.attributes as Record<string, unknown>) ?? {} };
}
