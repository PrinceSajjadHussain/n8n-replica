import axios from 'axios';
import { registerNode } from './types';
import type { NodePlugin } from './types';
import { wrapIntegrationError } from './integrationErrors';

/**
 * linkedin — basic content posting via the LinkedIn UGC Posts API, plus a
 * lightweight read of the authenticated member's profile.
 * credential (type 'linkedin'): { accessToken: string, authorUrn: string }
 *   (authorUrn like "urn:li:person:xxxx" or "urn:li:organization:xxxx" —
 *   fetched once via /v2/me and stored on the credential, since LinkedIn's
 *   post API requires it as the "author" field on every share.)
 * params:
 *   action: 'createPost' | 'getProfile' (default 'createPost')
 *   text? (createPost)
 *   visibility? (createPost — 'PUBLIC' | 'CONNECTIONS', default 'PUBLIC')
 */
export const linkedinNode: NodePlugin = {
  type: 'linkedin',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    const authorUrn = credential?.authorUrn as string;
    if (!accessToken) {
      throw new Error('linkedin node: requires a "linkedin" credential with { "accessToken", "authorUrn" }');
    }
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    };
    const action = String(params.action ?? 'createPost');
    try {
      if (action === 'createPost') {
        if (!authorUrn) throw new Error('linkedin node: "createPost" requires the credential to include "authorUrn"');
        const response = await axios.post(
          'https://api.linkedin.com/v2/ugcPosts',
          {
            author: authorUrn,
            lifecycleState: 'PUBLISHED',
            specificContent: {
              'com.linkedin.ugc.ShareContent': {
                shareCommentary: { text: String(params.text ?? '') },
                shareMediaCategory: 'NONE',
              },
            },
            visibility: {
              'com.linkedin.ugc.MemberNetworkVisibility': (params.visibility as string) ?? 'PUBLIC',
            },
          },
          { headers, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'getProfile') {
        const response = await axios.get('https://api.linkedin.com/v2/me', { headers, timeout: 15000 });
        return { output: response.data };
      }
      throw new Error(`linkedin node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('linkedin', err);
    }
  },
};

/**
 * twitter — post/read via the X API v2. Posting requires a user-context
 * OAuth 2.0 access token (3-legged, "tweet.write" scope) — an app-only
 * bearer token can read but cannot post, same restriction X enforces.
 * credential (type 'twitter'): { accessToken: string }
 * params:
 *   action: 'createTweet' | 'getUser' (default 'createTweet')
 *   text? (createTweet)
 *   username? (getUser — defaults to the authenticated user via /users/me)
 */
export const twitterNode: NodePlugin = {
  type: 'twitter',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    if (!accessToken) throw new Error('twitter node: requires a "twitter" credential with { "accessToken" }');
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
    const action = String(params.action ?? 'createTweet');
    try {
      if (action === 'createTweet') {
        const response = await axios.post(
          'https://api.twitter.com/2/tweets',
          { text: String(params.text ?? '') },
          { headers, timeout: 15000 }
        );
        return { output: response.data };
      }
      if (action === 'getUser') {
        const url = params.username ? `https://api.twitter.com/2/users/by/username/${params.username}` : 'https://api.twitter.com/2/users/me';
        const response = await axios.get(url, { headers, timeout: 15000 });
        return { output: response.data };
      }
      throw new Error(`twitter node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('twitter', err);
    }
  },
};

/**
 * facebook — Page post create + basic read, via the Meta Graph API.
 * credential (type 'facebook'): { pageAccessToken: string, pageId: string }
 * params:
 *   action: 'createPost' | 'listPosts' (default 'createPost')
 *   message? (createPost)
 *   link? (createPost — optional link attachment)
 */
export const facebookNode: NodePlugin = {
  type: 'facebook',
  async execute({ params, credential }) {
    const pageAccessToken = credential?.pageAccessToken as string;
    const pageId = credential?.pageId as string;
    if (!pageAccessToken || !pageId) {
      throw new Error('facebook node: requires a "facebook" credential with { "pageAccessToken", "pageId" }');
    }
    const action = String(params.action ?? 'createPost');
    try {
      if (action === 'createPost') {
        const response = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
          message: params.message,
          link: params.link,
          access_token: pageAccessToken,
        }, { timeout: 15000 });
        return { output: response.data };
      }
      if (action === 'listPosts') {
        const response = await axios.get(`https://graph.facebook.com/v19.0/${pageId}/posts`, {
          params: { access_token: pageAccessToken },
          timeout: 15000,
        });
        return { output: response.data };
      }
      throw new Error(`facebook node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('facebook', err);
    }
  },
};

/**
 * instagram — content publishing via the Instagram Graph API, which rides
 * on top of a connected Facebook Page's access token (there is no
 * separate "Instagram login" for the Business API — this mirrors Meta's
 * own setup requirement, not a FlowForge shortcut). Publishing is a
 * two-step create-container-then-publish flow, matching how Meta's API
 * actually works (no single "post now" call for feed media).
 * credential (type 'instagram'): { pageAccessToken: string, igUserId: string }
 * params:
 *   action: 'createPost' | 'listMedia' (default 'createPost')
 *   imageUrl? (createPost — publicly reachable image URL)
 *   caption? (createPost)
 */
export const instagramNode: NodePlugin = {
  type: 'instagram',
  async execute({ params, credential }) {
    const pageAccessToken = credential?.pageAccessToken as string;
    const igUserId = credential?.igUserId as string;
    if (!pageAccessToken || !igUserId) {
      throw new Error('instagram node: requires an "instagram" credential with { "pageAccessToken", "igUserId" }');
    }
    const action = String(params.action ?? 'createPost');
    try {
      if (action === 'createPost') {
        if (!params.imageUrl) throw new Error('instagram node: "createPost" requires "imageUrl"');
        const container = await axios.post(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
          image_url: params.imageUrl,
          caption: params.caption ?? '',
          access_token: pageAccessToken,
        }, { timeout: 20000 });
        const creationId = container.data.id;
        const publish = await axios.post(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
          creation_id: creationId,
          access_token: pageAccessToken,
        }, { timeout: 20000 });
        return { output: publish.data };
      }
      if (action === 'listMedia') {
        const response = await axios.get(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
          params: { access_token: pageAccessToken },
          timeout: 15000,
        });
        return { output: response.data };
      }
      throw new Error(`instagram node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('instagram', err);
    }
  },
};

