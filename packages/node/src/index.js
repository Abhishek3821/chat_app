/** Use only on the host backend. Never import the app secret into browser code. */
export function createChatKonectClient({ apiUrl, appId, appSecret, timeoutMs = 10000, fetch: fetcher = globalThis.fetch }) {
  const url = new URL(apiUrl);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('apiUrl must be an HTTP(S) backend URL.');
  if (!appId || !appSecret) throw new Error('ChatKonect appId and appSecret are required on the server.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new Error('timeoutMs must be a positive number.');
  const base = url.href.replace(/\/+$/, '').replace(/\/api$/, '') + '/api/v1/platform';
  const headers = { 'X-CC-App-Id': appId, Authorization: `Bearer ${appSecret}`, 'Content-Type': 'application/json' };
  async function request(path, body) {
    const response = await fetcher(base + path, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`ChatKonect ${path} failed (HTTP ${response.status}).`);
    return response.json();
  }
  return {
    async createUserSession(user) {
      const externalId = user?.id === undefined || user?.id === null ? '' : String(user.id);
      if (!externalId || externalId.length > 128 || !user.name?.trim()) throw new Error('A stable user id (up to 128 characters) and name are required.');
      await request('/users', { externalId, name: user.name, avatar: user.avatar, bio: user.bio });
      const session = await request('/tokens', { externalId });
      if (typeof session.token !== 'string' || !session.token) throw new Error('ChatKonect returned no user token.');
      return session;
    },
  };
}
