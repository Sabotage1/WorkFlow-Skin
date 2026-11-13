// SPDX-License-Identifier: MIT
// Stable SHA-256 identity of the selected profile, independent of JSON key order.
// The host workflow id changes during edits; a profile title alone is ambiguous.
function atomCanonical(value) {
  if (Array.isArray(value)) return "[" + value.map(atomCanonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + atomCanonical(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
function atomSha256(text) {
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const bytes = [];
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | c >> 6,128 | c & 63);
    else if (c < 65536) bytes.push(224 | c >> 12,128 | c >> 6 & 63,128 | c & 63);
    else bytes.push(240 | c >> 18,128 | c >> 12 & 63,128 | c >> 6 & 63,128 | c & 63);
  }
  const length = bytes.length * 8;
  bytes.push(128); while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(Math.floor(length / Math.pow(256,i)) & 255);
  const r = (n,b) => n >>> b | n << (32-b);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = new Array(64);
    for (let i = 0; i < 16; i++) w[i] = bytes[offset+4*i]<<24 | bytes[offset+4*i+1]<<16 | bytes[offset+4*i+2]<<8 | bytes[offset+4*i+3];
    for (let i = 16; i < 64; i++) {
      const a = w[i-15], b = w[i-2];
      w[i] = (w[i-16] + (r(a,7)^r(a,18)^a>>>3) + w[i-7] + (r(b,17)^r(b,19)^b>>>10)) | 0;
    }
    let [a,b,c,d,e,f,g,z] = h;
    for (let i = 0; i < 64; i++) {
      const t = (z + (r(e,6)^r(e,11)^r(e,25)) + (e&f ^ ~e&g) + k[i] + w[i]) | 0;
      const t2 = ((r(a,2)^r(a,13)^r(a,22)) + (a&b ^ a&c ^ b&c)) | 0;
      z=g;g=f;f=e;e=(d+t)|0;d=c;c=b;b=a;a=(t+t2)|0;
    }
    [a,b,c,d,e,f,g,z].forEach((n,i) => {h[i]=(h[i]+n)|0;});
  }
  return h.map(n => (n>>>0).toString(16).padStart(8,"0")).join("");
}
function atomProfile(workflow) {
  const p = workflow && workflow.profile;
  if (!p || typeof p.title !== "string" || !p.title.trim() || !Array.isArray(p.steps) || !p.steps.length) return null;
  const identity = {};
  // Notes/author/version are presentation fields. Rename or recipe changes require a new opt-in.
  for (const key of Object.keys(p)) if (!["notes","author","version"].includes(key)) identity[key] = p[key];
  return {key: atomSha256(atomCanonical(identity)), title: p.title};
}