/**
 * youtube — upload video metadata / list channel videos via the YouTube
 * Data API v3. Shares the same "google-oauth2"-style pasted-token
 * credential shape as gmail/googleCalendar/googleDrive, just under its
 * own credential type so the node panel's picker filters correctly.
 * credential (type 'youtube'): { accessToken: string }
 * params:
 *   action: 'listVideos' | 'updateVideo' (default 'listVideos')
 *   channelId? (listVideos — defaults to "mine")
 *   videoId?, snippet? (updateVideo — partial YouTube video "snippet" resource)
 */
export const youtubeNode: NodePlugin = {
  type: 'youtube',
  async execute({ params, credential }) {
    const accessToken = credential?.accessToken as string;
    if (!accessToken) throw new Error('youtube node: requires a "youtube" credential with { "accessToken" }');
    const headers = { Authorization: `Bearer ${accessToken}` };
    const action = String(params.action ?? 'listVideos');
    try {
      if (action === 'listVideos') {
        const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
          headers,
          params: {
            part: 'snippet',
            forMine: params.channelId ? undefined : true,
            channelId: params.channelId,
            type: 'video',
            maxResults: 25,
          },
          timeout: 15000,
        });
        return { output: response.data };
      }
      if (action === 'updateVideo') {
        if (!params.videoId) throw new Error('youtube node: "updateVideo" requires "videoId"');
        const response = await axios.put(
          'https://www.googleapis.com/youtube/v3/videos',
          { id: params.videoId, snippet: params.snippet ?? {} },
          { headers, params: { part: 'snippet' }, timeout: 15000 }
        );
        return { output: response.data };
      }
      throw new Error(`youtube node: unknown action "${action}"`);
    } catch (err) {
      throw wrapIntegrationError('youtube', err);
    }
  },
};

registerNode(linkedinNode);
registerNode(twitterNode);
registerNode(facebookNode);
registerNode(instagramNode);
registerNode(youtubeNode);
