/**
 * DevFill GitHub Gist sync client.
 * Encapsulates every call to the GitHub REST API. The PAT is only ever
 * sent as an Authorization header to api.github.com - never logged, never
 * sent anywhere else. Exposed as `self.DevFillGistSync` (works both as a
 * `window` in regular pages and as the global scope inside the MV3
 * service worker).
 */
(function (root) {
  'use strict';

  const API_ROOT = 'https://api.github.com';
  const GIST_FILENAME = 'devfill-presets.json';
  const SCHEMA_VERSION = 1;

  class GistSyncError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'GistSyncError';
      this.code = code; // 'auth' | 'not_found' | 'rate_limit' | 'forbidden' | 'network' | 'parse' | 'unknown'
    }
  }

  function buildSchema(presets) {
    return {
      version: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      presets: presets || {}
    };
  }

  async function githubRequest(method, path, pat, body) {
    let response;
    try {
      response = await fetch(API_ROOT + path, {
        method,
        headers: Object.assign(
          {
            Authorization: `Bearer ${pat}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
          },
          body ? { 'Content-Type': 'application/json' } : {}
        ),
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (networkErr) {
      throw new GistSyncError('network', 'Could not reach GitHub. Check your internet connection.');
    }

    if (response.ok) return response.json();

    if (response.status === 401) {
      throw new GistSyncError('auth', 'GitHub rejected the personal access token (401 Unauthorized). Check that the PAT is correct and has not expired.');
    }
    if (response.status === 404) {
      throw new GistSyncError('not_found', 'Gist not found (404). Check the Gist ID, and that this token can access it.');
    }
    if (response.status === 403) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        throw new GistSyncError('rate_limit', 'GitHub API rate limit exceeded (403). Try again in a few minutes.');
      }
      throw new GistSyncError('forbidden', 'GitHub rejected the request (403). Make sure the PAT has "gist" scope.');
    }

    let detail = '';
    try {
      const errJson = await response.json();
      detail = errJson && errJson.message ? ` ${errJson.message}` : '';
    } catch (e) {
      // response body wasn't JSON - ignore
    }
    throw new GistSyncError('unknown', `GitHub API error (${response.status}).${detail}`);
  }

  // Fetches the gist and parses the DevFill JSON file inside it.
  // Returns { version, updatedAt, presets }.
  async function fetchGist(pat, gistId) {
    const gist = await githubRequest('GET', `/gists/${encodeURIComponent(gistId)}`, pat);
    const file = gist.files && gist.files[GIST_FILENAME];
    if (!file) {
      throw new GistSyncError('not_found', `This gist does not contain a "${GIST_FILENAME}" file. Point DevFill at a gist created by DevFill.`);
    }

    let raw = file.content;
    if (file.truncated) {
      // Files over ~1MB are truncated by the API; fetch the full content.
      const rawResponse = await fetch(file.raw_url);
      raw = await rawResponse.text();
    }

    try {
      const schema = JSON.parse(raw);
      return {
        version: schema.version || SCHEMA_VERSION,
        updatedAt: schema.updatedAt || null,
        presets: schema.presets || {}
      };
    } catch (e) {
      throw new GistSyncError('parse', 'Could not parse the gist content as JSON.');
    }
  }

  // Creates a new secret gist containing an empty DevFill preset structure.
  // Returns { gistId, schema }.
  async function createGist(pat) {
    const schema = buildSchema({});
    const body = {
      description: 'DevFill presets (managed by the DevFill Chrome extension)',
      public: false,
      files: { [GIST_FILENAME]: { content: JSON.stringify(schema, null, 2) } }
    };
    const gist = await githubRequest('POST', '/gists', pat, body);
    return { gistId: gist.id, schema };
  }

  // Overwrites the gist's DevFill file with the given presets map.
  // Returns { gistId, schema }.
  async function updateGist(pat, gistId, presets) {
    const schema = buildSchema(presets);
    const body = {
      files: { [GIST_FILENAME]: { content: JSON.stringify(schema, null, 2) } }
    };
    const gist = await githubRequest('PATCH', `/gists/${encodeURIComponent(gistId)}`, pat, body);
    return { gistId: gist.id, schema };
  }

  // Compares two preset maps and buckets each name into added/updated/removed/unchanged
  // from the perspective of "applying `incoming` on top of `base`".
  function diffPresets(base, incoming) {
    const added = [];
    const updated = [];
    const removed = [];
    const unchanged = [];

    const baseKeys = new Set(Object.keys(base || {}));
    const incomingKeys = new Set(Object.keys(incoming || {}));

    incomingKeys.forEach((name) => {
      if (!baseKeys.has(name)) {
        added.push(name);
      } else if (JSON.stringify(base[name]) !== JSON.stringify(incoming[name])) {
        updated.push(name);
      } else {
        unchanged.push(name);
      }
    });
    baseKeys.forEach((name) => {
      if (!incomingKeys.has(name)) removed.push(name);
    });

    return { added, updated, removed, unchanged };
  }

  root.DevFillGistSync = {
    GIST_FILENAME,
    GistSyncError,
    fetchGist,
    createGist,
    updateGist,
    diffPresets
  };
})(self);
