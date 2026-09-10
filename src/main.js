import "./style.css";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

const STORAGE = {
  tasks: "task-helper.tasks",
  api: "task-helper.ai-config",
  profile: "task-helper.profile",
  calendar: "task-helper.calendar-events",
  settings: "task-helper.settings"
};

const defaultTasks = [
  { id: crypto.randomUUID(), title: "Finish CS50 problem set", due: "Today · 8:00 PM", priority: "High", done: false },
  { id: crypto.randomUUID(), title: "Review vector analysis notes", due: "Tomorrow · 6:00 PM", priority: "Medium", done: false },
  { id: crypto.randomUUID(), title: "Read chapter 4", due: "Friday · 9:00 PM", priority: "Low", done: false }
];

const state = {
  tasks: load(STORAGE.tasks, defaultTasks),
  api: load(STORAGE.api, null),
  profile: load(STORAGE.profile, null),
  calendar: load(STORAGE.calendar, []),
  settings: load(STORAGE.settings, { notifications: true, startup: true }),
  authenticated: false,
  view: "today",
  filter: "all",
  loading: true
};

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}

function render() {
  const active = state.tasks.filter(t => !t.done);
  const completed = state.tasks.filter(t => t.done);
  const visible = active.filter(t => state.filter === "all" || t.priority.toLowerCase() === state.filter);

  document.querySelector("#app").innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="brand-mark">T</span><div><strong>Task Helper</strong><small>memory-first study companion</small></div></div>
      <div class="top-actions">
        <span class="connection ${state.authenticated ? "online" : "offline"}">${state.authenticated ? "● Online" : "○ Local mode"}</span>
        <button class="ghost" id="calendarBtn">Calendar</button>
        <button class="avatar" id="accountBtn">${state.profile?.initials || "?"}</button>
      </div>
    </header>

    <main class="shell">
      <aside class="sidebar left">
        <div class="section-label">Workspace</div>
        <button class="nav ${state.view==="today"?"selected":""}" data-view="today">Today <span>${active.length}</span></button>
        <button class="nav ${state.view==="week"?"selected":""}" data-view="week">This week</button>
        <button class="nav" id="addTaskBtn">＋ New task</button>
        <div class="section-label space">Filters</div>
        ${["all","high","medium","low"].map(f => `<button class="filter ${state.filter===f?"selected":""}" data-filter="${f}">${f[0].toUpperCase()+f.slice(1)}</button>`).join("")}
        <div class="sidebar-bottom">
          <button class="nav" id="settingsBtn">Settings</button>
          <span class="status-dot"></span> ${state.authenticated ? "Synced account" : "Local mode"}
        </div>
      </aside>

      <section class="content">
        <div class="page-head">
          <div><p class="eyebrow">FOCUS</p><h1>${state.view === "today" ? "Today" : "This week"}</h1></div>
          <button class="primary" id="quickAdd">＋ Add task</button>
        </div>
        <div class="now-line"><span></span> NOW <b></b></div>
        <div class="task-list">
          ${visible.length ? visible.map(taskCard).join("") : `<div class="empty">No tasks here. Your schedule is clear.</div>`}
        </div>
        <section class="helper">
          <div class="helper-head"><div><strong>Helper</strong><span>Ask about your study materials or plan.</span></div><span class="ai-badge">${state.api ? "AI READY" : "SET API"}</span></div>
          <div class="chat" id="chat"></div>
          <form id="chatForm" class="chat-form">
            <input id="chatInput" placeholder="${state.api ? "Ask Task Helper…" : "Set your AI API key to enable AI…"}" autocomplete="off">
            <button>Send</button>
          </form>
        </section>
      </section>

      <aside class="sidebar right">
        <div class="panel"><div class="panel-title">Memory</div><div class="memory-score"><strong>${state.calendar.length + completed.length}</strong><span>items indexed</span></div><div class="memory-row"><span>Tasks</span><b>${state.tasks.length}</b></div><div class="memory-row"><span>Calendar</span><b>${state.calendar.length}</b></div><div class="memory-row"><span>Completed</span><b>${completed.length}</b></div></div>
        <div class="panel"><div class="panel-title">Progress</div><div class="progress"><i style="width:${state.tasks.length ? Math.round(completed.length/state.tasks.length*100) : 0}%"></i></div><div class="progress-text">${state.tasks.length ? Math.round(completed.length/state.tasks.length*100) : 0}% complete</div></div>
        <div class="panel"><div class="panel-title">Completed</div>${completed.slice(0,5).map(t => `<div class="completed"><span>✓</span>${escapeHtml(t.title)}</div>`).join("") || `<div class="muted">Nothing completed yet.</div>`}</div>
        <div class="panel"><div class="panel-title">Account</div><div class="muted">${state.profile ? "Signed in as " + escapeHtml(state.profile.email) : "Not signed in"}</div><button class="secondary full" id="accountPanelBtn">${state.profile ? "Account settings" : "Sign in with Google"}</button></div>
      </aside>
    </main>
    <div id="modalRoot"></div>
  `;
  bind();
}

function taskCard(t) {
  return `<article class="task ${t.priority.toLowerCase()}" data-id="${t.id}"><button class="check" aria-label="Complete task">${t.done?"✓":""}</button><div class="task-main"><strong>${escapeHtml(t.title)}</strong><span>${escapeHtml(t.due)}</span></div><span class="priority">${escapeHtml(t.priority)}</span><button class="more" data-delete="${t.id}" aria-label="Delete">⋯</button></article>`;
}

function bind() {
  document.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => { state.filter=b.dataset.filter; render(); });
  document.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { state.view=b.dataset.view; render(); });
  document.querySelectorAll(".check").forEach(b => b.onclick = async () => {
    const id = b.closest(".task").dataset.id; const t = state.tasks.find(x=>x.id===id); if (!t) return; t.done=!t.done;
    if (state.authenticated) { try { await api(`/api/tasks/${id}`, {method:"PATCH", body:JSON.stringify({done:t.done})}); } catch (e) { t.done=!t.done; alert(e.message); } }
    save(STORAGE.tasks,state.tasks); render();
  });
  document.querySelectorAll("[data-delete]").forEach(b => b.onclick = async () => {
    const id=b.dataset.delete;
    if (state.authenticated) { try { await api(`/api/tasks/${id}`, {method:"DELETE"}); } catch(e) { alert(e.message); return; } }
    state.tasks=state.tasks.filter(t=>t.id!==id); save(STORAGE.tasks,state.tasks); render();
  });
  document.querySelector("#addTaskBtn").onclick = openTaskModal;
  document.querySelector("#quickAdd").onclick = openTaskModal;
  document.querySelector("#settingsBtn").onclick = openSettings;
  document.querySelector("#calendarBtn").onclick = syncCalendar;
  document.querySelector("#accountBtn").onclick = () => state.profile ? openAccount() : googleSignIn();
  document.querySelector("#accountPanelBtn").onclick = () => state.profile ? openAccount() : googleSignIn();
  document.querySelector("#chatForm").onsubmit = handleChat;
}

function openTaskModal() {
  document.querySelector("#modalRoot").innerHTML = modal("New task", `<form id="taskForm" class="modal-form"><label>Task<input id="taskTitle" required placeholder="e.g. Finish chapter 3"></label><label>Due<input id="taskDue" placeholder="Today · 8:00 PM"></label><label>Priority<select id="taskPriority"><option>High</option><option selected>Medium</option><option>Low</option></select></label><button class="primary">Create task</button></form>`);
  closeOnBackdrop();
  document.querySelector("#taskForm").onsubmit = async e => {
    e.preventDefault();
    const task={id:crypto.randomUUID(),title:document.querySelector("#taskTitle").value.trim(),due:document.querySelector("#taskDue").value||"No due date",priority:document.querySelector("#taskPriority").value,done:false};
    if (state.authenticated) {
      try { const data=await api("/api/tasks",{method:"POST",body:JSON.stringify(task)}); task.id=data.task.id; } catch(err) { alert(err.message); return; }
    }
    state.tasks.unshift(task); save(STORAGE.tasks,state.tasks); document.querySelector("#modalRoot").innerHTML=""; render();
  };
}

function openSettings() {
  const cfg=state.api||{provider:"openai",baseUrl:"https://api.openai.com/v1",model:"gpt-4o-mini",key:""};
  document.querySelector("#modalRoot").innerHTML=modal("Settings",`<div class="settings-tabs"><button class="tab active">AI</button><button class="tab" id="googleTab">Google</button><button class="tab" id="appTab">App</button></div><form id="apiForm" class="modal-form"><label>Provider<select id="provider"><option value="openai">OpenAI-compatible</option><option value="openrouter">OpenRouter</option><option value="custom">Custom endpoint</option></select></label><label>API base URL<input id="baseUrl" value="${escapeHtml(cfg.baseUrl)}"></label><label>Model<input id="model" value="${escapeHtml(cfg.model)}"></label><label>API key<input id="apiKey" type="password" value="${escapeHtml(cfg.key)}" placeholder="sk-…"></label><div class="warning">This browser-only AI key is stored on this device. Do not put a shared provider key in the frontend.</div><button class="primary">Save API settings</button></form><div class="settings-google"><strong>Google account</strong><p class="muted">Google sign-in is verified by the Task Helper backend. Calendar remains an optional browser permission.</p><button class="secondary full" id="googleConnect">${state.profile?"Reconnect Google":"Sign in with Google"}</button></div>`);
  closeOnBackdrop();
  document.querySelector("#apiForm").onsubmit=e=>{e.preventDefault();state.api={provider:provider.value,baseUrl:baseUrl.value.replace(/\/$/,""),model:model.value,key:apiKey.value};save(STORAGE.api,state.api);document.querySelector("#modalRoot").innerHTML="";render();};
  document.querySelector("#googleConnect").onclick=googleSignIn;
}

function openAccount() {
  document.querySelector("#modalRoot").innerHTML=modal("Google account",`<div class="account-card"><div class="big-avatar">${escapeHtml(state.profile.initials)}</div><strong>${escapeHtml(state.profile.name||"Google user")}</strong><span>${escapeHtml(state.profile.email||"")}</span></div><button class="secondary full" id="disconnect">Sign out</button>`);
  closeOnBackdrop();
  document.querySelector("#disconnect").onclick=async()=>{try{await api("/api/auth/logout",{method:"POST"});}catch{} state.profile=null;state.authenticated=false;save(STORAGE.profile,null);document.querySelector("#modalRoot").innerHTML="";render();};
}

function modal(title,body){return `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>${title}</h2><button id="closeModal">×</button></div>${body}</div></div>`;}
function closeOnBackdrop(){document.querySelector("#closeModal").onclick=()=>document.querySelector("#modalRoot").innerHTML="";document.querySelector(".modal-backdrop").onclick=e=>{if(e.target.classList.contains("modal-backdrop"))document.querySelector("#modalRoot").innerHTML="";};}

function googleSignIn() {
  if (!GOOGLE_CLIENT_ID) { alert("Google login is not configured. Set VITE_GOOGLE_CLIENT_ID in the frontend environment."); return; }
  if (!window.google?.accounts?.id) { alert("Google Sign-In is still loading. Please try again in a moment."); return; }
  const host=document.createElement("div"); host.id="google-temp"; host.style.cssText="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99999;background:#161b22;padding:24px;border:1px solid #30363d;border-radius:12px"; document.body.appendChild(host);
  window.google.accounts.id.initialize({client_id:GOOGLE_CLIENT_ID,callback:async response=>{
    try {
      const data=await api("/api/auth/google",{method:"POST",body:JSON.stringify({credential:response.credential})});
      state.profile={...data.user,initials:(data.user.name||data.user.email||"?").split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase()};
      state.authenticated=true; save(STORAGE.profile,state.profile);
      await loadServerTasks();
      host.remove(); document.querySelector("#modalRoot").innerHTML=""; render();
    } catch (e) { host.remove(); alert(e.message || "Google login failed."); }
  }});
  window.google.accounts.id.renderButton(host,{theme:"outline",size:"large",text:"signin_with"});
}

async function restoreSession() {
  try {
    const data=await api("/api/auth/me");
    state.profile={...data.user,initials:(data.user.name||data.user.email||"?").split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase()};
    state.authenticated=true; save(STORAGE.profile,state.profile); await loadServerTasks();
  } catch {
    state.authenticated=false;
  }
  state.loading=false; render();
}

async function loadServerTasks() {
  try { const data=await api("/api/tasks"); state.tasks=(data.tasks||[]).map(t=>({id:t.id,title:t.title,due:t.due,priority:t.priority,done:t.done})); save(STORAGE.tasks,state.tasks); } catch(e) { console.warn("Task sync unavailable:",e.message); }
}

function requestCalendarToken() {
  const clientId=GOOGLE_CLIENT_ID;
  if(!clientId||!window.google?.accounts?.oauth2) return;
  const tokenClient=window.google.accounts.oauth2.initTokenClient({client_id:clientId,scope:"https://www.googleapis.com/auth/calendar.readonly",callback:async response=>{if(response.error)return;state.calendarToken=response.access_token;await fetchCalendar();}});
  tokenClient.requestAccessToken({prompt:"consent"});
}
async function syncCalendar(){if(!state.profile){googleSignIn();return;}if(!state.calendarToken){requestCalendarToken();return;}await fetchCalendar();}
async function fetchCalendar(){try{const url="https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin="+encodeURIComponent(new Date().toISOString())+"&maxResults=30";const res=await fetch(url,{headers:{Authorization:"Bearer "+state.calendarToken}});if(!res.ok)throw new Error("Calendar request failed");const data=await res.json();state.calendar=(data.items||[]).map(e=>({id:e.id,title:e.summary||"(untitled)",start:e.start?.dateTime||e.start?.date,description:e.description||""}));save(STORAGE.calendar,state.calendar);render();}catch(e){alert("Calendar sync failed. Check Calendar API and Google permission settings.");}}

async function handleChat(e){e.preventDefault();const input=document.querySelector("#chatInput");const text=input.value.trim();if(!text)return;if(!state.api?.key){openSettings();return;}const chat=document.querySelector("#chat");chat.insertAdjacentHTML("beforeend",`<div class="msg user">${escapeHtml(text)}</div>`);input.value="";chat.insertAdjacentHTML("beforeend",`<div class="msg assistant" id="thinking">Thinking…</div>`);try{const base=state.api.baseUrl;const res=await fetch(base+"/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+state.api.key},body:JSON.stringify({model:state.api.model,messages:[{role:"system",content:"You are Task Helper, a concise study companion. Help organize tasks and explain study concepts. Do not claim to remember files that were not supplied."},{role:"user",content:text}],temperature:0.3})});if(!res.ok)throw new Error(await res.text());const data=await res.json();document.querySelector("#thinking").textContent=data.choices?.[0]?.message?.content||"No response.";}catch(err){document.querySelector("#thinking").textContent="AI request failed. Check your API key, model, endpoint, and CORS support.";}}

if ("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
restoreSession();
