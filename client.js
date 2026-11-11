(function () {
  'use strict';
  const C = HealthCore;
  const $ = id => document.getElementById(id);
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  function formatSleep(minutes) {
    const total = Math.round(minutes);
    return `${Math.floor(total / 60)}h ${total % 60}m`;
  }
  function sleepInputs(prefix, minutes, large = false) {
    const hours = minutes === null ? '' : Math.floor(minutes / 60);
    const remainder = minutes === null ? '' : minutes % 60;
    return `<div class="field-pair" role="group" aria-label="${large ? 'Sleep duration' : 'Sleep goal'}"><div class="field"><label for="${prefix}-hours">Hours</label><input id="${prefix}-hours" name="${prefix}-hours" class="${large ? 'big-input' : ''}" type="number" inputmode="numeric" min="0" max="24" step="1" value="${hours}" placeholder="0"></div><div class="field"><label for="${prefix}-minutes">Minutes</label><input id="${prefix}-minutes" name="${prefix}-minutes" class="${large ? 'big-input' : ''}" type="number" inputmode="numeric" min="0" max="59" step="1" value="${remainder}" placeholder="0"></div></div>`;
  }
  function readSleep(prefix, optional = false) {
    const hoursText = $(prefix + '-hours').value.trim(), minutesText = $(prefix + '-minutes').value.trim();
    if (hoursText === '' && minutesText === '') {
      if (optional) return null;
      throw new Error('Enter the hours and minutes you slept.');
    }
    const hours = Number(hoursText || 0), minutes = Number(minutesText || 0);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || hours * 60 + minutes > 1440) throw new Error('Use whole hours and 0–59 minutes, up to 24 hours total.');
    return hours * 60 + minutes;
  }
  const paths = {
    check:'m5 12 4 4L19 6', chevron:'m9 5 7 7-7 7', back:'m15 5-7 7 7 7', plus:'M12 5v14M5 12h14', close:'m6 6 12 12M18 6 6 18',
    settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    today:'M8 3v4m8-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1M8 15l2 2 5-5',
    history:'M4 4v6h6M5 9a8 8 0 1 1-1 6m8-8v5l3 2', trends:'M4 4v16h16M7 15l4-5 4 2 5-7',
    weight:'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2M8 9a4 4 0 0 1 8 0m-4 0 2-3',
    moon:'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11', lift:'M5 7v10M2 9v6M19 7v10m3-8v6M5 12h14',
    cardio:'M3 12h4l3-7 4 14 3-7h4', sport:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M4 7l16 10M7 4l10 16M3 12h18',
    leaf:'M20 4C8 2 3 7 5 15c5 7 15 2 15-11ZM4 20 15 9', food:'M4 3v6a3 3 0 0 0 6 0V3M7 3v18M18 3v18m0-18c-4 3-4 8 0 8',
    fruit:'M12 6c-5-4-11 2-7 10 3 6 5 3 7 3s4 3 7-3c4-8-2-14-7-10Zm0 0c0-4 3-4 5-4',
    drink:'M6 4h12l-2 11H8L6 4Zm6 11v5m-4 0h8', calendar:'M7 3v4m10-4v4M4 10h16M4 5h16v15H4V5',
    export:'M12 3v12m-4-8 4-4 4 4M5 14v6h14v-6', edit:'m4 16-1 5 5-1L20 8l-4-4L4 16Zm9-9 4 4', cloud:'M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13 0 5 5 0 0 1 0 10', clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v5l3 2'
  };
  function icon(name, extra='') { return `<svg class="icon ${extra}" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.check}"/></svg>`; }
  const state = { settings: C.clone(C.DEFAULTS), days: [], selected: '', today: '', tab: 'today', historyMonth: '', loaded: false, queue: [], busy: false, failure: null, lastSaved: false, spreadsheetUrl: '', import: null };
  const preview = document.body.dataset.mode === 'preview';
  const pages = document.body.dataset.mode === 'pages';
  const previewKey = 'daily-health-preview-v1';
  let connectionGeneration=0;
  let previewHealthConnection={revision:0,paired:false,sleep:false,steps:false,endpoint:'https://example.invalid/daily-health-sync',results:{}};
  let toastTimer;
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'save-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  const readPreview = () => { try {
    const data = JSON.parse(localStorage.getItem(previewKey)) || { settings: C.clone(C.DEFAULTS), days: [], goals: [], forecasts: [] };
    data.days = data.days.map(day => ({ ...C.blankDay(day.date), ...day }));
    return data;
  } catch { return { settings: C.clone(C.DEFAULTS), days: [], goals: [], forecasts: [] }; } };
  function storePreview(data) { localStorage.setItem(previewKey, JSON.stringify(data)); }
  async function previewApi(method, request) {
    const data = readPreview(), today = C.today(data.settings.timezone);
    if (method === 'getHealthSyncStatus') return C.clone(previewHealthConnection);
    if (['createHealthSyncKey','saveHealthSyncPreferences','revokeHealthSyncKey'].includes(method)) {
      if(request.baseRevision!==previewHealthConnection.revision)throw new Error('Sync settings changed. Refresh and try again.');
      previewHealthConnection.revision++;
      if(method==='revokeHealthSyncKey')Object.assign(previewHealthConnection,{paired:false,sleep:false,steps:false});
      else Object.assign(previewHealthConnection,{sleep:request.sleep,steps:request.steps,...(method==='createHealthSyncKey'?{paired:true}:{})});
      return {...C.clone(previewHealthConnection),...(method==='createHealthSyncKey'?{key:'preview-only-key-not-valid-for-a-real-sheet'}:{})};
    }
    if (method === 'getBootstrap') return { ...data, today, mode: 'preview', spreadsheetUrl: '' };
    if (method === 'saveDay') {
      const index = data.days.findIndex(d => d.date === request.date), old = index < 0 ? C.blankDay(request.date) : data.days[index];
      if (old.mutationId === request.mutationId) return { ok: true, day: old };
      if (old.revision !== request.baseRevision) return { ok: false, conflict: true, day: old };
      const day = C.applyPatch(old, request.patch, data.settings, today, request.action);
      Object.assign(day, { revision: old.revision + 1, mutationId: request.mutationId, updatedAt: new Date().toISOString(), createdAt: old.createdAt || new Date().toISOString() });
      if (index < 0) data.days.push(day); else data.days[index] = day;
      storePreview(data); return { ok: true, day };
    }
    if (method === 'saveSettings') {
      if (data.settings.revision !== request.baseRevision) return { ok: false, conflict: true, settings: data.settings };
      data.settings = C.validateSettings(request.settings); data.settings.revision++;
      data.goals.push([today, JSON.stringify(data.settings)]); storePreview(data);
      return { ok: true, settings: data.settings, today: C.today(data.settings.timezone) };
    }
    if (method === 'deleteDay') {
      const old = data.days.find(d => d.date === request.date);
      if (old && old.revision !== request.baseRevision) return { ok: false, conflict: true, day: old };
      data.days = data.days.filter(d => d.date !== request.date); storePreview(data); return { ok: true };
    }
    if (method === 'exportData') return { ...data, schemaVersion: C.VERSION, exportedAt: new Date().toISOString() };
    if (method === 'importData') {
      const imported = C.validateImport(request.data, today), empty = data.days.length === 0;
      const existing = new Set(data.days.map(d => d.date)), added = imported.days.filter(d => !existing.has(d.date));
      data.days.push(...added.map(d => ({ ...d, revision: 1, mutationId: uid() })));
      if (empty) { data.settings = imported.settings; data.goals = request.data.goals || []; data.forecasts = request.data.forecasts || []; }
      storePreview(data); return { added: added.length, skipped: imported.days.length - added.length };
    }
    if (method === 'recordForecast') return { ok: true };
    throw new Error('Unknown preview action.');
  }
  function api(method, request) {
    if (!navigator.onLine) return Promise.reject(new Error('You are offline. Reconnect, then retry your save.'));
    if (preview) return previewApi(method, request);
    if (pages) return HealthConnection.call(method, request);
    if (!(window.google && google.script && google.script.run)) return Promise.reject(new Error('Open the deployed Google Apps Script app to connect to your Sheet.'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The save could not be confirmed. Retry to check it safely.')), 30000);
      const runner = google.script.run.withSuccessHandler(result => { clearTimeout(timer); resolve(result); }).withFailureHandler(error => { clearTimeout(timer); reject(new Error(error.message || 'Could not connect to Google.')); });
      runner[method](request);
    });
  }
  function showConnection(message) {
    document.body.classList.add('connection-locked');
    $('connection-message').textContent = message || (HealthConnection.ready()
      ? 'Connect with the Google account that owns your log.'
      : 'Your Google connection is being set up. Check back shortly.');
    $('connect-google').disabled = !HealthConnection.ready();
    $('connect-google').textContent = HealthConnection.rememberedUntil() ? 'Try again' : 'Connect Google';
  }
  async function connectGoogle(button) {
    button.disabled = true;
    try {
      if(button.id==='connect-google'&&HealthConnection.rememberedUntil()){await load();return;}
      const connection=await HealthConnection.connect({remember:button.id!=='connect-google'||$('remember-device')?.checked!==false});
      if (!state.loaded) await load();
      else { toast('Google connected. You can retry your save.'); render(); }
      if(connection.warning)toast(connection.warning);
    } catch (error) {
      if (!state.loaded) showConnection(error.message);
      else toast(error.message);
    } finally { button.disabled = false; }
  }
  function clearSignedInPage(message) {
    connectionGeneration++;
    Object.assign(state,{settings:C.clone(C.DEFAULTS),days:[],selected:'',today:'',tab:'today',historyMonth:'',loaded:false,queue:[],busy:false,failure:null,lastSaved:false,spreadsheetUrl:'',import:null});
    healthReview=null;healthConnection=null;$('main').replaceChildren();$('editor').close();$('dialog-content').replaceChildren();$('import-file').value='';$('toast').hidden=true;
    showConnection(message||'Signed out of Daily Health. Connect Google to open your log.');
  }
  function savedDay(date) { return state.days.find(d => d.date === date) || C.blankDay(date); }
  function visibleDay(date=state.selected) {
    let day = C.clone(savedDay(date));
    state.queue.filter(q => q.date === date).forEach(q => { day = C.applyPatch(day, q.patch, state.settings, state.today, q.action); });
    return day;
  }
  function putDay(day) { const index = state.days.findIndex(d => d.date === day.date); if (index < 0) state.days.push(day); else state.days[index] = day; }
  function toast(message, undo) {
    clearTimeout(toastTimer); $('toast').innerHTML = escape(message) + (undo ? '<button id="undo-action">Undo</button>' : ''); $('toast').hidden = false;
    if (undo) $('undo-action').onclick = () => { undo(); $('toast').hidden = true; };
    toastTimer = setTimeout(() => $('toast').hidden = true, undo ? 7000 : 4000);
  }
  function queueSave(patch, action) {
    if (state.failure) { toast('Retry your pending save first.'); return; }
    if (!navigator.onLine) { toast('Connect to the internet to save an entry.'); return; }
    const old = visibleDay();
    try { C.applyPatch(old, patch, state.settings, state.today, action); } catch (error) { toast(error.message); return; }
    const task = { date: state.selected, patch, action, mutationId: uid() };
    state.queue.push(task); render(); pump();
    if (!action) {
      const before = Object.fromEntries(Object.keys(patch).map(k => [k, old[k]]));
      toast('Entry updated', () => { if (state.selected === task.date) queueSave(before); });
    }
  }
  async function pump() {
    if (state.busy || state.failure || !state.queue.length) return;
    state.busy = true;
    const generation=connectionGeneration;
    while (state.queue.length && !state.failure) {
      const task = state.queue[0];
      if (!task.request) task.request = { ...task, baseRevision: savedDay(task.date).revision };
      try {
        const result = await api('saveDay', task.request);
        if(generation!==connectionGeneration)return;
        if (result.conflict) {
          putDay(result.day); state.queue = [];
          state.failure = { retryable: false, message: 'This day changed in another window. The latest entry is shown. Review it and make your change again.' };
        } else { putDay(result.day); state.queue.shift(); state.lastSaved = true; }
      } catch (error) { if(generation!==connectionGeneration)return;state.failure = { retryable: true, message: error.message, signIn: error.signIn }; }
      render();
    }
    state.busy = false; render();
  }
  function safeNavigate(fn) { if (state.queue.length || state.busy || healthBusy) { toast('Let your pending entry finish saving first.'); return; } fn(); render(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  function longDate(date, options={month:'long',day:'numeric'}) { return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { ...options, timeZone:'UTC' }); }
  function heading(title, subtitle) {
    const saving = state.queue.length > 0;
    return `<div class="page-heading"><div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="save-state ${state.failure?'error':''}" role="status">${state.failure||saving||state.lastSaved?icon(state.failure?'clock':saving?'cloud':'check'):''}${state.failure?'Not saved':saving?'Saving…':state.lastSaved?'Saved':''}</div></div>`;
  }
  function chip(key, label, glyph, day) { return `<button id="habit-${key}" class="chip" data-habit="${key}" aria-pressed="${day[key]===true}">${icon('check','check')}${glyph?icon(glyph,'habit-icon'):''}<span>${label}</span></button>`; }
  const waterLabels = { '0':'0', under50:'<50', '50to100':'50–100', over100:'>100' };
  const ratingLabels = { great:'Great', average:'Average', poor:'Poor' };
  const patternLabels = { sleep:'Sleep', steps:'Watch steps', fasting:'Fasting', alcohol:'Alcohol', water:'Water', quality:'Overall eating', fruit:'Fruit', veggie:'Veggie', protein:'Protein', chipsPretzels:'Chips/Pretzels', sweets:'Sweets', ateOut:'Eating out', zyn:'Zyn' };
  const patternState = { direction:'before', factor:'sleep' };
  const healthPreferencesKey = 'daily-health-sync-directions-v1';
  let healthPreferences = { sleep:true, steps:true, weight:true };
  try { const saved=JSON.parse(localStorage.getItem(healthPreferencesKey)||'null'); if(saved) for(const key of ['sleep','steps','weight']) if(typeof saved[key]==='boolean')healthPreferences[key]=saved[key]; } catch {}
  let healthBusy=false, healthReview=null, healthConnection=null, healthConnectionError='', healthStatusBusy=false;
  async function refreshHealthConnection() {
    if(healthStatusBusy||healthBusy||state.busy||state.queue.length)return;
    healthStatusBusy=true;healthConnectionError='';if(state.tab==='health')render();
    const generation=connectionGeneration;
    try {
      const [connection,latest]=await Promise.all([api('getHealthSyncStatus'),api('getBootstrap')]);
      if(generation!==connectionGeneration)return;
      healthConnection=connection;state.days=latest.days;state.settings=latest.settings;state.today=latest.today;
      if(healthConnection.paired) {healthPreferences.sleep=healthConnection.sleep;healthPreferences.steps=healthConnection.steps;}
    } catch(error) {healthConnectionError=error.message;}
    finally {healthStatusBusy=false;if(state.tab==='health')render();}
  }
  function healthConnectionCard() {
    const connection=healthConnection,paired=connection?.paired;
    const status=paired?'Ready for your iPhone automation':'Connect your iPhone once';
    return `<section class="card settings-card"><h2>Automatic imports</h2><p class="settings-intro">Your iPhone can send sleep and Watch steps when you open Messages. After the one-time setup, there is no paste or daily sync button.</p><p><strong>${status}</strong></p>${['sleep','steps'].map(kind=>{
      const result=connection?.results?.[kind];
      return `<div class="settings-row"><span>${kind==='sleep'?'Sleep':'Watch steps'}</span><span>${result?`${result.ok?'Received':'Needs attention'} · ${escape(new Date(result.at).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))}`:'Not received yet'}</span></div>${result&&!result.ok?`<p class="tiny danger">${escape(result.message)}</p>`:''}${result?.ok&&result.sourceMode==='unavailable'?'<p class="tiny">Sleep stages received; Shortcuts did not provide a device name.</p>':''}${result?.protected?'<p class="tiny">Manually entered values were kept.</p>':''}`;
    }).join('')}<p class="tiny">A connection key alone does not install the automation. First complete the iPhone steps and check for a received time here. Apple Health may be unavailable while the phone is locked.</p><p class="tiny danger" role="status">${escape(healthConnectionError)}</p><div class="health-actions"><button class="primary health-action" id="health-pair" ${!connection?.endpoint||healthStatusBusy?'disabled':''}>${paired?'Replace connection key':'Connect iPhone'}</button><button class="secondary health-action" id="health-sync-refresh" ${healthStatusBusy?'disabled':''}>${healthStatusBusy?'Checking…':'Refresh status'}</button></div>${paired?'<button class="text-button danger" id="health-revoke">Disconnect automatic imports</button>':''}${preview?'<p class="tiny">Preview only: these connection details cannot access a real Sheet.</p>':!connection?.endpoint&&!healthStatusBusy&&!healthConnectionError?'<p class="tiny">The automatic connection is being prepared.</p>':''}<a class="health-guide-link" href="https://health.theaubuchonfamily.com/apple-health-setup.html#automatic" target="_blank" rel="noopener">One-time iPhone setup ${icon('chevron')}</a></section>`;
  }
  async function pairHealthPhone() {
    if(healthBusy||!healthConnection?.endpoint)return;
    openDialog(dialogHead(healthConnection.paired?'Replace iPhone connection?':'Connect your iPhone')+`<p>This key lets your iPhone send sleep and Watch steps to your private log. It cannot read your log or change your weight or food entries. ${healthConnection.paired?'Replacing it stops the old key immediately; update both Shortcuts with the new key.':''}</p><p class="tiny">Keep the key private. You can disconnect it from this page at any time.</p><p id="health-pair-error" class="tiny danger" role="alert"></p><button class="primary" id="health-create-key">Create connection key</button>`);
    $('health-create-key').onclick=async()=>{
      healthBusy=true;$('health-create-key').disabled=true;$('close-dialog').disabled=true;
      try {
        const result=await api('createHealthSyncKey',{baseRevision:healthConnection.revision,sleep:healthPreferences.sleep,steps:healthPreferences.steps});
        const {key,...connection}=result;healthConnection=connection;
        openDialog(dialogHead('Add this to your iPhone')+`<p>Copy these into the last steps of your Daily Health Shortcuts. The key is shown only here and is cleared when you close this window.</p><label for="health-sync-url">Connection address</label><input id="health-sync-url" type="text" readonly autocomplete="off" value="${escape(connection.endpoint)}"><button class="secondary" id="health-copy-url">Copy address</button><label for="health-sync-key">Private connection key</label><input id="health-sync-key" type="password" readonly autocomplete="off" value="${escape(key)}"><button class="secondary" id="health-copy-key">Copy key</button><p class="tiny" id="health-copy-status" role="status"></p><a class="health-guide-link" href="https://health.theaubuchonfamily.com/apple-health-setup.html#automatic" target="_blank" rel="noopener">Finish iPhone setup ${icon('chevron')}</a><p class="tiny">In the request use <strong>kind: sleep</strong> for Sleep or <strong>kind: steps</strong> for Steps. Leave the key out of the address.</p>`);
        for(const [button,id] of [['health-copy-url','health-sync-url'],['health-copy-key','health-sync-key']]) $(button).onclick=async()=>{
          try {await navigator.clipboard.writeText($(id).value);$('health-copy-status').textContent='Copied. Paste it into your Shortcut.';}
          catch {$(id).type='text';$(id).focus();$(id).select();$('health-copy-status').textContent='Touch and hold the selected value, then choose Copy.';}
        };
        render();
      }catch(error){$('health-pair-error').textContent=error.message;$('health-create-key').disabled=false;}
      finally{healthBusy=false;$('close-dialog').disabled=false;render();}
    };
  }
  function disconnectHealthPhone() {
    if(healthBusy||!healthConnection?.paired)return;
    openDialog(dialogHead('Disconnect automatic imports?')+'<p>Your current iPhone key will stop working. Your saved entries will stay in your log.</p><p id="health-pair-error" class="tiny danger" role="alert"></p><button class="primary" id="health-revoke-confirm">Disconnect</button>');
    $('health-revoke-confirm').onclick=async()=>{
      healthBusy=true;$('health-revoke-confirm').disabled=true;$('close-dialog').disabled=true;
      try{healthConnection=await api('revokeHealthSyncKey',{baseRevision:healthConnection.revision});healthPreferences.sleep=false;healthPreferences.steps=false;$('editor').close();render();toast('Automatic imports disconnected');}
      catch(error){$('health-pair-error').textContent=error.message;$('health-revoke-confirm').disabled=false;}
      finally{healthBusy=false;$('close-dialog').disabled=false;render();}
    };
  }
  async function changeHealthDirection(input) {
    if(healthBusy||healthStatusBusy)return;
    const key=input.dataset.healthDirection,next=input.value==='on',previous=healthPreferences[key];
    if(key!=='weight'&&!healthConnection&&!preview){toast('Refresh sync status before changing this direction.');render();return;}
    healthBusy=true;input.disabled=true;
    try{
      if(key!=='weight'&&healthConnection?.paired){healthConnection=await api('saveHealthSyncPreferences',{baseRevision:healthConnection.revision,sleep:key==='sleep'?next:healthPreferences.sleep,steps:key==='steps'?next:healthPreferences.steps});}
      healthPreferences[key]=next;
      try{localStorage.setItem(healthPreferencesKey,JSON.stringify(healthPreferences));}catch{}
    }catch(error){healthPreferences[key]=previous;toast(error.message);}
    finally{healthBusy=false;render();}
  }
  function renderAppleHealth() {
    const directions=[['sleep','Sleep','Apple Health → Daily Health'],['steps','Watch steps','Apple Health → Daily Health'],['weight','Weight','Daily Health → Apple Health']];
    return heading('Apple Health','Connected to your routine')+healthConnectionCard()+`<section class="card settings-card"><h2>Your directions</h2><p class="settings-intro">When connected, turning sleep or steps off also stops incoming automatic imports. Weight uses your iPhone Shortcut when you choose to send a saved reading.</p>${directions.map(([key,label,direction])=>`<div class="field"><label for="health-direction-${key}">${label}</label><select id="health-direction-${key}" data-health-direction="${key}" ${healthBusy||healthStatusBusy?'disabled':''}><option value="on" ${healthPreferences[key]?'selected':''}>${direction}</option><option value="off" ${healthPreferences[key]?'':'selected'}>Off</option></select></div>`).join('')}<p class="tiny">Automatic imports preserve manual entries and corrections. JEFIT importing is off; keep recording lifting and its grade here.</p></section>
    <details class="health-manual"><summary>Manual import backup</summary><section class="card settings-card"><h2>Bring in sleep</h2><p class="settings-intro">Run Daily Health Sleep on your iPhone, then return here and paste its result. Review each night before saving.</p><div class="health-actions"><a class="secondary health-action ${healthPreferences.sleep?'':'disabled-link'}" ${healthPreferences.sleep?`href="${AppleHealthBridge.shortcutUrl('Daily Health Sleep')}"`:'aria-disabled="true"'}>Run sleep Shortcut</a><button class="primary health-action" id="health-import-sleep" ${healthPreferences.sleep?'':'disabled'}>Paste sleep</button></div><p class="tiny">Sleep is stored in your private Sheet. Existing entries are only replaced if you select them in the review.</p></section>
    <section class="card settings-card"><h2>Bring in Watch steps</h2><p class="settings-intro">Run Daily Health Steps, then paste its result. Watch counts may differ from Apple Health’s combined total. Import after the day ends for a complete day.</p><div class="health-actions"><a class="secondary health-action ${healthPreferences.steps?'':'disabled-link'}" ${healthPreferences.steps?`href="${AppleHealthBridge.shortcutUrl('Daily Health Steps')}"`:'aria-disabled="true"'}>Run steps Shortcut</a><button class="primary health-action" id="health-import-steps" ${healthPreferences.steps?'':'disabled'}>Paste steps</button></div></section>
    </details><section class="card settings-card"><h2>Send a saved weight</h2><p class="settings-intro">Choose a day with a saved home-scale weight. Your iPhone Shortcut checks for an existing weight that day before adding one.</p><div class="field"><label for="health-weight-date">Weight date</label><input id="health-weight-date" type="date" max="${state.today}" value="${state.selected}"></div><button class="primary health-action" id="health-export-weight" ${healthPreferences.weight?'':'disabled'}>Review weight to send</button><p class="tiny">Apple Health confirms the save in Shortcuts. Sending a weight does not change your Daily Health log.</p></section><button class="text-button" id="health-back-settings">Back to Settings</button>`;
  }
  function openSleepImport(kind='sleep') {
    if(!healthPreferences[kind])return;
    const label=kind==='steps'?'Steps':'Sleep',field=kind==='steps'?'steps':'sleepMinutes';
    openDialog(dialogHead('Import '+label.toLowerCase())+`<p class="settings-intro">Paste the result from Daily Health ${label}. Nothing is saved until you review it.</p><label class="sr-only" for="health-sleep-text">${label} Shortcut result</label><textarea id="health-sleep-text" class="health-paste" rows="7" placeholder="Paste your result here" spellcheck="false" autocomplete="off"></textarea><p id="health-error" class="tiny danger" role="alert"></p><div class="dialog-actions"><button class="secondary" id="health-read-clipboard">Paste from clipboard</button><button class="primary" id="health-review-sleep">Review days</button></div>`);
    $('health-read-clipboard').onclick=async()=>{try{$('health-sleep-text').value=await navigator.clipboard.readText();}catch{$('health-error').textContent='Touch and hold the text box, then choose Paste.';}};
    $('health-review-sleep').onclick=async()=>{
      const button=$('health-review-sleep'),text=$('health-sleep-text').value;button.disabled=true;healthBusy=true;$('close-dialog').disabled=true;
      try {
        const latest=await api('getBootstrap');state.settings=C.validateSettings(latest.settings);state.days=latest.days.map(d=>({...C.blankDay(d.date),...d}));state.today=latest.today;
        const imported=(kind==='steps'?AppleHealthBridge.parseSteps:AppleHealthBridge.parseSleep)(text,state.settings.timezone,state.today);
        if(!imported.days.length)throw new Error(kind==='steps'?'No Apple Watch step samples were found. Check the Shortcut’s Source and Health permissions.':'No time asleep was found. Check the Shortcut’s Health permissions and date range.');
        healthReview={kind,field,rows:AppleHealthBridge.samplePlan(imported.days,state.days,field),usedWatch:imported.usedWatch,tasks:null,done:0};
        showSleepReview();
      }catch(error){button.disabled=false;$('health-error').textContent=error.message;}finally{healthBusy=false;$('close-dialog').disabled=false;}
    };
  }
  function showSleepReview() {
    const review=healthReview,steps=review.kind==='steps',format=n=>steps?n.toLocaleString()+' steps':formatSleep(n);
    openDialog(dialogHead(steps?'Review Watch steps':'Review sleep')+`<p class="settings-intro">${steps?'Watch samples only; iPhone counts are excluded. Today’s count may be incomplete.':'Awake time is excluded and overlapping samples count once. Nights use the date the sleep session ended.'} ${review.usedWatch?'Using Apple Watch samples.':'No Apple Watch source label was found; check these totals carefully.'} Check the oldest day in case the date range cuts it short.</p><div class="health-review-list">${review.rows.map((row,i)=>`<label class="health-review-row"><input type="checkbox" data-health-row="${i}" ${row.selected?'checked':''} ${row.unchanged?'disabled':''}><span><strong>${longDate(row.date,{month:'short',day:'numeric'})}</strong><span>${format(row[review.field])}</span><small>${row.unchanged?'Already matches — no change':row.previous===null?'New entry':`Replace ${format(row.previous)} only if selected`}</small></span></label>`).join('')}</div><p id="health-import-status" class="tiny" role="status">Existing entries start unselected.</p><p id="health-error" class="tiny danger" role="alert"></p><button class="text-button" id="health-reconnect" hidden>Reconnect Google</button><div class="dialog-actions"><button class="secondary" id="health-cancel-review">Cancel</button><button class="primary" id="health-save-sleep">Save selected days</button></div>`);
    document.querySelectorAll('[data-health-row]').forEach(input=>input.onchange=()=>review.rows[Number(input.dataset.healthRow)].selected=input.checked);
    $('health-cancel-review').onclick=()=>{$('editor').close();healthReview=null;};
    $('health-reconnect').onclick=async()=>{try{await HealthConnection.connect();$('health-reconnect').hidden=true;$('health-error').textContent='Connected. Resume the import.';}catch(error){$('health-error').textContent=error.message;}};
    $('health-save-sleep').onclick=saveSleepImport;
  }
  async function saveSleepImport() {
    if(healthBusy||!healthReview||!healthPreferences[healthReview.kind])return;
    const review=healthReview;
    if(!review.tasks)review.tasks=review.rows.filter(row=>row.selected&&!row.unchanged).map(row=>({date:row.date,baseRevision:row.revision,mutationId:uid(),patch:{[review.field]:row[review.field]}}));
    if(!review.tasks.length){$('health-error').textContent='Select at least one changed day.';review.tasks=null;return;}
    healthBusy=true;
    ['health-save-sleep','health-cancel-review','close-dialog'].forEach(id=>$(id).disabled=true);
    document.querySelectorAll('[data-health-row]').forEach(input=>input.disabled=true);
    $('health-error').textContent='';
    try {
      while(review.done<review.tasks.length) {
        $('health-import-status').textContent=`Saving day ${review.done+1} of ${review.tasks.length}…`;
        const result=await api('saveDay',review.tasks[review.done]);
        if(result.conflict){putDay(result.day);review.conflict=true;throw new Error('A day changed elsewhere. Close this review and paste again to compare the latest entries. Completed saves are already in your log.');}
        if(!result.ok)throw new Error('The save was not confirmed. Resume to check it safely.');
        putDay(result.day);review.done++;
      }
      const count=review.done;healthReview=null;state.lastSaved=true;$('editor').close();render();toast(`${count} ${count===1?'day':'days'} saved`);
    } catch(error) {
      $('health-error').textContent=error.message;
      $('health-import-status').textContent=`${review.done} of ${review.tasks.length} days confirmed saved.`;
      $('health-save-sleep').textContent='Resume import';
      if(error.signIn&&pages)$('health-reconnect').hidden=false;
    } finally {
      healthBusy=false;
      if($('health-save-sleep')){
        $('health-save-sleep').disabled=!!review.conflict;
        $('health-cancel-review').disabled=false;$('close-dialog').disabled=false;
      }
    }
  }
  function reviewHealthWeight() {
    if(!healthPreferences.weight)return;
    try {
      const date=$('health-weight-date').value, day=savedDay(date);
      const payload=AppleHealthBridge.weightPayload(day,state.settings,state.today);
      openDialog(dialogHead('Send weight')+`<p>${longDate(date,{weekday:'short',month:'long',day:'numeric'})}</p><p class="trend-metric">${C.formatWeight(day.weightKg,state.settings.unit)} <span class="metric-unit">${state.settings.unit}</span></p><p class="settings-intro">Open your Daily Health Weight Shortcut to add this home-scale reading to Apple Health. It must check for an existing weight first. The entry uses noon in your log timezone, or the current time if noon has not passed.</p><a id="health-run-weight" class="primary health-action health-guide-link" href="${escape(AppleHealthBridge.shortcutUrl('Daily Health Weight',payload))}">Open iPhone Shortcut</a><p class="tiny">Not set up yet? Follow the weight steps in <a href="https://health.theaubuchonfamily.com/apple-health-setup.html#weight" target="_blank" rel="noopener">iPhone setup</a>. The save is confirmed by Shortcuts, not this page.</p>`);
    }catch(error){toast(error.message);}
  }
  function workoutRating(day) {
    if (!C.hasWorkout(day)) return '';
    return `<div class="workout-grade"><h3 id="workout-grade-title">How was your workout?</h3><div class="rating-options" role="group" aria-labelledby="workout-grade-title">${C.WORKOUT_RATINGS.map(value=>`<button type="button" class="chip rating-choice" id="rating-${value}" data-rating="${value}" aria-pressed="${day.workoutRating===value}">${ratingLabels[value]}</button>`).join('')}</div><p class="tiny amount-help">One overall grade for the day. Optional; tap again to clear.</p></div>`;
  }
  function renderWorkoutPatterns() {
    const {direction,factor}=patternState, result=C.workoutPatterns(state.days,state.today,direction,factor);
    const before=direction==='before';
    const metric=before?'Average workout grade':factor==='sleep'?'Average sleep after workout':factor==='steps'?'Average steps after workout':factor==='fasting'?'Following days with fasting logged':factor==='water'?'Following days with 50+ oz water':factor==='quality'?'Following days rated Healthy':factor==='alcohol'?'Following days with alcohol':`Following days with ${patternLabels[factor]}`;
    const timing=before?(factor==='sleep'?'Uses the night ending on the workout date.':'Uses the calendar day before each workout.'):(factor==='sleep'?'Uses the night ending on the day after each workout.':'Uses the calendar day after each workout.');
    const groups=result.groups.map(g=>`<div class="pattern-row"><div><strong>${before?escape(g.key):ratingLabels[g.key]+' workouts'}</strong><span class="tiny">${g.count} matched ${g.count===1?'day':'days'}</span></div><div class="pattern-value">${result.ready&&g.count>=result.minimum?(before?`${g.mean.toFixed(1)}<small> / 3</small>`:factor==='sleep'?`${formatSleep(g.mean*60)}`:factor==='steps'?`${Math.round(g.mean).toLocaleString()}<small> steps</small>`:`${Math.round(g.mean)}<small>%</small>`):'<span class="tiny">Keep logging</span>'}</div></div>`).join('');
    return `<section class="card wide" id="workout-patterns"><div class="row"><h2>Workouts & habits</h2><span class="tiny">Last 90 days</span></div><p class="outlook-note">${result.ratedCount} rated workout ${result.ratedCount===1?'day':'days'}. Explore what came before and what followed.</p><div class="pattern-directions" role="group" aria-label="Workout comparison timing">${['before','after'].map(value=>`<button class="chip" data-pattern-direction="${value}" aria-pressed="${direction===value}">${value==='before'?'Before workouts':'After workouts'}</button>`).join('')}</div><div class="field"><label for="pattern-factor">Compare with</label><select id="pattern-factor">${Object.entries(patternLabels).map(([key,label])=>`<option value="${key}" ${factor===key?'selected':''}>${label}</option>`).join('')}</select></div><h3>${escape(metric)}</h3><p class="tiny amount-help">${timing}</p>${groups||'<p class="outlook-note">Add workout grades and nearby habit entries to start a comparison.</p>'}<p class="outlook-note">${result.ready?'':`Comparisons appear with at least ${result.minimum} matched days in each of two groups. `}${before?'Grade scale: 1 = Poor, 2 = Average, 3 = Great. ':''}Missing entries are excluded. These are associations; other factors may matter.</p></section>`;
  }
  function amountButtons(key, values, day) {
    const water = key === 'waterOzRange';
    return `<div class="amount-options ${water?'water-options':''}" role="group" aria-label="${water?'Daily water in ounces':'Total alcoholic drinks for the day'}">${values.map(value => {
      const label = water ? waterLabels[value] : value.replace('-', '–');
      return `<button type="button" class="chip amount-choice" id="amount-${key}-${value}" data-amount="${key}" data-value="${value}" aria-pressed="${day[key]===value}" aria-label="${escape(label)} ${water?'ounces of water':'drinks'}"><span>${escape(label)}</span>${water?'<small>oz</small>':''}</button>`;
    }).join('')}</div>`;
  }
  function renderToday() {
    const d = visibleDay(), past = state.selected !== state.today;
    const previous = state.days.filter(x => x.date < d.date && x.weightKg !== null).sort((a,b)=>b.date.localeCompare(a.date))[0];
    return heading(past?'Daily log':'Today', past?`Editing ${longDate(d.date)}`:'Your daily check-in') + `
    <div class="date-bar"><button class="icon-button" id="prev-day" aria-label="Previous day">${icon('back')}</button><div class="date-picker"><input id="selected-date" type="date" value="${d.date}" max="${state.today}" min="1900-01-01" aria-label="Choose a day to view or edit"><label for="selected-date">Edit date</label></div><button class="icon-button" id="next-day" aria-label="Next day" ${past?'':'disabled'}>${icon('chevron')}</button></div>
    ${past?'<button id="back-today" class="back-today">Back to today</button>':''}
    ${state.failure?`<div class="error-box" role="alert">${escape(state.failure.message)}${state.failure.signIn?'<p><button id="reconnect-google">Reconnect Google</button></p>':''}<button id="retry-save">${state.failure.retryable?'Retry save':'Continue editing'}</button></div>`:''}
    <div class="today-grid"><div><div class="summary-grid">
      <section class="card"><div class="card-heading"><span class="section-icon">${icon('weight')}</span><h2>Weight</h2></div><button id="edit-weight" class="metric-button" aria-label="${d.weightKg===null?'Enter':'Edit'} weight"><span class="metric-value ${d.weightKg===null?'metric-empty':''}">${d.weightKg===null?(d.weightStatus==='away'?'Away':'Add weight'):C.formatWeight(d.weightKg,state.settings.unit)}</span>${d.weightKg!==null?`<span class="metric-unit">${state.settings.unit}</span>`:''}</button><p class="metric-caption">${previous?`Last: ${C.formatWeight(previous.weightKg,state.settings.unit)} ${state.settings.unit}`:'Your home scale'}</p><button id="away" class="text-button">${d.weightStatus==='away'?'Clear away status':'Away from home scale'}</button></section>
      <section class="card"><div class="card-heading"><span class="section-icon violet">${icon('moon')}</span><h2>Sleep</h2></div><button id="edit-sleep" class="metric-button" aria-label="${d.sleepMinutes===null?'Enter':'Edit'} sleep"><span class="metric-value ${d.sleepMinutes===null?'metric-empty':''}">${d.sleepMinutes===null?'Add sleep':formatSleep(d.sleepMinutes)}</span></button><p class="metric-caption">Night ending ${longDate(d.date,{month:'short',day:'numeric'})}</p><button id="sleep-shortcut" class="text-button">${d.sleepMinutes===null?'How long did you sleep?':'Edit duration'}</button></section><section class="card steps-card"><div class="card-heading"><span class="section-icon mint">${icon('cardio')}</span><h2>Steps</h2></div><button id="edit-steps" class="metric-button" aria-label="${d.steps===null?'Enter':'Edit'} steps"><span class="metric-value ${d.steps===null?'metric-empty':''}">${d.steps===null?'Add steps':d.steps.toLocaleString()}</span></button><p class="metric-caption">Apple Watch · daily total</p></section>
    </div><section class="card"><div class="card-heading"><span class="section-icon mint">${icon('lift')}</span><h2>Exercise</h2></div><div class="chips equal">${chip('lift','Lift Weights','lift',d)}${chip('cardio','Cardio','cardio',d)}${state.settings.sportEnabled?chip('sport','Sport','sport',d):''}</div><p class="tiny" style="margin-top:13px">Select anything you did ${past?'that day':'today'}.</p>${workoutRating(d)}</section></div>
    <section class="card food-card"><div class="card-heading"><span class="section-icon mint">${icon('leaf')}</span><h2>Food & habits</h2></div><p class="tiny" style="margin-bottom:13px">How was the day overall?</p><div class="quality">${['healthy','unhealthy'].map(v=>`<button id="quality-${v}" class="chip" data-quality="${v}" aria-pressed="${d.quality===v}">${icon('check','check')}<span>${v==='healthy'?'Healthy':'Unhealthy'}</span></button>`).join('')}</div>
      <div class="food-group"><h3>Food groups</h3><div class="chips equal">${chip('fruit','Fruit',null,d)}${chip('veggie','Veggie',null,d)}${chip('protein','Protein',null,d)}</div></div>
      <div class="food-group"><h3>Alcohol</h3><div class="chips equal">${chip('beer','Beer',null,d)}${chip('margarita','Margarita',null,d)}</div><p class="amount-label">Total drinks for the day</p>${amountButtons('alcoholDrinks',C.DRINK_RANGES,d)}</div>
      <div class="food-group"><h3>Water</h3>${amountButtons('waterOzRange',C.WATER_RANGES,d)}<p class="tiny amount-help">Daily total. Tap a selected amount again to clear it.</p></div>
      <div class="food-group"><h3 id="fasting-title">Fasting</h3><div class="fasting-options" role="group" aria-labelledby="fasting-title">${C.FASTING_OPTIONS.map(option=>`<button type="button" class="chip" id="fasting-${option.key}" data-fasting="${option.key}" aria-pressed="${C.fastingChoice(d)===option.key}">${option.label}</button>`).join('')}</div><p class="tiny amount-help">Log a fast on the day it ends. At 20 hours, choose 20–24. Tap again to clear.</p></div>
      <div class="food-group"><h3>Unhealthy snacks</h3><div class="chips equal">${chip('chipsPretzels','Chips/Pretzels',null,d)}${chip('sweets','Sweets',null,d)}</div></div>
      <div class="food-group"><h3>Eating out</h3><div class="chips equal">${chip('ateOut','Ate out','food',d)}</div></div>
      <div class="divider"></div><div class="row"><div><h2 style="font-size:16px">Zyn</h2><p class="tiny">Did you use it ${past?'that day':'today'}?</p></div><div class="segmented" aria-label="Zyn use"><button id="zyn-yes" data-zyn="true" aria-pressed="${d.zyn===true}">Yes</button><button id="zyn-no" data-zyn="false" aria-pressed="${d.zyn===false}">No</button></div></div>
    </section><section class="card notes-card"><div class="card-heading"><span class="section-icon">${icon('edit')}</span><h2>Notes</h2></div>${d.notes?`<p class="notes-text">${escape(d.notes)}</p>`:'<p class="settings-intro">Trips, work events, or anything else about your day.</p>'}<button id="edit-notes" class="full-button">${d.notes?'Edit note':'Add note'} ${icon('chevron')}</button></section><div class="daily-footer"><button id="finish-day" class="finish ${C.complete(d)?'completed':''}" ${C.complete(d)?'disabled':''}>${C.complete(d)?icon('check'):''}<span>${C.complete(d)?'Log complete':past?"Finish this day’s log":"Finish today’s log"}</span></button><p class="finish-note">${C.complete(d)?'You can still edit any entry.':'Confirms unselected habits as “No.” Measurements, fasting, notes, and workout grades can stay blank.'}</p>${C.hasContent(savedDay(d.date))?'<button id="delete-day" class="text-button danger" style="display:block;margin:18px auto 0">Delete this day’s entries</button>':''}</div></div>`;
  }
  function chart(series) {
    if (!series.length) return `<div class="empty">${icon('trends')}Your weight chart starts with your first weigh-in.</div>`;
    const lo = Math.min(...series.map(d=>d.weight))-.4, hi = Math.max(...series.map(d=>d.weight))+.4;
    const first=series[0].date, last=series[series.length-1].date, span=Math.max(7,C.distance(first,last));
    const x=d=>40+C.distance(first,d.date)/span*470, y=n=>155-(n-lo)/(hi-lo)*128;
    const line=series.map((d,i)=>`${i?'L':'M'}${x(d).toFixed(1)} ${y(d.weight).toFixed(1)}`).join(' ');
    let avg=''; let previous=null;
    series.forEach(d=>{if(d.average!==null){avg+=(previous && C.distance(previous.date,d.date)<=7?'L':'M')+x(d).toFixed(1)+' '+y(d.average).toFixed(1)+' ';previous=d;}else previous=null;});
    return `<svg class="chart" viewBox="0 0 550 185" role="img" aria-label="Recorded weights and trailing seven-day average"><line x1="40" y1="155" x2="515" y2="155" stroke="var(--line)"/><line x1="40" y1="28" x2="515" y2="28" stroke="var(--line)"/><text x="0" y="32">${C.formatWeight(hi,state.settings.unit)}</text><text x="0" y="158">${C.formatWeight(lo,state.settings.unit)}</text><path d="${line}" fill="none" stroke="var(--blue)" stroke-width="1.5" opacity=".4"/>${series.map(d=>`<circle cx="${x(d)}" cy="${y(d.weight)}" r="3" fill="var(--blue)"/>`).join('')}<path d="${avg}" fill="none" stroke="var(--mint)" stroke-width="3" stroke-linecap="round"/><text x="40" y="180">${longDate(first,{month:'short',day:'numeric'})}</text><text x="515" y="180" text-anchor="end">${longDate(last,{month:'short',day:'numeric'})}</text></svg><div class="chart-legend"><span><i class="legend-dot"></i>Weigh-ins</span><span><i class="legend-dot mint"></i>7-day average</span></div>`;
  }
  function renderTrends() {
    const week=C.weekly(state.days,state.today,state.settings), series=C.weightSeries(state.days.filter(d=>C.distance(d.date,state.today)<90)), prediction=C.forecast(state.days,state.today);
    const last=series[series.length-1];
    const sleeps=state.days.filter(d=>d.date<=state.today&&C.distance(d.date,state.today)<7&&d.sleepMinutes!==null);
    const sleepAverage=sleeps.length?sleeps.reduce((sum,d)=>sum+d.sleepMinutes,0)/sleeps.length:null;
    const stepDays=state.days.filter(d=>d.date<=state.today&&C.distance(d.date,state.today)<7&&d.steps!=null);
    const stepAverage=stepDays.length?Math.round(stepDays.reduce((sum,d)=>sum+d.steps,0)/stepDays.length):null;
    return heading('Your trends','A little perspective on your progress')+`<div class="trends-grid"><section class="card wide"><div class="row"><h2>This week</h2><span class="tiny">${state.settings.weightMode==='maintain'?'Maintaining':'Losing'} · ${state.settings.unit}</span></div><div class="week-dots">${week.dates.map(date=>`<div class="week-day"><span class="day-dot ${C.complete(savedDay(date))?'done':''} ${date===state.today?'today':''}">${C.complete(savedDay(date))?icon('check'):new Date(date+'T12:00:00Z').getUTCDate()}</span>${longDate(date,{weekday:'short'}).slice(0,3)}</div>`).join('')}</div><div class="stats"><div class="stat"><strong>${week.completed}<span> / ${week.elapsed}</span></strong><span>Days logged so far</span></div><div class="stat"><strong>${week.active}${state.settings.exerciseGoal?`<span> / ${state.settings.exerciseGoal}</span>`:''}</strong><span>Active days</span></div><div class="stat"><strong>${week.weighed}</strong><span>Weigh-ins</span></div></div></section>
    <section class="card wide"><div class="row"><h2>Weight</h2><span class="tiny">Last 90 days</span></div>${last?`<div class="trend-metric">${C.formatWeight(last.weight,state.settings.unit)} <span class="metric-unit">${state.settings.unit}</span></div><p class="tiny">Latest reading · ${longDate(last.date)}${last.average!==null?` · 7-day average ${C.formatWeight(last.average,state.settings.unit)} (${last.count} readings)`:''}</p>`:''}${chart(series)}${goalText()}</section>
    <section class="card"><h2>Weight outlook</h2>${prediction.ready?`<div class="trend-metric">${C.formatWeight(prediction.estimateKg,state.settings.unit)} <span class="metric-unit">${state.settings.unit}</span></div><p class="tiny">Next 7-day average · preliminary</p><p class="outlook-note">Recent-variability range: ${C.formatWeight(prediction.lowerKg,state.settings.unit)}–${C.formatWeight(prediction.upperKg,state.settings.unit)} ${state.settings.unit}.</p><p class="outlook-note">${prediction.detail} Data through ${longDate(prediction.dataThrough)}.</p>`:`<div class="empty" style="text-align:left;padding:24px 0 8px"><strong>${prediction.reason}</strong><p class="outlook-note">${prediction.detail}</p></div>`}</section>
    <section class="card"><h2>Daily consistency</h2><div class="streaks" style="margin-top:18px">${['fruit','veggie'].map(k=>{const s=C.streak(state.days,k,state.today);return `<div class="streak-card"><span>${k==='fruit'?'Fruit':'Veggie'}</span><strong>${s.count} <span>${s.count===1?'day':'days'}</span></strong><span>Current streak</span></div>`;}).join('')}</div><p class="outlook-note">Missing dates interrupt a verified streak. Today stays open until midnight.</p></section>
    <section class="card wide"><div class="row"><h2>Watch steps</h2><span class="tiny">Last 7 days</span></div>${stepAverage===null?'<p class="outlook-note">Import or enter steps to see your daily average.</p>':`<div class="trend-metric">${stepAverage.toLocaleString()} <span class="metric-unit">steps / day</span></div><p class="outlook-note">Average across ${stepDays.length} logged ${stepDays.length===1?'day':'days'}. Missing days stay blank; today may be incomplete.</p>`}</section>
    ${renderWorkoutPatterns()}
    <section class="card wide"><div class="row"><h2>Sleep</h2><span class="tiny">Last 7 days</span></div>${sleepAverage===null?'<p class="outlook-note">Log your sleep to see your average here.</p>':`<div class="trend-metric">${formatSleep(sleepAverage)}</div><p class="outlook-note">Average across ${sleeps.length} logged ${sleeps.length===1?'night':'nights'}. Missing nights stay blank.</p>`}${state.settings.sleepGoalMinutes===null?'':`<p class="tiny">Your goal: ${formatSleep(state.settings.sleepGoalMinutes)}${sleeps.length?' · Met on '+sleeps.filter(d=>d.sleepMinutes>=state.settings.sleepGoalMinutes).length+' of '+sleeps.length+' logged nights':''}.</p>`}</section></div>`;
  }
  function goalText() {
    const s=state.settings;
    if(s.weightMode==='maintain' && s.rangeMinKg!==null)return `<p class="outlook-note">Your maintenance range: ${C.formatWeight(s.rangeMinKg,s.unit)}–${C.formatWeight(s.rangeMaxKg,s.unit)} ${s.unit}</p>`;
    if(s.weightMode==='lose' && s.goalWeightKg!==null)return `<p class="outlook-note">Your optional goal: ${C.formatWeight(s.goalWeightKg,s.unit)} ${s.unit}</p>`;
    return '<p class="outlook-note">Add an optional weight goal in Settings.</p>';
  }
  function renderHistory() {
    const month=state.historyMonth||state.today.slice(0,7), first=month+'-01';
    const last=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate();
    const dates=Array.from({length:last},(_,i)=>month+'-'+String(i+1).padStart(2,'0')).filter(date=>date<=state.today).reverse();
    return heading('History','Review, backfill, or change any day')+`<div class="card"><div class="row"><h2>Choose a day</h2><input id="history-month" type="month" value="${month}" max="${state.today.slice(0,7)}" aria-label="History month" style="max-width:180px;border:1px solid var(--line);border-radius:10px;padding:10px;background:var(--card);color:var(--text)"></div>${dates.map(date=>{const d=savedDay(date);const info=[d.weightKg!==null?C.formatWeight(d.weightKg,state.settings.unit)+' '+state.settings.unit:null,d.sleepMinutes!==null?formatSleep(d.sleepMinutes)+' sleep':null,d.steps!==null?d.steps.toLocaleString()+' steps':null,d.quality,C.fastingLabel(d,true),d.workoutRating?ratingLabels[d.workoutRating]+' workout':null].filter(Boolean);return `<button class="history-row" data-edit-date="${date}"><span><span class="history-date">${longDate(date,{weekday:'short',month:'short',day:'numeric'})}</span><span class="history-detail" style="display:block">${info.length?escape(info.join(' · ')):C.hasContent(d)?'Partially logged':'No entries yet'}</span>${d.notes?'<span class="history-note">'+escape(d.notes.replace(/\s+/g,' ').slice(0,120))+(d.notes.replace(/\s+/g,' ').length>120?'…':'')+'</span>':''}</span><span class="history-status">${C.complete(d)?icon('check'):''}<span class="edit-link">${C.hasContent(d)?'Edit':'Add'}</span>${icon('chevron')}</span></button>`;}).join('')}</div>`;
  }
  function renderSettings() {
    const s=state.settings, value=n=>n===null?'':C.asUnit(n,s.unit).toFixed(1);
    const remembered=pages&&HealthConnection.rememberedUntil();
    const account = pages ? `<section class="card settings-card"><h2>Your connection</h2><p class="settings-intro">${remembered?'This device is remembered until '+new Date(remembered).toLocaleDateString()+'. Open the app anytime to continue.':'Signed in for this visit. Remember this device to skip sign-in next time.'}</p>${remembered?'':'<button class="secondary" id="reconnect-google">Remember this device</button>'}<div class="settings-row"><span>On this device</span><button id="disconnect-google">Sign out</button></div><div class="settings-row"><span>Lost a device?</span><button id="signout-all">Sign out all devices</button></div><p class="tiny">Your Sheet stays private. Clearing browser data or reinstalling the app may require signing in again.</p></section>` : '';
    return heading('Settings','Make this fit your routine')+account+`<form id="settings-form"><section class="card settings-card"><h2>Your preferences</h2><div class="field-pair"><div class="field"><label for="unit">Weight unit</label><select id="unit" name="unit"><option value="lb" ${s.unit==='lb'?'selected':''}>Pounds (lb)</option><option value="kg" ${s.unit==='kg'?'selected':''}>Kilograms (kg)</option></select></div><div class="field"><label for="weightMode">Current focus</label><select id="weightMode" name="weightMode"><option value="lose" ${s.weightMode==='lose'?'selected':''}>Losing weight</option><option value="maintain" ${s.weightMode==='maintain'?'selected':''}>Maintaining</option></select></div></div><p class="tiny">Changing your focus preserves your history.</p><div class="field"><label for="goalWeight">Optional target weight (${s.unit})</label><input type="number" step="0.1" min="0.1" id="goalWeight" name="goalWeight" value="${value(s.goalWeightKg)}" placeholder="No target"></div><div class="field-pair"><div class="field"><label for="rangeMin">Maintenance minimum (${s.unit})</label><input type="number" id="rangeMin" name="rangeMin" step="0.1" value="${value(s.rangeMinKg)}" placeholder="Optional"></div><div class="field"><label for="rangeMax">Maintenance maximum (${s.unit})</label><input type="number" id="rangeMax" name="rangeMax" step="0.1" value="${value(s.rangeMaxKg)}" placeholder="Optional"></div></div><h3 style="margin-top:22px">Sleep goal <span class="tiny">Optional</span></h3>${sleepInputs('sleep-goal',s.sleepGoalMinutes)}<p class="tiny">Leave both fields blank for no sleep goal.</p><div class="field-pair"><div class="field"><label for="exerciseGoal">Exercise days per week</label><input id="exerciseGoal" name="exerciseGoal" type="number" min="1" max="7" step="1" value="${s.exerciseGoal===null?'':s.exerciseGoal}" placeholder="Optional"></div></div><label class="switch-label" for="sportEnabled"><span>Show Sport button</span><input type="checkbox" id="sportEnabled" name="sportEnabled" ${s.sportEnabled?'checked':''}></label><div class="field"><label for="timezone">Timezone</label><input id="timezone" name="timezone" value="${escape(s.timezone)}" required></div><div class="field"><label for="weekStart">Week starts on</label><select id="weekStart" name="weekStart"><option value="1" ${s.weekStart===1?'selected':''}>Monday</option><option value="0" ${s.weekStart===0?'selected':''}>Sunday</option></select></div><p class="tiny">Your log keeps this timezone while traveling. Existing dates do not move.</p><div id="settings-error" class="error-box" hidden></div><button class="finish" id="save-settings" style="margin-top:22px">Save preferences</button></section></form>
    <section class="card settings-card"><h2>Apple Health</h2><p class="settings-intro">Import sleep and Watch steps, and send saved weights using free iPhone Shortcuts.</p><button id="open-apple-health" class="full-button">Manage Apple Health ${icon('chevron')}</button></section><section class="card settings-card"><h2>Your data</h2><p class="settings-intro">${preview?'This preview stores entries only in this browser. Your Google Sheet is separate.':'Your entries are stored in your private Google Sheet.'}</p>${state.spreadsheetUrl?`<div class="settings-row"><span>Private data Sheet</span><a href="${escape(state.spreadsheetUrl)}" target="_blank" rel="noopener">Open Sheet ${icon('chevron')}</a></div>`:''}<div class="settings-row"><span>Full backup</span><button id="export-json">Export JSON ${icon('export')}</button></div><div class="settings-row"><span>For a spreadsheet</span><button id="export-csv">Export CSV ${icon('export')}</button></div><div class="settings-row"><span>Restore missing days</span><button id="restore">Import backup ${icon('chevron')}</button></div><p class="tiny" style="margin-top:15px">Imports add missing dates without overwriting existing entries. Keep occasional backups in private storage.</p></section><p class="tiny" style="text-align:center">Daily Health · Version 0.10.1</p>`;
  }
  function render() {
    if(!state.loaded)return;
    const focused=document.activeElement?.id;
    $('main').innerHTML=state.tab==='today'?renderToday():state.tab==='trends'?renderTrends():state.tab==='history'?renderHistory():state.tab==='health'?renderAppleHealth():renderSettings();
    document.querySelectorAll('[data-tab]').forEach(b=>{if(b.dataset.tab===state.tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    bind();
    if(focused && $(focused)) $(focused).focus({preventScroll:true});
  }
  function openDialog(html) { $('dialog-content').innerHTML=html; $('editor').showModal(); const close=$('close-dialog'); if(close)close.onclick=()=> $('editor').close(); }
  function dialogHead(title) { return `<div class="dialog-head"><h2>${title}</h2><button type="button" id="close-dialog" class="icon-button" aria-label="Close">${icon('close')}</button></div>`; }
  function editNotes() {
    const day=visibleDay(), notes=day.notes || '';
    openDialog(dialogHead('Daily notes')+`<p class="tiny">${longDate(day.date,{weekday:'long',month:'long',day:'numeric'})}</p><form id="notes-form"><div class="field"><label for="notes-value">What would you like to remember?</label><textarea id="notes-value" class="notes-input" rows="5" maxlength="${C.NOTES_LIMIT}" placeholder="Florida trip, work event, travel day…" aria-describedby="notes-help notes-count">${escape(notes)}</textarea><div class="row tiny"><span id="notes-help">Optional. Erase the text to clear your note.</span><span id="notes-count">${notes.length}/${C.NOTES_LIMIT}</span></div></div><p id="notes-error" class="tiny danger" role="alert"></p><div class="dialog-actions"><button type="button" id="cancel-notes" class="secondary">Cancel</button><button type="submit" class="primary">Save note</button></div></form>`);
    $('notes-value').oninput=()=>{$('notes-count').textContent=$('notes-value').value.length+'/'+C.NOTES_LIMIT;};
    $('cancel-notes').onclick=()=>$('editor').close();
    $('notes-form').onsubmit=event=>{
      event.preventDefault();
      try {
        if(state.failure)throw new Error('Retry your pending save first. Your note is still here.');
        if(!navigator.onLine)throw new Error('Reconnect to save your note. Your text is still here.');
        const value=$('notes-value').value, patch={notes:value.trim()?value:''};
        C.applyPatch(visibleDay(),patch,state.settings,state.today);
        if(patch.notes!==(visibleDay().notes||''))queueSave(patch);
        $('editor').close();
      }catch(error){$('notes-error').textContent=error.message;}
    };
  }
  function editMetric(type) {
    const day=visibleDay(), weight=type==='weight', val=day.weightKg===null?'':C.asUnit(day.weightKg,state.settings.unit).toFixed(1);
    const fields=weight?`<div class="field"><label for="metric-value">Home-scale weight (${state.settings.unit})</label><input class="big-input" id="metric-value" type="number" inputmode="decimal" step=".1" min=".1" value="${val}" placeholder="Enter weight" required></div>`:sleepInputs('sleep',day.sleepMinutes,true);
    openDialog(dialogHead(weight?'Weight':'Sleep')+`<p class="tiny">${longDate(day.date,{weekday:'long',month:'long',day:'numeric'})}</p><form id="metric-form">${fields}<p id="metric-error" class="tiny danger" role="alert"></p><div class="dialog-actions"><button type="button" class="secondary" id="clear-metric">Clear</button><button class="primary">Done</button></div></form>`);
    $('clear-metric').onclick=()=>{queueSave(weight?{weightKg:null,weightStatus:'missing'}:{sleepMinutes:null});$('editor').close();};
    $('metric-form').onsubmit=e=>{e.preventDefault();try{
      const patch=weight?{weightKg:C.asKg(Number($('metric-value').value),state.settings.unit),weightStatus:'recorded'}:{sleepMinutes:readSleep('sleep')};
      C.applyPatch(day,patch,state.settings,state.today);
      if(weight){const last=state.days.filter(d=>d.weightKg!==null&&d.date<=day.date).sort((a,b)=>b.date.localeCompare(a.date))[0];if(last&&Math.abs(patch.weightKg-last.weightKg)>last.weightKg*.1&&!confirm('This weight is more than 10% different from your last reading. Save it?'))return;}
      queueSave(patch);$('editor').close();
    }catch(error){$('metric-error').textContent=error.message;}};
  }
  function bind() {
    if($('open-apple-health'))$('open-apple-health').onclick=()=>{safeNavigate(()=>state.tab='health');if(state.tab==='health')refreshHealthConnection();};
    if($('health-back-settings'))$('health-back-settings').onclick=()=>safeNavigate(()=>state.tab='settings');
    if($('health-import-sleep'))$('health-import-sleep').onclick=()=>openSleepImport('sleep');
    if($('health-import-steps'))$('health-import-steps').onclick=()=>openSleepImport('steps');
    if($('edit-steps'))$('edit-steps').onclick=editSteps;
    if($('health-export-weight'))$('health-export-weight').onclick=reviewHealthWeight;
    if($('health-pair'))$('health-pair').onclick=pairHealthPhone;
    if($('health-sync-refresh'))$('health-sync-refresh').onclick=refreshHealthConnection;
    if($('health-revoke'))$('health-revoke').onclick=disconnectHealthPhone;
    document.querySelectorAll('[data-health-direction]').forEach(input=>input.onchange=()=>changeHealthDirection(input));
    document.querySelectorAll('[data-rating]').forEach(button=>button.onclick=()=>queueSave({workoutRating:visibleDay().workoutRating===button.dataset.rating?null:button.dataset.rating}));
    document.querySelectorAll('[data-pattern-direction]').forEach(button=>button.onclick=()=>{patternState.direction=button.dataset.patternDirection;render();});
    if($('pattern-factor'))$('pattern-factor').onchange=e=>{patternState.factor=e.target.value;render();};
    document.querySelectorAll('[data-amount]').forEach(button=>button.onclick=()=>{
      const key=button.dataset.amount, value=button.dataset.value;
      queueSave({[key]:visibleDay()[key]===value?null:value});
    });
    if($('reconnect-google'))$('reconnect-google').onclick=e=>connectGoogle(e.currentTarget);
    if($('disconnect-google'))$('disconnect-google').onclick=async()=>{
      if(state.queue.length||state.busy){toast('Finish saving your pending entry before signing out.');return;}
      const pending=HealthConnection.disconnect();clearSignedInPage();
      const result=await pending;
      if(!result.revoked&&!state.loaded)showConnection('Signed out here. Remote sign-out could not be confirmed. Connect again when online, then use Sign out all devices.');
    };
    if($('signout-all'))$('signout-all').onclick=()=>{
      if(state.queue.length||state.busy){toast('Finish your pending save first.');return;}
      openDialog(dialogHead('Sign out all devices?')+'<p>Every remembered phone and browser will need to connect Google again. Your saved log stays in your Sheet. Confirm with your Google account to continue.</p><p class="tiny danger" id="signout-error" role="alert"></p><button class="primary" id="signout-confirm">Confirm with Google</button>');
      $('signout-confirm').onclick=async e=>{e.currentTarget.disabled=true;try{await HealthConnection.signOutAll();clearSignedInPage('All remembered devices are signed out.');}catch(error){$('signout-error').textContent=error.message;$('signout-confirm').disabled=false;}};
    };
    document.querySelectorAll('[data-habit]').forEach(b=>b.onclick=()=>{const day=visibleDay(),key=b.dataset.habit,done=C.EXERCISE.includes(key)?day.exerciseComplete:day.foodComplete;queueSave({[key]:day[key]===true?(done?false:null):true});});
    document.querySelectorAll('[data-quality]').forEach(b=>b.onclick=()=>queueSave({quality:visibleDay().quality===b.dataset.quality?null:b.dataset.quality}));
    document.querySelectorAll('[data-zyn]').forEach(b=>b.onclick=()=>queueSave({zyn:b.dataset.zyn==='true'}));
    document.querySelectorAll('[data-fasting]').forEach(b=>b.onclick=()=>{const option=C.FASTING_OPTIONS.find(o=>o.key===b.dataset.fasting),clear=C.fastingChoice(visibleDay())===option.key;queueSave({fastingHours:clear?null:option.hours,fastingRange:clear?null:option.range});});
    if($('edit-notes'))$('edit-notes').onclick=editNotes;
    if($('prev-day'))$('prev-day').onclick=()=>safeNavigate(()=>state.selected=C.addDays(state.selected,-1));
    if($('next-day'))$('next-day').onclick=()=>safeNavigate(()=>state.selected=C.addDays(state.selected,1));
    if($('selected-date'))$('selected-date').onchange=e=>safeNavigate(()=>{if(C.validDate(e.target.value)&&e.target.value<=state.today)state.selected=e.target.value;});
    if($('back-today'))$('back-today').onclick=()=>safeNavigate(()=>state.selected=state.today);
    if($('edit-weight'))$('edit-weight').onclick=()=>editMetric('weight');
    if($('edit-sleep'))$('edit-sleep').onclick=$('sleep-shortcut').onclick=()=>editMetric('sleep');
    if($('away'))$('away').onclick=()=>queueSave({weightKg:null,weightStatus:visibleDay().weightStatus==='away'?'missing':'away'});
    if($('finish-day'))$('finish-day').onclick=()=>queueSave({},'finish');
    if($('retry-save'))$('retry-save').onclick=()=>{state.failure=null;render();pump();};
    document.querySelectorAll('[data-edit-date]').forEach(b=>b.onclick=()=>safeNavigate(()=>{state.selected=b.dataset.editDate;state.tab='today';}));
    if($('history-month'))$('history-month').onchange=e=>{if(/^\d{4}-\d{2}$/.test(e.target.value)){state.historyMonth=e.target.value;render();}};
    if($('delete-day'))$('delete-day').onclick=()=>{
      if(state.queue.length){toast('Wait for your save to finish.');return;}
      const day=savedDay(state.selected);
      openDialog(dialogHead('Delete this day?')+`<p>Remove the entries for ${longDate(day.date)}? Your other days will stay unchanged.</p><div class="dialog-actions"><button class="secondary" id="cancel-delete">Cancel</button><button class="primary" id="confirm-delete">Delete entries</button></div>`);
      $('cancel-delete').onclick=()=> $('editor').close();
      $('confirm-delete').onclick=async()=>{const b=$('confirm-delete');b.disabled=true;try{const r=await api('deleteDay',{date:day.date,baseRevision:day.revision});if(r.conflict){putDay(r.day);toast('This day changed. Review the latest entries before deleting.');}else{state.days=state.days.filter(d=>d.date!==day.date);toast('Entries deleted');}$('editor').close();render();}catch(e){b.disabled=false;toast(e.message);}};
    };
    if($('settings-form'))$('settings-form').onsubmit=savePreferences;
    if($('unit'))$('unit').onchange=e=>{
      const old=$('settings-form').dataset.unit||state.settings.unit,newUnit=e.target.value;
      ['goalWeight','rangeMin','rangeMax'].forEach(id=>{if($(id).value!=='')$(id).value=C.asUnit(C.asKg(Number($(id).value),old),newUnit).toFixed(1);});
      document.querySelectorAll('label[for=goalWeight],label[for=rangeMin],label[for=rangeMax]').forEach(l=>l.textContent=l.textContent.replace(/\((lb|kg)\)/,'('+newUnit+')'));
      $('settings-form').dataset.unit=newUnit;
    };
    if($('export-json'))$('export-json').onclick=()=>downloadBackup('json');
    if($('export-csv'))$('export-csv').onclick=()=>downloadBackup('csv');
    if($('restore'))$('restore').onclick=()=>{$('import-file').value='';$('import-file').click();};
  }
  function editSteps() {
    const day=visibleDay();
    openDialog(dialogHead('Daily steps')+`<p class="tiny">${longDate(day.date,{weekday:'long',month:'long',day:'numeric'})}</p><form id="steps-form"><div class="field"><label for="steps-value">Apple Watch steps</label><input class="big-input" id="steps-value" type="number" inputmode="numeric" min="0" max="200000" step="1" value="${day.steps===null?'':day.steps}" placeholder="Enter steps" required></div><p class="tiny">Use your Watch total for consistency with imported days.</p><p class="tiny danger" id="steps-error" role="alert"></p><div class="dialog-actions"><button type="button" id="clear-steps" class="secondary">Clear</button><button class="primary">Done</button></div></form>`);
    $('clear-steps').onclick=()=>{queueSave({steps:null});$('editor').close();};
    $('steps-form').onsubmit=e=>{e.preventDefault();try{const patch={steps:Number($('steps-value').value)};C.applyPatch(day,patch,state.settings,state.today);queueSave(patch);$('editor').close();}catch(error){$('steps-error').textContent=error.message;}};
  }
  async function savePreferences(e) {
    e.preventDefault(); const form=e.target, f=new FormData(form), s=C.clone(state.settings), unit=f.get('unit');
    const number=name=>f.get(name)===''?null:Number(f.get(name));
    Object.assign(s,{unit,weightMode:f.get('weightMode'),timezone:String(f.get('timezone')).trim(),sportEnabled:f.has('sportEnabled'),weekStart:Number(f.get('weekStart')),exerciseGoal:number('exerciseGoal')});
    [['goalWeight','goalWeightKg'],['rangeMin','rangeMinKg'],['rangeMax','rangeMaxKg']].forEach(([field,key])=>s[key]=number(field)===null?null:C.asKg(number(field),unit));
    const b=$('save-settings');b.disabled=true;
    try{s.sleepGoalMinutes=readSleep('sleep-goal',true);C.validateSettings(s);const r=await api('saveSettings',{settings:s,baseRevision:state.settings.revision});if(!r.ok)throw new Error('Preferences changed elsewhere. Reload this page before saving.');state.settings=r.settings;state.today=r.today;state.lastSaved=true;render();toast('Preferences saved');}catch(error){b.disabled=false;$('settings-error').textContent=error.message;$('settings-error').hidden=false;}
  }
  async function downloadBackup(type) {
    try{const data=await api('exportData');let content,mime;
      if(type==='json'){content=JSON.stringify(data,null,2);mime='application/json';}
      else{content=[C.DAY_FIELDS.join(','),...data.days.map(d=>C.DAY_FIELDS.map(k=>C.csvCell(d[k])).join(','))].join('\r\n');mime='text/csv';}
      const url=URL.createObjectURL(new Blob([content],{type:mime}));const a=document.createElement('a');a.href=url;a.download=`daily-health-${state.today}.${type}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('Backup downloaded');
    }catch(error){toast(error.message);}
  }
  $('import-file').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    try{if(file.size>10_000_000)throw new Error('Choose a JSON export smaller than 10 MB.');const raw=JSON.parse(await file.text());const data=C.validateImport(raw,state.today);const missing=data.days.filter(d=>!state.days.some(x=>x.date===d.date)).length;
      openDialog(dialogHead('Restore backup')+`<p>${missing} missing days will be added. ${data.days.length-missing} existing dates will be skipped.</p><p class="outlook-note">${state.days.length===0?'This empty log will also restore your preferences and goal history.':'Your current entries and preferences will stay unchanged.'}</p><div class="dialog-actions"><button class="secondary" id="cancel-import">Cancel</button><button class="primary" id="confirm-import">Restore</button></div>`);
      $('cancel-import').onclick=()=> $('editor').close();
      $('confirm-import').onclick=async()=>{const b=$('confirm-import');b.disabled=true;try{const r=await api('importData',{data:raw});$('editor').close();await load();toast(`${r.added} days restored`);}catch(error){b.disabled=false;toast(error.message);}};
    }catch(error){toast(error.message);}
  };
  async function load() {
    const generation=connectionGeneration;
    try{const data=await api('getBootstrap');if(generation!==connectionGeneration)return;state.settings=C.validateSettings(data.settings);state.days=data.days.map(day=>({...C.blankDay(day.date),...day}));state.today=data.today;state.selected=state.selected||state.today;state.spreadsheetUrl=data.spreadsheetUrl;state.loaded=true;document.body.classList.remove('connection-locked');render();}
    catch(error){if(pages&&!state.loaded){showConnection(error.message);return;}$('main').innerHTML=`<div class="card"><h2>Couldn’t open your log</h2><p class="settings-intro">${escape(error.message)}</p><button id="reload" class="finish">Try again</button></div>`;$('reload').onclick=load;}
  }
  $('open-settings').innerHTML=icon('settings');$('open-settings').onclick=()=>safeNavigate(()=>state.tab=state.tab==='settings'?'today':'settings');
  document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
  document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>safeNavigate(()=>{state.tab=b.dataset.tab;if(state.tab==='today')state.selected=state.today;if(state.tab==='trends'&&!preview)api('recordForecast').catch(()=>{});}));
  document.querySelector('.brand').onclick=e=>{e.preventDefault();safeNavigate(()=>{state.tab='today';state.selected=state.today;});};
  window.addEventListener('beforeunload',e=>{if(state.queue.length||healthBusy){e.preventDefault();e.returnValue='';}});
  window.addEventListener('online',()=>{if(state.failure?.retryable)toast('Back online. Retry your pending save.');});
  window.addEventListener('offline',()=>toast('Offline. Reconnect before saving changes.'));
  let lastResumeRefresh=0;
  document.addEventListener('visibilitychange',async()=>{
    if(document.hidden||!state.loaded||state.queue.length||state.busy||healthBusy||$('editor').open||Date.now()-lastResumeRefresh<15000)return;
    lastResumeRefresh=Date.now();
    const generation=connectionGeneration;
    const revisions=JSON.stringify(state.days.map(day=>[day.date,day.revision]));
    try{
      const latest=await api('getBootstrap');
      if(generation!==connectionGeneration||document.hidden||state.queue.length||state.busy||healthBusy||$('editor').open||JSON.stringify(state.days.map(day=>[day.date,day.revision]))!==revisions)return;
      if(state.selected===state.today)state.selected=latest.today;
      state.today=latest.today;state.days=latest.days;state.settings=latest.settings;render();
      if(state.tab==='health')refreshHealthConnection();
    }catch(error){if(error.signIn)toast('Reconnect Google to see your latest entries.');}
  });
  $('editor').addEventListener('cancel',e=>{if(healthBusy)e.preventDefault();});
  $('editor').addEventListener('close',()=>{if(!$('editor').open&&!healthBusy){$('dialog-content').replaceChildren();healthReview=null;}});
  if(preview)$('preview-banner').hidden=false;
  if(pages){
    $('connect-google').onclick=e=>connectGoogle(e.currentTarget);
    window.addEventListener('storage',e=>{if((e.key===HealthConnection.storageKey&&e.newValue===null)||e.key===null){HealthConnection.forgetLocal();clearSignedInPage('Signed out in another window. Connect Google to open your log.');}});
    if(HealthConnection.restore()){showConnection('Opening your log…');load();}else showConnection();
  }
  else load();
})();