// SPDX-License-Identifier: MIT
function atomSettingsPage() {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Atom65 · Profile sync</title><style>
:root{font:17px system-ui,sans-serif;color-scheme:light dark;--bg:#f4f2ec;--card:#fffdf7;--ink:#252c28;--muted:#58675c;--line:#cdd5cc;--accent:#285943}
*{box-sizing:border-box}h1,h2,#name,li{overflow-wrap:anywhere}body{background:var(--bg);color:var(--ink);max-width:720px;margin:auto;padding:24px 20px 48px}h1{font-size:30px;letter-spacing:-.7px;margin:8px 0}h2{font-size:19px;margin:0 0 12px}p{line-height:1.5;color:var(--muted)}.eyebrow{text-transform:uppercase;letter-spacing:.13em;font-size:12px;font-weight:700;color:var(--accent)}section,form{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px;margin:20px 0}label{display:block;line-height:1.4;margin:16px 0 8px}select,input[type=number],button{font:inherit;min-height:46px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--bg);color:var(--ink)}select,input[type=number]{width:100%;font-size:17px}input[type=checkbox]{width:22px;height:22px;vertical-align:middle;margin:0 8px 0 0;accent-color:var(--accent)}button{cursor:pointer;font-weight:600}button.primary{background:var(--accent);color:white;border:0;flex:1}button:disabled{opacity:.5;cursor:default}.actions{display:flex;gap:10px;margin-top:22px;flex-wrap:wrap}.readout{font-size:32px;letter-spacing:-1px;margin:6px 0}.small{font-size:14px}.status{font-size:15px;color:var(--accent);min-height:24px;line-height:1.5}#error{color:#ae3629;min-height:24px}ul{padding-left:20px}li{margin:12px 0;line-height:1.4}fieldset{border:0;margin:0;padding:0;min-width:0}:focus-visible{outline:3px solid #66a78a;outline-offset:3px}[hidden]{display:none!important}
@media(max-width:480px){.actions .primary{flex-basis:100%}.actions button{flex:1}}
@media(prefers-color-scheme:dark){:root{--bg:#151c18;--card:#1e2922;--ink:#f4f3e8;--muted:#b8c7bb;--line:#3e5044;--accent:#a9d8b6}button.primary{color:#10271a}#error{color:#ffa69b}}
</style><body><div class="eyebrow">Connected grinder</div><h1>Atom65 profile sync</h1><p>Choose which espresso profiles set the grind weight. Every other profile leaves your grinder as it is.</p>
<section aria-label="Grinder status"><div id="name" class="small">Connect Atom65 in Decaid</div><div class="readout" id="dose">— g</div><div id="status" class="status" role="status" aria-live="polite">Loading…</div></section>
<form id="form"><fieldset id="fields" disabled><h2 id="title">Select a profile in Decaid</h2><p id="workflowDose" class="small"></p><label for="mode">When I choose this profile</label><select id="mode"><option value="leave">Leave grinder unchanged</option><option value="workflow">Use Decaid's dose</option><option value="fixed">Use a fixed grind weight</option></select><div id="fixed" hidden><label for="weight">Grind weight (g)</label><input id="weight" type="number" min="5" max="40" step="0.1" value="18"></div><p id="explanation" class="small">No dose will be sent for this profile.</p><label><input id="enabled" type="checkbox" checked>Enable syncing for this Atom65</label><div class="actions"><button type="submit" class="primary" id="save">Save profile choice</button><button type="button" id="sync">Sync now</button><button type="button" id="reload">Refresh</button></div></fieldset></form>
<div id="error" role="alert"></div><section><h2>Enabled profiles</h2><p class="small">Select a profile in Decaid to change its choice here. A renamed or edited recipe needs a fresh opt-in.</p><ul id="rules"></ul></section><p class="small">Synced weights use the grinder's CUSTOM preset. Start grinding on the grinder. If it is busy or in time mode, return to the ready weight screen and tap Sync now.</p>
<script>
const $=id=>document.getElementById(id);let deviceId=new URLSearchParams(location.search).get('deviceId'),profileKey=null,dirty=false,busy=false;
const base=location.pathname.slice(0,location.pathname.lastIndexOf('/')+1);
async function api(endpoint,body){const query=deviceId?'?deviceId='+encodeURIComponent(deviceId):'';const r=await fetch(base+endpoint+query,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d;}
function explanation(){const mode=$('mode').value;$('fixed').hidden=mode!=='fixed';$('weight').required=mode==='fixed';$('weight').disabled=mode!=='fixed';$('explanation').textContent=mode==='leave'?'No dose will be sent for this profile.':mode==='workflow'?'Follows the dose shown in Decaid, including dose edits for this profile.':'Always sends this fixed weight when this profile is selected.';}
function fill(d,force){deviceId=d.deviceId;$('name').textContent=d.name+(d.connected?' · Bluetooth connected':' · Disconnected');$('dose').textContent=d.grinder?d.grinder.dose.toFixed(1)+' g':'— g';$('status').textContent=d.storageError||d.message;$('workflowDose').textContent=typeof d.workflowDose==='number'?'Decaid dose: '+d.workflowDose+' g':'Decaid dose is not set.';$('fields').disabled=!d.loaded||!!d.storageError||!d.profile||busy;
if(force||!dirty){profileKey=d.profile&&d.profile.key;$('title').textContent=d.profile?d.profile.title:'Select a profile in Decaid';$('mode').value=d.rule.mode;$('weight').value=d.rule.weight||d.workflowDose||18;$('enabled').checked=d.deviceEnabled;$('weight').max=d.maximumDose;explanation();dirty=false;}
if(dirty&&d.profile&&d.profile.key!==profileKey){$('error').textContent='The profile changed in Decaid. Tap Refresh to edit the new profile.';$('save').disabled=true;}else $('save').disabled=false;
$('sync').disabled=!d.connected||d.rule.mode==='leave'||!d.syncEnabled||dirty;$('rules').replaceChildren();for(const r of d.rules){const li=document.createElement('li');li.textContent=r.title+' · '+(r.mode==='fixed'?r.weight+' g':"Decaid dose");$('rules').append(li);}if(!d.rules.length){const li=document.createElement('li');li.textContent='None yet. All profiles leave the grinder unchanged.';$('rules').append(li);}}
async function refresh(force=false){if(busy)return;try{fill(await api('status'),force);if(force)$('error').textContent='';}catch(e){$('error').textContent=e.message;}}
$('form').addEventListener('input',()=>{dirty=true;explanation();$('sync').disabled=true;});
$('form').addEventListener('submit',async e=>{e.preventDefault();if(!profileKey)return;busy=true;$('fields').disabled=true;$('error').textContent='';try{const body={profileKey,mode:$('mode').value,enabled:$('enabled').checked};if(body.mode==='fixed')body.weight=Number($('weight').value);const d=await api('configure',body);dirty=false;busy=false;fill(d,true);}catch(e){$('error').textContent=e.message;}finally{busy=false;$('fields').disabled=false;}});
$('reload').addEventListener('click',()=>refresh(true));$('sync').addEventListener('click',async()=>{try{await api('sync',{});$('status').textContent='Dose update queued';}catch(e){$('error').textContent=e.message;}});refresh();setInterval(()=>refresh(),1500);
</script></body></html>`;
}

// SPDX-License-Identifier: MIT
function createPlugin(host) {
  "use strict";
  const id = "atom65.reaplugin", service = "5e5d6500-3f45-4b8c-9a65-28b4858d23d4";
  const commandChar = "5e5d6501-3f45-4b8c-9a65-28b4858d23d4", statusChar = "5e5d6502-3f45-4b8c-9a65-28b4858d23d4";
  const storageKey = "profile-rules-v1", devices = new Map(), sessions = new Set();
  let settings, workflow = null, config = {schema:1, devices:{}}, loaded = false, retired = false;
  let storageError = null, saving = false, saveQueue = Promise.resolve(), saveSerial = 0;
  const saveWaiters = new Map();
  const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
  function fail(message, code = "invalid_argument") { const e = new Error(message); e.code = code; return e; }
  function log(error) { host.log("[atom65] " + error.message); }
  function checksum(bytes) {return bytes.reduce((s,n) => s ^ n, 0);}
  function decode(encoded) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if (typeof encoded !== "string" || encoded.length !== 20) throw fail("Invalid Atom65 status encoding", "protocol_mismatch");
    const b = [];
    for (let i = 0; i < encoded.length; i += 4) {
      const n = [0,1,2,3].map(j => alphabet.indexOf(encoded[i+j]));
      if (n.some(value => value < 0)) throw fail("Invalid Atom65 status encoding", "protocol_mismatch");
      b.push(n[0]<<2 | n[1]>>4, (n[1]&15)<<4 | n[2]>>2, (n[2]&3)<<6 | n[3]);
    }
    if (b.length !== 15 || b[0] !== 166 || b[1] !== 1 || checksum(b.slice(0,14)) !== b[14] ||
        b[2] > 5 || (b[3] & ~15) || b[8] > 2 || b[9] > 1) throw fail("Incompatible Atom65 dose status", "protocol_mismatch");
    const word = n => b[n] | b[n+1]<<8;
    const s = {result:b[2], flags:b[3], sequence:word(4), dose:word(6)/10, slot:b[8], mode:b[9], minimum:word(10)/10, maximum:word(12)/10};
    if (s.minimum < 5 || s.maximum > 1000 || s.maximum < s.minimum || s.dose < s.minimum || s.dose > s.maximum) throw fail("Invalid Atom65 dose limits", "protocol_mismatch");
    return s;
  }
  function dose(value, status) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 5 || value > settings.MaximumDose ||
        (status && (value < status.minimum || value > status.maximum)) || Math.abs(value*10-Math.round(value*10)) > 1e-7) {
      throw fail("Dose must be 5–" + settings.MaximumDose + " g in 0.1 g steps and within the grinder's range");
    }
    return value;
  }
  function validateConfig(value) {
    if (value == null) return {schema:1, devices:{}};
    if (!object(value) || value.schema !== 1 || !object(value.devices)) throw fail("Stored profile settings are invalid; sync is paused");
    for (const [deviceId, entry] of Object.entries(value.devices)) {
      if (!deviceId.startsWith("plugin:" + id + ":atom65:") || !object(entry) || typeof entry.enabled !== "boolean" || !object(entry.rules)) throw fail("Invalid stored device settings");
      for (const [key, rule] of Object.entries(entry.rules)) {
        if (!/^[0-9a-f]{64}$/.test(key) || !object(rule) || typeof rule.title !== "string" || !["workflow","fixed"].includes(rule.mode) ||
            (rule.mode === "fixed" && (typeof rule.weight !== "number" || !Number.isFinite(rule.weight) || rule.weight < 5 || rule.weight > 1000))) throw fail("Invalid stored profile rule");
      }
    }
    return JSON.parse(JSON.stringify(value));
  }
  function current(request) {
    const deviceId = request.query && request.query.deviceId;
    if (typeof deviceId !== "string" || !devices.has(deviceId)) throw fail("Connect this Atom65 in Decaid first", "not_connected");
    return devices.get(deviceId);
  }
  function plan(state) {
    if (retired || !loaded || storageError || saving || !settings.SyncEnabled) return null;
    const profile = atomProfile(workflow), entry = config.devices[state.deviceId];
    if (!profile || !entry || !entry.enabled) return null;
    const rule = entry.rules[profile.key];
    if (!rule) return null;
    const weight = dose(rule.mode === "fixed" ? rule.weight : workflow.context && workflow.context.targetDoseWeight, state.status);
    return {key:profile.key, weight, token:profile.key + ":" + weight};
  }
  function cancel(state) { clearTimeout(state.syncTimer); state.syncTimer = null; state.desired = null; }
  function stop(state) {
    if (!state || state.stopped) return;
    state.stopped = true; state.ready = false;
    cancel(state); clearTimeout(state.watchdog);
    if (state.pending) { clearTimeout(state.pending.timer); state.pending.reject(fail("Atom65 disconnected", "stale_session")); state.pending = null; }
    sessions.delete(state);
  }
  function queue(state, force = false) {
    if (!state.ready || state.stopped) return;
    let next;
    try {next = plan(state);} catch (e) {cancel(state); state.message = e.message; return;}
    if (!next) {cancel(state); state.message = !loaded ? "Loading saved profile choices" : !settings.SyncEnabled ? "Sync paused in plugin settings" : config.devices[state.deviceId] && !config.devices[state.deviceId].enabled ? "Sync paused for this Atom65" : "Leave grinder unchanged"; return;}
    if (!force && state.desired && state.desired.token === next.token) return;
    clearTimeout(state.syncTimer); state.desired = next;
    state.message = "Dose update queued";
    state.syncTimer = setTimeout(() => {
      state.syncTimer = null;
      state.commands = state.commands.catch(() => {}).then(async () => {
        const fresh = plan(state);
        if (state.stopped || !state.ready || !fresh || state.desired !== next || fresh.token !== next.token) return;
        if (!force && state.lastApplied === next.token && state.status && state.status.dose === next.weight && state.status.slot === 2) {
          state.message = "Synced · " + next.weight + " g"; return;
        }
        await send(state, next);
      }).catch(e => { if (!state.stopped && state.desired === next) state.message = e.message; log(e); });
    }, 150);
  }
  function refresh() {for (const state of sessions) queue(state);}
  function send(state, next) {
    if (state.status.mode !== 0 || !(state.status.flags & 1) || state.status.flags & 14) {
      throw fail("Grinder busy or in time mode; return to the weight screen and tap Sync now", "busy");
    }
    const sequence = state.sequence = state.sequence % 65535 + 1, value = Math.round(next.weight*10);
    const bytes = [166,1,1,sequence&255,sequence>>8,value&255,value>>8]; bytes.push(checksum(bytes));
    let pending;
    const ack = new Promise((resolve,reject) => {pending = {sequence,resolve,reject,timer:null};});
    ack.catch(() => {});
    state.pending = pending;
    pending.timer = setTimeout(() => { if (state.pending === pending) state.pending = null; pending.reject(fail("Dose confirmation timed out; check the grinder before retrying", "timeout")); }, 2500);
    return state.session.gatt.writeWithResponse(service, commandChar, btoa(String.fromCharCode(...bytes))).then(() => ack).then(status => {
      if (state.stopped) throw fail("Retired Atom65 session", "stale_session");
      if (status.result !== 1) throw fail(["","","Grinder busy; tap Sync now when ready","Grinder rejected the dose","Select weight mode on the grinder","Dose command expired; tap Sync now"][status.result], status.result === 2 ? "busy" : "device_rejected");
      if (status.dose !== next.weight || status.slot !== 2 || status.mode !== 0) throw fail("Grinder confirmed a different dose", "protocol_mismatch");
      state.lastApplied = next.token;
      if (state.desired === next) state.message = "Synced · " + status.dose + " g";
    }).finally(() => {
      clearTimeout(pending.timer);
      if (state.pending === pending) state.pending = null;
    });
  }
  async function notification(state, encoded) {
    if (state.stopped) return;
    try {
      const status = decode(encoded); state.status = status;
      clearTimeout(state.watchdog);
      state.watchdog = setTimeout(() => {stop(state); state.message = "Bluetooth status stream stopped"; state.session.reportDisconnected().catch(log);}, 4000);
      if (state.pending && status.sequence === state.pending.sequence && status.result !== 0) {
        const pending = state.pending; state.pending = null; clearTimeout(pending.timer); pending.resolve(status);
      }
      await state.session.publish({state:status.flags & 2 ? "grinding" : "idle"});
    } catch (e) {stop(state); state.message = e.message; state.session.reportDisconnected().catch(log); throw e;}
  }
  function response(status, body) {return {status, headers:{"Content-Type":"application/json", "Cache-Control":"no-store"}, body:JSON.stringify(body)};}
  function snapshot(state, p = atomProfile(workflow)) {
    const entry = config.devices[state.deviceId] || {enabled:true, rules:{}};
    return {deviceId:state.deviceId, name:state.name, connected:state.ready && !state.stopped, loaded, storageError, saving,
      deviceEnabled:entry.enabled, syncEnabled:settings.SyncEnabled && entry.enabled, maximumDose:settings.MaximumDose, message:state.message,
      grinder:state.status, profile:p, workflowDose:workflow && workflow.context && workflow.context.targetDoseWeight,
      rule:p && entry.rules[p.key] || {mode:"leave"}, rules:Object.entries(entry.rules).map(([key,rule]) => ({key,...rule}))};
  }
  function persist(candidate) {
    const serial = ++saveSerial;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { saveWaiters.delete(serial); storageError = "Saving profile choices timed out; reload the plugin before syncing"; reject(fail(storageError, "storage_timeout")); }, 2500);
      saveWaiters.set(serial, {resolve, reject, timer});
      host.storage({type:"write", key:storageKey, data:{...candidate, serial}});
    });
  }
  async function configure(state, body, libraryProfile) {
    if (!loaded || storageError) throw fail(storageError || "Saved choices are still loading", "storage_unavailable");
    if (!object(body) || Object.keys(body).some(k => !["profileKey","mode","weight","enabled"].includes(k))) throw fail("Invalid profile settings");
    const p = libraryProfile || atomProfile(workflow);
    if (!p || body.profileKey !== p.key) throw fail("The selected profile changed; refresh and try again", "profile_changed");
    if (!["leave","workflow","fixed"].includes(body.mode) || typeof body.enabled !== "boolean") throw fail("Choose a profile sync mode");
    if (body.mode === "fixed") dose(body.weight, state.status);
    if (saving) throw fail("Another settings change is still saving", "busy");
    saving = true;
    for (const s of sessions) cancel(s);
    const candidate = JSON.parse(JSON.stringify(config));
    const entry = candidate.devices[state.deviceId] || {enabled:true,rules:{}};
    entry.enabled = body.enabled;
    if (body.mode === "leave") delete entry.rules[p.key];
    else entry.rules[p.key] = {title:p.title, mode:body.mode, ...(body.mode === "fixed" ? {weight:body.weight} : {})};
    candidate.devices[state.deviceId] = entry;
    try {await persist(candidate); config = candidate;} finally {saving = false; refresh();}
    return snapshot(state, p);
  }
  return {
    id, version:"0.1.1",
    onLoad(values) {
      settings = {SyncEnabled:true, MaximumDose:40, ...values};
      if (typeof settings.SyncEnabled !== "boolean" || typeof settings.MaximumDose !== "number" || !Number.isFinite(settings.MaximumDose) || settings.MaximumDose < 5 || settings.MaximumDose > 1000) throw fail("Invalid Atom65 plugin settings");
      retired = false;
      host.storage({type:"read",key:storageKey});
      return host.devices.bindDriver("atom65", {create(device) {
        const deviceId = device.id;
        if (typeof deviceId !== "string" || !deviceId.startsWith("plugin:" + id + ":atom65:")) throw fail("Unexpected Atom65 device identity");
        const state = {deviceId, name:device.name || "Atom65", ready:false, stopped:true, status:null, message:"Connect Atom65", commands:Promise.resolve()};
        devices.set(deviceId, state);
        let active;
        return {
          async connect(session) {
            if (retired) throw fail("Plugin unloaded", "stale_session");
            if (active && !active.stopped) throw fail("Atom65 is already connected", "busy");
            const s = {...state, session, stopped:false, ready:false, pending:null, desired:null, lastApplied:null, sequence:0, watchdog:null, syncTimer:null, commands:Promise.resolve()};
            active = s; devices.set(deviceId, s); sessions.add(s);
            try {
              session.gatt.onDisconnect(() => {stop(s); s.message = "Atom65 disconnected";});
              const services = await session.gatt.discoverServices();
              if (s.stopped) throw fail("Connection retired", "stale_session");
              if (!services.includes(service)) throw fail("Atom65 needs the profile-sync firmware", "protocol_mismatch");
              await session.gatt.subscribe(service, statusChar, encoded => notification(s,encoded));
              if (s.stopped) throw fail("Connection retired", "stale_session");
              await notification(s, await session.gatt.read(service,statusChar));
              if (s.stopped) throw fail("Connection retired", "stale_session");
              s.ready = true; queue(s);
            } catch (e) {stop(s); s.message = e.message; throw e;}
          },
          async disconnect() {stop(active);},
          bleEvent() {}
        };
      }});
    },
    onEvent(event) {
      if (retired) return;
      if (event.name === "workflowUpdated") {workflow = event.payload; refresh();}
      if (event.name === "storageRead" && event.payload.key === storageKey) {
        try {config = validateConfig(event.payload.value); loaded = true;} catch (e) {storageError = e.message; log(e);}
        refresh();
      }
      if (event.name === "storageWrite") {
        const pending = saveWaiters.get(event.payload && event.payload.serial);
        if (pending) {saveWaiters.delete(event.payload.serial); clearTimeout(pending.timer); pending.resolve();}
      }
    },
    onUnload() {
      retired = true;
      for (const state of sessions) stop(state);
      for (const pending of saveWaiters.values()) {clearTimeout(pending.timer); pending.reject(fail("Plugin unloaded", "stale_session"));}
      saveWaiters.clear();
    },
    async handleHttpRequest(request) {
      if (retired) return response(503,{error:"Plugin unloaded"});
      if (request.endpoint === "device-settings" && request.method === "GET") return {status:200,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"},body:atomSettingsPage()};
      if (request.endpoint === "skin" && request.method === "GET") return response(200,{version:1,surfaces:[{id:"atom65",kind:"header-button",label:"Atom65",action:{type:"open",view:"device-settings",presentation:"overlay"}}]});
      if (!["status","configure","sync","profile-settings"].includes(request.endpoint)) return response(404,{error:"Unknown endpoint"});
      if (request.method !== (request.endpoint === "status" ? "GET" : "POST")) return response(405,{error:"Method not allowed"});
      try {
        // An opened skin surface can omit deviceId only when there is one known grinder.
        if ((!request.query || !request.query.deviceId) && devices.size === 1) request = {...request,query:{deviceId:devices.keys().next().value}};
        const state = current(request);
        if (request.endpoint === "status") return response(200,snapshot(state));
        if (request.endpoint === "profile-settings") {
          const body = request.body;
          if (!object(body) || Object.keys(body).some(k => !["profile","choice"].includes(k))) throw fail("Invalid profile settings request");
          const p = atomProfile({profile:body.profile});
          if (!p) throw fail("Choose a named profile with recipe steps");
          // Library edits never select a workflow. The same canonical identity and
          // acknowledged storage used by Device settings remain authoritative.
          if (body.choice === undefined) return response(200,snapshot(state,p));
          if (!object(body.choice) || Object.keys(body.choice).some(k => !["profileKey","mode","weight"].includes(k))) throw fail("Invalid profile choice");
          const result = saveQueue.then(() => configure(state, {...body.choice, enabled:config.devices[state.deviceId]?.enabled ?? true}, p));
          saveQueue = result.catch(() => {}); return response(200,await result);
        }
        if (request.endpoint === "configure") {
          const result = saveQueue.then(() => configure(state, request.body));
          saveQueue = result.catch(() => {}); return response(200,await result);
        }
        if (!state.ready || state.stopped) throw fail("Connect Atom65 first", "not_connected");
        if (!plan(state)) throw fail("This profile leaves the grinder unchanged; choose and save a sync mode first");
        queue(state,true); return response(202,{queued:true});
      } catch (e) {return response(["not_connected","storage_unavailable"].includes(e.code) ? 503 : ["busy","profile_changed"].includes(e.code) ? 409 : e.code === "invalid_argument" ? 400 : 502,{error:e.message,code:e.code});}
    }
  };
}
