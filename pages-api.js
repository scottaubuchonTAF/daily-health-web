/* Static-site Google connection. Tokens live only in this closure, never in storage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.HealthConnection = factory(root.DAILY_HEALTH_CONFIG || {}, {
    fetch: root.fetch.bind(root), oauth: () => root.google?.accounts?.oauth2,
    now: () => Date.now(), origin: root.location.origin
  });
})(typeof window === 'object' ? window : this, function (config, env) {
  'use strict';
  const scopes = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/userinfo.email'];
  const methods = new Set(['getBootstrap', 'saveDay', 'saveSettings', 'exportData', 'importData', 'deleteDay', 'recordForecast']);
  let token = '', expires = 0, connecting = null;
  const now = env.now || Date.now;
  const ready = () => /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.clientId || '') &&
    /^[a-zA-Z0-9_-]{20,}$/.test(config.deploymentId || '') && env.origin === config.origin;
  function authError(message = 'Reconnect Google, then retry. Your pending entry is still here.') {
    const error = new Error(message); error.signIn = true; return error;
  }
  function disconnect() { token = ''; expires = 0; }
  function connect() {
    if (!ready()) return Promise.reject(new Error('Your Google connection is being set up. Check back shortly.'));
    if (connecting) return connecting;
    const oauth = env.oauth();
    if (!oauth) return Promise.reject(new Error('Google sign-in has not loaded. Check your connection, then try again.'));
    connecting = new Promise((resolve, reject) => {
      const client = oauth.initTokenClient({
        client_id: config.clientId, scope: scopes.join(' '), include_granted_scopes: false,
        callback(response) {
          disconnect();
          if (response.error || !response.access_token) { reject(new Error('Google was not connected. Please try again.')); return; }
          if (!oauth.hasGrantedAllScopes(response, ...scopes)) { reject(new Error('Allow both requested permissions to open your private log.')); return; }
          const lifetime = Number(response.expires_in);
          if (!Number.isFinite(lifetime) || lifetime <= 60) { reject(new Error('Google returned an expired connection. Please try again.')); return; }
          token = response.access_token; expires = now() + (lifetime - 60) * 1000;
          resolve();
        },
        error_callback() { reject(new Error('Google sign-in did not finish. Allow the Google sign-in window, then try again.')); }
      });
      // Called immediately from the button's click, so mobile browsers permit the popup.
      client.requestAccessToken({ prompt: 'select_account' });
    }).finally(() => { connecting = null; });
    return connecting;
  }
  async function call(method, request) {
    if (!methods.has(method)) throw new Error('Unknown app action.');
    if (!ready()) throw new Error('Your Google connection is being set up. Check back shortly.');
    if (!token || now() >= expires) { disconnect(); throw authError(); }
    const body = JSON.stringify({ function: method, parameters: request === undefined ? [] : [request], devMode: false });
    if (body.length > 2_000_000) throw new Error('This backup is too large. Use a smaller backup.');
    const currentToken = token;
    let response;
    try {
      response = await env.fetch('https://script.googleapis.com/v1/scripts/' + encodeURIComponent(config.deploymentId) + ':run', {
        method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store',
        headers: { Authorization: 'Bearer ' + currentToken, 'Content-Type': 'application/json' },
        body, signal: AbortSignal.timeout(55000)
      });
    } catch { throw new Error('The save could not be confirmed. Check your connection and retry to check it safely.'); }
    if (response.status === 401) { if (token === currentToken) disconnect(); throw authError(); }
    if (response.status === 403) {
      if (token === currentToken) disconnect();
      throw authError('This Google account cannot open the log. Reconnect using the account that owns it. If it is the correct account, the Google setup needs checking.');
    }
    let data;
    try { data = await response.json(); } catch { throw new Error('Google returned an unexpected response. Please retry.'); }
    if (!response.ok) throw new Error('Google could not complete this request. Please retry.');
    if (data.error) {
      const message = data.error.details?.find(item => item.errorMessage)?.errorMessage;
      throw new Error(message || 'Your log could not complete this action. Please retry.');
    }
    if (data.done !== true || !data.response || !Object.hasOwn(data.response, 'result')) throw new Error('Google did not confirm the result. Retry to check it safely.');
    return data.response.result;
  }
  return Object.freeze({ ready, connect, call, disconnect });
});
