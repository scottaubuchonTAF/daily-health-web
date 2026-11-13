/* Google tokens stay in memory. Optional app-only device connections persist for 90 days. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.HealthConnection = factory(root.DAILY_HEALTH_CONFIG || {}, {
    fetch: root.fetch.bind(root), oauth: () => root.google?.accounts?.oauth2,
    now: () => Date.now(), origin: root.location.origin, storage: () => root.localStorage,
    randomBytes: () => root.crypto.getRandomValues(new Uint8Array(32)),
    credentials: root.navigator.credentials, passkeySupported: () => !!root.PublicKeyCredential && root.isSecureContext,
    encode: bytes => root.btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    decode: value => Uint8Array.from(root.atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
  });
})(typeof window === 'object' ? window : this, function (config, env) {
  'use strict';
  const scopes = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/userinfo.email'];
  const methods = new Set(['getBootstrap', 'saveDay', 'saveSettings', 'exportData', 'importData', 'deleteDay', 'recordForecast', 'getHealthSyncStatus', 'createHealthSyncKey', 'saveHealthSyncPreferences', 'revokeHealthSyncKey']);
  let token = '', expires = 0, connecting = null;
  const now = env.now || Date.now;
  const ready = () => /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(config.clientId || '') &&
    /^[a-zA-Z0-9_-]{20,}$/.test(config.deploymentId || '') && env.origin === config.origin;
  function authError(message = 'Reconnect Google, then retry. Your pending entry is still here.') {
    const error = new Error(message); error.signIn = true; return error;
  }
  function clearOAuth() { token = ''; expires = 0; }
  function authorize() {
    if (!ready()) return Promise.reject(new Error('Your Google connection is being set up. Check back shortly.'));
    if (connecting) return connecting;
    const oauth = env.oauth();
    if (!oauth) return Promise.reject(new Error('Google sign-in has not loaded. Check your connection, then try again.'));
    connecting = new Promise((resolve, reject) => {
      const client = oauth.initTokenClient({
        client_id: config.clientId, scope: scopes.join(' '), include_granted_scopes: false,
        callback(response) {
          clearOAuth();
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
      client.requestAccessToken({ prompt: '' });
    }).finally(() => { connecting = null; });
    return connecting;
  }
  async function oauthCall(method, request) {
    if (!ready()) throw new Error('Your Google connection is being set up. Check back shortly.');
    if (!token || now() >= expires) { clearOAuth(); throw authError(); }
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
    if (response.status === 401) { if (token === currentToken) clearOAuth(); throw authError(); }
    if (response.status === 403) {
      if (token === currentToken) clearOAuth();
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
  const storageKey = 'daily-health-device-v1', passkeyStorageKey = 'daily-health-passkey-v1', maxAge = 90 * 86400000;
  let passkeyVisit = null, registration = null, passkeyBusy = false;
  const supportsPasskey = () => deviceReady() && !!env.passkeySupported?.() && !!env.credentials;
  function passkeyEnabled() { try { return env.storage?.().getItem(passkeyStorageKey) === 'true'; } catch { return false; } }
  function passkeyRemember() { env.storage().setItem(passkeyStorageKey, 'true'); }
  function randomToken() {
    const bytes = env.randomBytes();
    if (bytes.length !== 32) throw new Error('Could not create a secure connection.');
    return 'dhd1_' + Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
  }
  let device = null, generation = 0, enrolling = null;
  const deviceReady = () => ready() && /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]{30,}\/exec$/.test(config.deviceEndpoint || '');
  function clearDevice(expected) {
    if (!expected || device?.token === expected.token) device = null;
    try {
      const saved = JSON.parse(env.storage?.().getItem(storageKey) || 'null');
      if (!expected || saved?.token === expected.token) env.storage?.().removeItem(storageKey);
    } catch {}
  }
  function restore() {
    device = null;
    if (passkeyEnabled()) { clearDevice(); return false; }
    if (!deviceReady()) return false;
    try {
      const saved = JSON.parse(env.storage?.().getItem(storageKey) || 'null');
      if (saved?.origin === config.origin && saved?.deploymentId === config.deploymentId &&
          saved?.endpoint === config.deviceEndpoint && /^dhd1_[a-f0-9]{64}$/.test(saved.token) &&
          Number.isFinite(saved.expiresAt) && saved.expiresAt > now() && saved.expiresAt <= now() + maxAge + 60000) device = saved;
      else if (saved) clearDevice(saved);
    } catch { clearDevice(); }
    return !!device;
  }
  function rememberedUntil() { return device && device.expiresAt > now() ? device.expiresAt : null; }
  async function deviceCall(current, method, request) {
    if (!deviceReady()) throw authError();
    const body = JSON.stringify({kind:'app',session:current.token,method,...(request===undefined?{}:{request})});
    if (body.length > 2_000_000) throw new Error('This backup is too large. Use a smaller backup.');
    let response;
    try {
      response = await env.fetch(config.deviceEndpoint, {
        method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'follow',
        headers:{'Content-Type':'text/plain;charset=UTF-8'},body,signal:AbortSignal.timeout(55000)
      });
    } catch { throw new Error('The request could not be confirmed. Check your connection and retry.'); }
    let data;
    try { data=await response.json(); } catch { throw new Error('Google returned an unexpected response. Please retry.'); }
    if (data?.signIn === true) { clearDevice(current); clearOAuth(); throw authError(data.message); }
    if (!response.ok || data?.ok !== true || !Object.hasOwn(data,'result')) throw new Error(data?.message || 'Google did not confirm this action. Please retry.');
    return data.result;
  }
  function connect({remember=false}={}) {
    if (enrolling) return enrolling;
    const start=generation;
    enrolling=(async()=>{
      await authorize();
      if(start!==generation){clearOAuth();throw authError();}
      let warning='';
      if(remember&&!passkeyEnabled()&&!rememberedUntil()){
        try{
          if(!deviceReady()||!env.storage||!env.randomBytes)throw new Error('Remembering this device is unavailable.');
          const probe=storageKey+'-check';env.storage().setItem(probe,'1');env.storage().removeItem(probe);
          const bytes=env.randomBytes();
          if(bytes.length!==32)throw new Error('Could not create a device connection.');
          const key='dhd1_'+Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');
          const result=await oauthCall('createDeviceSession',{token:key});
          if(!Number.isFinite(result?.expiresAt)||result.expiresAt<=now()||result.expiresAt>now()+maxAge+60000)throw new Error('Invalid connection expiry.');
          const next={token:key,expiresAt:result.expiresAt,origin:config.origin,deploymentId:config.deploymentId,endpoint:config.deviceEndpoint};
          if(start!==generation){await deviceCall(next,'signOutDevice');throw authError();}
          try{env.storage().setItem(storageKey,JSON.stringify(next));}
          catch(error){await deviceCall(next,'signOutDevice').catch(()=>{});throw error;}
          device=next;
        }catch(error){warning='Signed in for this visit, but this device could not be remembered. '+(error.message||'Check browser storage settings.');}
      }
      return {remembered:!!rememberedUntil(),warning};
    })().finally(()=>{enrolling=null;});
    return enrolling;
  }
  async function call(method,request){
    if(!methods.has(method))throw new Error('Unknown app action.');
    if(!ready())throw new Error('Your Google connection is being set up. Check back shortly.');
    if(passkeyVisit){
      if(now()>=passkeyVisit.expiresAt){lock();throw authError('Your log is locked. Unlock with your passkey or connect Google.');}
      try { return await deviceCall(passkeyVisit,method,request); }
      catch(error){if(error.signIn)lock();throw error;}
    }
    if(device){
      if(now()>=device.expiresAt){clearDevice(device);throw authError();}
      return deviceCall(device,method,request);
    }
    return oauthCall(method,request);
  }
  async function disconnect(){
    const current=passkeyVisit||device;generation++;passkeyVisit=null;registration=null;clearDevice();clearOAuth();
    if(current){try{await deviceCall(current,'signOutDevice');}catch(error){return {revoked:!!error.signIn};}}
    return {revoked:true};
  }
  async function signOutAll(){
    await authorize();await oauthCall('revokeAllDeviceSessions');
    generation++;passkeyVisit=null;registration=null;clearDevice();clearOAuth();
  }
  function forgetLocal(){generation++;passkeyVisit=null;registration=null;clearDevice();clearOAuth();}
  function serializeCredential(credential) {
    if(!credential || credential.type !== 'public-key')throw new Error('No passkey was selected.');
    const response={};
    for(const name of ['clientDataJSON','attestationObject','authenticatorData','signature','userHandle']){
      const value=credential.response[name];if(value)response[name]=env.encode(new Uint8Array(value));
    }
    return {id:credential.id,rawId:env.encode(new Uint8Array(credential.rawId)),type:credential.type,response};
  }
  function passkeyError(error) {
    if(error?.name==='NotAllowedError'||error?.name==='AbortError')return new Error('Passkey was canceled or timed out. Try again, or connect Google.');
    if(error?.name==='InvalidStateError')return new Error('A passkey already exists on this device. Use Unlock with Face ID / passkey.');
    return error;
  }
  async function preparePasskey() {
    if(!supportsPasskey())throw new Error('Passkeys are unavailable here. Open Daily Health in Safari on your iPhone.');
    if(passkeyBusy)throw new Error('Finish the current sign-in first.');
    const start=generation;passkeyBusy=true;
    try {
      const probe=passkeyStorageKey+'-check';env.storage().setItem(probe,'1');env.storage().removeItem(probe);
      await authorize();const options=await oauthCall('beginPasskeyRegistration');
      if(start!==generation)throw authError();
      if(options?.rp?.id!==new URL(config.origin).hostname||!options.challenge||!options.user?.id)throw new Error('Invalid passkey setup.');
      registration={options,generation:start};return true;
    } finally {passkeyBusy=false;}
  }
  async function createPasskey() {
    if(!registration||registration.generation!==generation||passkeyBusy)throw new Error('Start passkey setup again.');
    const current=registration, previous=device;registration=null;passkeyBusy=true;
    try {
      const options=current.options;
      const publicKey={...options,challenge:env.decode(options.challenge),user:{...options.user,id:env.decode(options.user.id)},excludeCredentials:(options.excludeCredentials||[]).map(item=>({...item,id:env.decode(item.id)}))};
      const credential=await env.credentials.create({publicKey});
      if(current.generation!==generation)throw authError();
      await oauthCall('finishPasskeyRegistration',{challenge:options.challenge,credential:serializeCredential(credential),...(previous?{previousSession:previous.token}:{})});
      if(current.generation!==generation)throw authError();
      // Server has revoked the old remembered token. Store only this nonsecret preference.
      clearDevice();clearOAuth();passkeyVisit=null;passkeyRemember();generation++;
      return {ok:true};
    } catch(error){throw passkeyError(error);} finally{passkeyBusy=false;}
  }
  async function passkeyPost(action,session,fields={}) {
    if(!deviceReady())throw authError();
    let response;
    try {response=await env.fetch(config.deviceEndpoint,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'follow',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({kind:'passkey',action,token:session,...fields}),signal:AbortSignal.timeout(55000)});}
    catch{throw new Error('Could not reach Daily Health. Check your connection and try again.');}
    let data;try{data=await response.json();}catch{throw new Error('Could not verify your passkey. Try again or connect Google.');}
    if(!response.ok||data?.ok!==true||!data.result)throw new Error(data?.message||'Passkey verification failed.');
    return data.result;
  }
  async function unlockPasskey() {
    if(!supportsPasskey())throw new Error('Passkeys are unavailable in this browser. Connect Google to continue.');
    if(passkeyBusy)throw new Error('Finish the current sign-in first.');
    const start=generation, session=randomToken();passkeyBusy=true;
    try {
      const options=await passkeyPost('begin',session);
      if(start!==generation)throw authError();
      if(options?.rpId!==new URL(config.origin).hostname)throw new Error('Invalid passkey request.');
      const credential=await env.credentials.get({publicKey:{...options,challenge:env.decode(options.challenge),userVerification:'required'}});
      if(start!==generation)throw authError();
      const result=await passkeyPost('finish',session,{challenge:options.challenge,credential:serializeCredential(credential)});
      const next={token:session,expiresAt:result.expiresAt};
      if(!Number.isFinite(next.expiresAt)||next.expiresAt<=now()||next.expiresAt>now()+15*60000+60000)throw new Error('Invalid passkey connection.');
      if(start!==generation){await deviceCall(next,'signOutDevice').catch(()=>{});throw authError();}
      // Storage failure must not leave a remembered bearer connection behind.
      const previous=device;clearDevice();clearOAuth();
      if(previous)await deviceCall(previous,'signOutDevice').catch(()=>{});
      passkeyRemember();passkeyVisit=next;return {ok:true};
    } catch(error){throw passkeyError(error);} finally {passkeyBusy=false;}
  }
  function lock() {
    const current=passkeyVisit;generation++;passkeyVisit=null;registration=null;clearOAuth();
    if(passkeyEnabled())clearDevice();
    if(current)deviceCall(current,'signOutDevice').catch(()=>{});
  }
  async function removePasskeys() {
    await authorize();await oauthCall('revokeAllPasskeys');
    env.storage?.().removeItem(passkeyStorageKey);forgetLocal();
  }
  return Object.freeze({ready,connect,call,disconnect,restore,rememberedUntil,signOutAll,forgetLocal,storageKey,
    passkeyStorageKey,supportsPasskey,passkeyEnabled,preparePasskey,createPasskey,unlockPasskey,removePasskeys,lock,
    passkeyBusy:()=>passkeyBusy,passkeyExpires:()=>passkeyVisit?.expiresAt||null});
});
