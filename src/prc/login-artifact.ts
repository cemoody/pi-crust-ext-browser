/**
 * Builds the `browser_request_login` tool result (HOFF-2): a tool result whose
 * `details.piRemoteControlArtifact` is a `kind:"html"` artifact pointing at the
 * token-scoped live-view route, rendered inline in the conversation (Tier-B).
 *
 * The token is obtained from the server (the /token route), so the tool never
 * needs the server secret — it just embeds the server-issued token in the URL.
 */
import { liveViewRouteUrl } from '../core/transport.js';

export interface LoginArtifactResult {
  content: { type: 'text'; text: string }[];
  details: {
    piRemoteControlArtifact: {
      version: 1;
      kind: 'html';
      title: string;
      url: string;
    };
  };
}

export function buildLoginArtifact(sessionId: string, reason: string, opts: { token: string }): LoginArtifactResult {
  return {
    content: [{ type: 'text', text: `Awaiting human sign-in: ${reason}` }],
    details: {
      piRemoteControlArtifact: {
        version: 1,
        kind: 'html',
        title: `Sign in — ${reason}`,
        url: liveViewRouteUrl(sessionId, opts.token),
      },
    },
  };
}
