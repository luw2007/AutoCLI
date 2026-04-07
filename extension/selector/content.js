/**
 * AutoCLI Selector Tool — Content Script
 * Right-side panel with entries-based rule management.
 * Design language: AutoCLI EON Systems (sharp corners, Satoshi + JetBrains Mono)
 */

(() => {
  const _PANEL_WIDTH = 320;

  // Toggle if already active
  if (window.__autocliSelectorActive) {
    const p = document.getElementById('__osp-root');
    const o = document.getElementById('__autocli-selector-overlay');
    if (p) {
      const showing = p.style.display !== 'none';
      p.style.display = showing ? 'none' : 'block';
      if (o) o.style.display = showing ? 'none' : 'block';
      if (showing) {
        document.body.style.marginRight = window.__ospOrigMarginRight || '';
        document.body.style.overflowX = window.__ospOrigOverflowX || '';
      } else {
        window.__ospOrigMarginRight = document.body.style.marginRight;
        window.__ospOrigOverflowX = document.body.style.overflowX;
        document.body.style.marginRight = _PANEL_WIDTH + 'px';
        document.body.style.overflowX = 'hidden';
      }
    }
    return;
  }
  window.__autocliSelectorActive = true;

  const SE = window.__autocliSelectorEngine;
  if (!SE) { console.error('[autocli-selector] Engine not loaded'); return; }
  const PANEL_WIDTH = _PANEL_WIDTH;

  // ─── State ────────────────────────────────────────────────────
  let mode = 'idle';
  let hoverEl = null;
  let activeEntryId = null;
  let entries = [];
  let entryIdCounter = 0;
  let generatedDone = false; // true after successful generate, reset on entry changes
  const COLORS = ['#ff571a','#4ecdc4','#45b7d1','#ffd93d','#a29bfe','#fd79a8','#96ceb4','#ff8a5c','#88d8b0','#c9b1ff'];

  // ─── Shrink page ──────────────────────────────────────────────
  window.__ospOrigMarginRight = document.body.style.marginRight;
  window.__ospOrigOverflowX = document.body.style.overflowX;
  document.body.style.marginRight = PANEL_WIDTH + 'px';
  document.body.style.overflowX = 'hidden';

  // ─── Shadow DOM ───────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = '__osp-root';
  root.style.cssText = `position:fixed;top:0;right:0;width:${PANEL_WIDTH}px;height:100vh;z-index:2147483647;`;
  document.documentElement.appendChild(root);

  const shadow = root.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      @import url('https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&f[]=jet-brains-mono@400,500&display=swap');
      :host { all:initial; }
      * { margin:0; padding:0; box-sizing:border-box; }

      .panel {
        width:${PANEL_WIDTH}px; height:100vh; background:#fbfbfb;
        border-left:1px solid #e2e2e2; display:flex; flex-direction:column;
        position:relative;
        font-family:'Satoshi',-apple-system,sans-serif; font-size:13px; color:#0f1112;
        -webkit-font-smoothing:antialiased;
      }

      /* Header */
      .header {
        display:flex; align-items:center; gap:8px; padding:12px 16px;
        border-bottom:1px solid #e2e2e2; background:#ffffff; flex-shrink:0;
      }
      .logo {
        font-family:'JetBrains Mono',monospace; font-size:14px; font-weight:700;
        color:#0f1112; letter-spacing:-0.04em; display:flex; align-items:baseline; gap:1px;
        text-decoration:none; cursor:pointer;
      }
      .logo:hover { opacity:0.7; }
      .logo-mark {
        display:inline-flex; align-items:center; justify-content:center;
        width:10px; height:12px; background:#0f1112; flex-shrink:0; align-self:center;
      }
      .logo-mark::after {
        content:''; display:block; width:2px; height:7px; background:#ff571a;
        animation:cursor-blink 1s step-end infinite;
      }
      @keyframes cursor-blink { 0%,100%{opacity:1} 50%{opacity:0} }
      .logo-cli { color:#ff571a; margin-left:-1px; }
      .logo-s { color:#aaabab; font-weight:500; margin-left:-1px; }
      .header-sep { color:#e2e2e2; font-size:14px; font-weight:300; }
      .header-sub { color:#5d5f5f; font-size:12px; font-weight:500; flex:1; }
      .icon-btn {
        background:none; border:1px solid #e2e2e2; width:28px; height:28px;
        display:flex; align-items:center; justify-content:center;
        cursor:pointer; color:#5d5f5f; font-size:13px; transition:border-color 0.2s;
      }
      .icon-btn:hover { border-color:#ff571a; color:#0f1112; }

      /* Body */
      .body { padding:12px 16px; flex:1; overflow-y:auto; padding-bottom:60px; }

      /* Footer — sticky generate button */
      .footer {
        position:absolute; bottom:0; left:0; right:0;
        padding:10px 16px; background:#fff; border-top:1px solid #e2e2e2;
      }

      /* Top bar */
      .top-bar { display:flex; gap:6px; margin-bottom:12px; }
      .btn {
        display:inline-flex; align-items:center; justify-content:center; gap:5px;
        padding:7px 14px; font-family:inherit; font-size:12px; font-weight:500;
        color:#0f1112; background:#ffffff; border:1px solid #e2e2e2;
        cursor:pointer; transition:border-color 0.2s, background 0.2s; white-space:nowrap;
      }
      .btn:hover { border-color:#ff571a; background:#f0f1f1; }
      .btn-accent { color:#ffffff; background:#ff571a; border-color:#ff571a; }
      .btn-accent:hover { opacity:0.88; background:#ff571a; border-color:#ff571a; }
      .btn-sm { padding:3px 8px; font-size:10px; }
      .btn-save { color:#fff; background:#00cc66; border-color:#00cc66; }
      .btn-save:hover { opacity:0.88; }
      .btn-edit { color:#0f1112; background:#ffd93d; border-color:#ffd93d; }
      .btn-edit:hover { opacity:0.88; }
      .btn-danger { color:#ff571a; border-color:#ff571a; background:transparent; }
      .btn-danger:hover { background:rgba(255,87,26,0.06); }

      /* Status */
      .status {
        padding:8px 12px; border:1px solid #e2e2e2; background:#ffffff;
        font-size:11px; color:#5d5f5f; margin-bottom:12px; line-height:1.5;
      }
      .status b { color:#0f1112; }
      .status.success { border-color:rgba(0,204,102,0.3); background:rgba(0,204,102,0.04); color:#0f1112; }

      /* Entry card */
      .entry {
        border:1px solid #e2e2e2; margin-bottom:8px; background:#ffffff;
        transition:border-color 0.2s;
      }
      .entry.active { border-color:#ff571a; }
      .entry.saved { border-color:rgba(0,204,102,0.4); }

      .entry-head { padding:10px 12px; }
      /* Row 1: dot + name */
      .entry-top {
        display:flex; align-items:center; gap:8px;
      }
      .entry-dot { width:10px; height:10px; flex-shrink:0; }
      .entry-name-display { font-weight:700; font-size:13px; flex:1; letter-spacing:-0.3px; }
      .entry-name-input {
        border:1px solid #e2e2e2; background:#fbfbfb; font-family:inherit;
        font-size:13px; font-weight:700; padding:2px 6px; flex:1; outline:none;
        min-width:0; letter-spacing:-0.3px;
      }
      .entry-name-input:focus { border-color:#ff571a; }

      /* Row 2: tags left + buttons right */
      .entry-bar {
        display:flex; align-items:center; margin-top:8px; gap:6px;
      }
      .entry-tags { display:flex; gap:4px; flex:1; }
      .tag {
        display:inline-flex; align-items:center; padding:2px 7px; flex-shrink:0;
        font-size:10px; font-weight:500; font-family:'JetBrains Mono',monospace;
        border:1px solid #f2f2f2; color:#aaabab; background:#f0f1f1;
      }
      .tag-picking { color:#ff571a; border-color:rgba(255,87,26,0.25); background:rgba(255,87,26,0.06); }
      .tag-saved { color:#00cc66; border-color:rgba(0,204,102,0.25); background:rgba(0,204,102,0.06); }
      .entry-actions { display:flex; gap:4px; flex-shrink:0; }

      .entry-body { padding:8px 12px; border-top:1px solid #f2f2f2; }
      .entry-sel {
        background:#0f1112; color:#e0e0e0;
        font:10px/1.4 'JetBrains Mono',monospace;
        padding:4px 8px; cursor:pointer;
        transition:background 0.15s;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      }
      .entry-sel:hover { background:#1a1c1e; }
      .entry-sample {
        font-size:11px; color:#5d5f5f; margin-top:6px; line-height:1.5;
        font-family:'JetBrains Mono',monospace;
        white-space:pre-line;
      }
      .entry-save-bar { padding:8px 12px; border-top:1px solid #f2f2f2; }
      .btn-entry-save {
        width:100%; padding:6px; background:#00cc66; color:#fff;
        border:1px solid #00cc66; font-size:11px; font-weight:600;
        cursor:pointer; font-family:'Satoshi',sans-serif;
      }
      .btn-entry-save:hover { opacity:0.88; }

      /* Empty state */
      .empty {
        text-align:center; color:#aaabab; padding:24px 0; font-size:12px;
        border:1px dashed #e2e2e2; margin-bottom:8px;
      }

      /* Help */
      .help {
        font-size:10px; color:#aaabab; margin-top:10px; line-height:1.5;
        font-family:'JetBrains Mono',monospace;
      }

      /* Export */
      .section { margin-top:12px; }
      .sec-title { font-size:10px; font-weight:600; text-transform:uppercase; color:#888; margin-bottom:6px; letter-spacing:0.5px; }
      .export-bar { display:flex; gap:5px; margin-bottom:6px; }
      .export-area {
        background:#0f1112; color:#e0e0e0; font:10px/1.4 'JetBrains Mono',monospace;
        padding:8px; max-height:200px; overflow-y:auto;
        white-space:pre-wrap; word-break:break-all;
      }

      /* Generate */
      @keyframes gen-pulse {
        0%, 100% { opacity:1; }
        50% { opacity:0.6; }
      }
      @keyframes gen-slide {
        0% { background-position:200% 0; }
        100% { background-position:-200% 0; }
      }
      .btn-generate {
        width:100%; padding:8px;
        background:#ff571a; color:#fff; border:1px solid #ff571a;
        font-size:12px; font-weight:600; cursor:pointer;
        font-family:'Satoshi',sans-serif; letter-spacing:0.3px;
        position:relative; overflow:hidden;
      }
      .btn-generate:hover { opacity:0.88; }
      .btn-generate:disabled { cursor:not-allowed; }
      .btn-generate.loading {
        background:linear-gradient(90deg, #5d5f5f 0%, #888 50%, #5d5f5f 100%);
        background-size:200% 100%;
        animation:gen-slide 1.5s ease infinite;
        border-color:#5d5f5f;
      }
      .generate-stream {
        background:#0f1112; color:#5d5f5f; font:10px/1.4 'JetBrains Mono',monospace;
        padding:6px 8px; margin-top:8px; height:56px; overflow:hidden;
        white-space:pre; border:1px solid #333; position:relative;
      }
      .generate-stream.active { border-color:#ff571a; color:#aaabab; }
      .generate-stream::after {
        content:''; position:absolute; bottom:0; left:0; right:0; height:16px;
        background:linear-gradient(transparent, #0f1112);
      }
      @keyframes sum-appear {
        0% { opacity:0; transform:translateY(8px); }
        100% { opacity:1; transform:translateY(0); }
      }
      .generate-summary {
        margin-top:8px; border:1px solid #e2e2e2; background:#fff; padding:12px 14px;
        animation:sum-appear 0.4s cubic-bezier(0.22,1,0.36,1);
      }
      .sum-title {
        font-size:15px; font-weight:700; color:#0f1112; letter-spacing:-0.3px;
        font-family:'JetBrains Mono',monospace;
      }
      .sum-title .sep { color:#e2e2e2; font-weight:300; margin:0 4px; }
      .sum-desc { font-size:11px; color:#5d5f5f; margin-top:2px; line-height:1.4; }
      .sum-meta { display:flex; gap:4px; flex-wrap:wrap; margin-top:8px; align-items:center; }
      .sum-meta-label { font-size:10px; color:#aaabab; font-family:'JetBrains Mono',monospace; margin-right:2px; }
      .sum-tag {
        display:inline-flex; align-items:center; padding:2px 7px;
        font-size:10px; font-weight:500; font-family:'JetBrains Mono',monospace;
        border:1px solid #f2f2f2; color:#5d5f5f; background:#f0f1f1;
      }
      .sum-tag.accent { color:#ff571a; border-color:rgba(255,87,26,0.2); background:rgba(255,87,26,0.04); }
      .sum-section-title {
        font-size:10px; font-weight:600; text-transform:uppercase; color:#aaabab;
        margin-top:10px; margin-bottom:4px; letter-spacing:0.5px;
      }
      .sum-columns { display:flex; gap:4px; flex-wrap:wrap; }
      .sum-col {
        display:inline-flex; padding:3px 8px;
        font-size:10px; font-weight:600; font-family:'JetBrains Mono',monospace;
        background:#0f1112; color:#e0e0e0;
      }
      .sum-cmd {
        display:flex; align-items:center;
        background:#0f1112; color:#e0e0e0; padding:8px 10px; margin-top:4px;
        font:12px/1.4 'JetBrains Mono',monospace; cursor:pointer;
      }
      .sum-cmd:hover { background:#1a1c1e; }
      .sum-cmd-text { flex:1; }
      .sum-cmd .arg { color:#ff571a; }
      .sum-cmd-copy {
        flex-shrink:0; color:#5d5f5f; font-size:10px;
        padding:2px 6px; border:1px solid #333;
        font-family:'JetBrains Mono',monospace;
      }
      .sum-cmd-copy:hover { color:#fff; border-color:#5d5f5f; }
      .sum-link {
        display:block; text-align:center; margin-top:8px;
        font-size:10px; color:#aaabab; text-decoration:none;
        font-family:'JetBrains Mono',monospace;
      }
      .sum-link:hover { color:#ff571a; }
      .sum-synced {
        text-align:center; margin-top:8px; padding-top:8px;
        border-top:1px solid #f2f2f2;
        font-size:10px; color:#aaabab; font-family:'JetBrains Mono',monospace;
      }
      .sum-synced .check { color:#00cc66; }
      .generate-error {
        font-size:11px; margin-bottom:8px; padding:8px 10px;
        border:1px solid #ff571a; background:rgba(255,87,26,0.04);
        color:#ff571a; font-family:'JetBrains Mono',monospace;
        line-height:1.4; word-break:break-all;
      }
      .gen-ratelimit {
        border:1px solid #ffd93d; background:#fffdf5; padding:10px 12px; margin-bottom:8px;
      }
      .gen-rl-header { display:flex; align-items:center; gap:6px; }
      .gen-rl-bar { width:3px; height:14px; background:#ffd93d; flex-shrink:0; }
      .gen-rl-title { font-size:12px; font-weight:700; color:#0f1112; letter-spacing:-0.2px; }
      .gen-rl-msg { font-size:10px; color:#5d5f5f; margin-top:6px; line-height:1.5; font-family:'JetBrains Mono',monospace; }
      .gen-rl-link {
        display:block; margin-top:6px; padding-top:6px; border-top:1px solid #f2f2f2;
        font-size:10px; color:#aaabab; text-decoration:none; text-align:center;
        font-family:'JetBrains Mono',monospace;
      }
      .gen-rl-link:hover { color:#ff571a; }

      /* Toast */
      .toast {
        position:fixed; bottom:16px; left:50%; transform:translateX(-50%);
        background:#0f1112; color:#fff; padding:5px 16px;
        font-size:11px; font-family:'JetBrains Mono',monospace;
        display:none; z-index:2;
      }
    </style>

    <div class="panel">
      <div class="header">
        <a class="logo" id="s-logo" href="#" title="Open autocli.ai"><span class="logo-mark"></span>Auto<span class="logo-cli">CLI</span><span class="logo-s">.ai</span></a>
        <span class="header-sep">/</span>
        <span class="header-sub">Selector</span>
        <button class="icon-btn" id="s-close" title="Close">✕</button>
      </div>
      <div class="body">
        <div class="top-bar">
          <button class="btn btn-accent" id="s-add">+ New Entry</button>
        </div>
        <div class="status" id="s-status">Create entries and pick elements to build selectors.</div>
        <div id="s-entries">
          <div class="empty" id="s-empty">No entries yet</div>
        </div>
        <div id="s-sec-export" style="display:none;"></div>
        <div class="generate-stream" id="s-gen-stream" style="display:none;"></div>
        <div class="generate-summary" id="s-gen-summary" style="display:none;"></div>
      </div>
      <div class="footer" id="s-sec-generate">
        <div class="generate-error" id="s-gen-error" style="display:none;"></div>
        <div class="gen-ratelimit" id="s-gen-rl" style="display:none;"></div>
        <button class="btn-generate" id="s-generate" disabled>Generate Adapter with AI</button>
      </div>
      <div class="toast" id="s-toast">copied</div>
    </div>
  `;

  const q = id => shadow.getElementById(id);
  const statusEl = q('s-status');
  const entriesEl = q('s-entries');
  const emptyEl = q('s-empty');
  const toastEl = q('s-toast');
  const exportSection = q('s-sec-export');
  const genSection = q('s-sec-generate');
  const genBtn = q('s-generate');
  const genStream = q('s-gen-stream');
  const genSummary = q('s-gen-summary');
  const genError = q('s-gen-error');
  const genRateLimit = q('s-gen-rl');

  function setStatus(h, t) { statusEl.innerHTML = h; statusEl.className = 'status'+(t?' '+t:''); }
  function showToast(t) { toastEl.textContent=t||'copied'; toastEl.style.display='block'; setTimeout(()=>toastEl.style.display='none',1000); }
  function copyText(t) { navigator.clipboard.writeText(t); showToast(); }
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // ─── Overlay ──────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = '__autocli-selector-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483645;pointer-events:none;';
  document.documentElement.appendChild(overlay);

  const highlights = new Map();
  function addHighlight(el, color, label, eid) {
    removeHighlight(el);
    const r = el.getBoundingClientRect();
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;border:2px solid ${color};background:${color}18;pointer-events:none;z-index:2147483644;top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px;transition:all 0.15s;`;
    if (label) { const t=document.createElement('span'); t.style.cssText=`position:absolute;top:-15px;left:0;background:${color};color:#fff;font:600 9px/1 'Satoshi',sans-serif;padding:2px 5px;white-space:nowrap;`; t.textContent=label; d.appendChild(t); }
    overlay.appendChild(d); highlights.set(el, {div:d,eid});
  }
  function removeHighlight(el) { const h=highlights.get(el); if(h){h.div.remove();highlights.delete(el);} }
  function clearForEntry(eid) { for(const[el,h]of highlights){if(h.eid===eid){h.div.remove();highlights.delete(el);}} }
  function clearAllHighlights() { highlights.forEach(h=>h.div.remove()); highlights.clear(); }
  function updatePos() { highlights.forEach((h,el)=>{ const r=el.getBoundingClientRect(); Object.assign(h.div.style,{top:r.top+'px',left:r.left+'px',width:r.width+'px',height:r.height+'px'}); }); }

  const hoverDiv = document.createElement('div');
  hoverDiv.style.cssText = 'position:fixed;border:1px solid #ff571a;background:rgba(255,87,26,0.06);pointer-events:none;z-index:2147483644;display:none;';
  overlay.appendChild(hoverDiv);
  function showHover(el) { const r=el.getBoundingClientRect(); Object.assign(hoverDiv.style,{top:r.top+'px',left:r.left+'px',width:r.width+'px',height:r.height+'px',display:'block'}); }
  function hideHover() { hoverDiv.style.display='none'; }

  // ─── Events ───────────────────────────────────────────────────
  function isPanel(el) { return el && (root.contains(el) || el===root); }
  document.addEventListener('mousemove', e => { if(mode!=='picking')return; const el=e.target; if(!el||isPanel(el)||el.closest('#__autocli-selector-overlay'))return; if(el===hoverEl)return; hoverEl=el; showHover(el); }, true);
  document.addEventListener('mousedown', e => { if(mode!=='picking'||!activeEntryId)return; const el=e.target; if(!el||isPanel(el)||el.closest('#__autocli-selector-overlay'))return; e.preventDefault();e.stopPropagation();e.stopImmediatePropagation(); pickForEntry(el); }, true);
  document.addEventListener('mouseup', e => { if(mode==='picking'&&!isPanel(e.target)){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();} }, true);
  document.addEventListener('click', e => { if(mode==='picking'&&!isPanel(e.target)){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();} }, true);
  document.addEventListener('scroll', updatePos, true);
  window.addEventListener('resize', updatePos);
  document.addEventListener('keydown', e => { if(e.key==='Escape') stopPicking(); }, true);

  // ─── Entry CRUD ───────────────────────────────────────────────
  function getEntry(id) { return entries.find(e=>e.id===id); }

  function createEntry(name) {
    resetGenerated();
    const id = ++entryIdCounter;
    const color = COLORS[(id-1)%COLORS.length];
    entries.push({ id, name:name||`entry_${id}`, elements:[], selector:'', matchCount:0, color, saved:false, sample:'' });
    activateEntry(id);
    render(); return id;
  }

  function deleteEntry(id) {
    resetGenerated();
    clearForEntry(id);
    entries = entries.filter(e=>e.id!==id);
    if (activeEntryId===id) { activeEntryId=null; mode='idle'; hideHover(); }
    render(); updateExport();
  }

  function saveEntry(id) {
    const e = getEntry(id);
    if (!e) return;
    e.saved = true;
    if (activeEntryId===id) { activeEntryId=null; mode='idle'; hideHover(); }
    setStatus(`<b>${esc(e.name)}</b> saved`, 'success');
    render(); updateExport();
  }

  // Snapshot storage for discard
  const snapshots = new Map(); // entryId -> { name, elements[], selector, matchCount, sample }

  function editEntry(id) {
    resetGenerated();
    const e = getEntry(id);
    if (!e) return;
    // Save snapshot before editing
    snapshots.set(id, { name:e.name, elements:[...e.elements], selector:e.selector, matchCount:e.matchCount, sample:e.sample });
    e.saved = false;
    activateEntry(id);
    render();
  }

  function discardEntry(id) {
    const e = getEntry(id);
    const snap = snapshots.get(id);
    if (!e || !snap) return;
    // Restore snapshot
    clearForEntry(id);
    e.name = snap.name;
    e.elements = snap.elements;
    e.selector = snap.selector;
    e.matchCount = snap.matchCount;
    e.sample = snap.sample;
    e.saved = true;
    snapshots.delete(id);
    if (activeEntryId===id) { activeEntryId=null; mode='idle'; hideHover(); }
    // Re-highlight restored elements
    e.elements.forEach(el => addHighlight(el, e.color, e.name, e.id));
    setStatus(`<b>${esc(e.name)}</b> changes discarded`, '');
    render(); updateExport();
  }

  function activateEntry(id) {
    const e = getEntry(id);
    if (!e || e.saved) return;
    activeEntryId = id;
    mode = 'picking';
    setStatus(`Picking for <b>${esc(e.name)}</b>`, '');
    render();
  }

  function pickForEntry(el) {
    const entry = getEntry(activeEntryId);
    if (!entry || entry.saved) return;
    const idx = entry.elements.indexOf(el);
    if (idx >= 0) { entry.elements.splice(idx,1); removeHighlight(el); }
    else { entry.elements.push(el); addHighlight(el, entry.color, entry.name, entry.id); }

    if (entry.elements.length === 1) {
      entry.selector = SE.cssSelector(entry.elements[0]);
      entry.matchCount = document.querySelectorAll(entry.selector).length;
    } else if (entry.elements.length >= 2) {
      const result = SE.computeListSelector(entry.elements);
      if (result) {
        entry.selector = result.full; entry.matchCount = result.matchCount;
        clearForEntry(entry.id);
        entry.elements.forEach(e => addHighlight(e, entry.color, entry.name, entry.id));
        result.itemElements.forEach(item => { if(!entry.elements.includes(item)) addHighlight(item, entry.color, '', entry.id); });
      } else {
        entry.selector = entry.elements.map(e=>SE.cssSelector(e)).join(', ');
        entry.matchCount = entry.elements.length;
      }
    } else { entry.selector=''; entry.matchCount=0; }

    // Collect sample lines from matched elements
    const sampleLines = entry.elements.slice(0, 3).map(el => {
      return el.textContent.trim().replace(/\s+/g, ' ').substring(0, 60);
    }).filter(Boolean);
    if (entry.matchCount > 3) sampleLines.push('…');
    entry.sample = sampleLines.join('\n');
    setStatus(`<b>${esc(entry.name)}</b> — ${entry.matchCount} matched`, 'success');
    render(); updateExport();
  }

  function stopPicking() { mode='idle'; activeEntryId=null; hideHover(); setStatus('Stopped',''); render(); }

  // ─── Render ───────────────────────────────────────────────────
  function render() {
    emptyEl.style.display = entries.length===0 ? 'block' : 'none';
    entriesEl.querySelectorAll('.entry').forEach(el=>el.remove());

    entries.forEach(entry => {
      const isActive = activeEntryId===entry.id;
      const card = document.createElement('div');
      card.className = 'entry' + (isActive?' active':'') + (entry.saved?' saved':'');

      const head = document.createElement('div');
      head.className = 'entry-head';

      // Row 1: dot + name + tags
      const topRow = document.createElement('div');
      topRow.className = 'entry-top';

      const dot = document.createElement('span');
      dot.className = 'entry-dot';
      dot.style.background = entry.color;
      topRow.appendChild(dot);

      if (entry.saved) {
        const nm = document.createElement('span');
        nm.className = 'entry-name-display';
        nm.textContent = entry.name;
        topRow.appendChild(nm);
      } else {
        const inp = document.createElement('input');
        inp.className = 'entry-name-input';
        inp.value = entry.name;
        inp.addEventListener('change', () => { entry.name = inp.value.trim()||entry.name; updateExport(); });
        inp.addEventListener('click', e => e.stopPropagation());
        topRow.appendChild(inp);
      }

      head.appendChild(topRow);

      // Row 2: tags (left) + buttons (right)
      const bar = document.createElement('div');
      bar.className = 'entry-bar';

      const tagsDiv = document.createElement('div');
      tagsDiv.className = 'entry-tags';

      if (isActive) {
        const tag = document.createElement('span');
        tag.className = 'tag tag-picking'; tag.textContent = 'picking';
        tagsDiv.appendChild(tag);
      } else if (entry.saved) {
        const tag = document.createElement('span');
        tag.className = 'tag tag-saved'; tag.textContent = 'saved';
        tagsDiv.appendChild(tag);
      }
      if (entry.matchCount > 0) {
        const tag = document.createElement('span');
        tag.className = 'tag'; tag.textContent = entry.matchCount + ' matched';
        tagsDiv.appendChild(tag);
      }

      bar.appendChild(tagsDiv);

      const actions = document.createElement('div');
      actions.className = 'entry-actions';

      if (entry.saved) {
        const b = document.createElement('button');
        b.className = 'btn btn-sm btn-edit'; b.textContent = 'Edit';
        b.addEventListener('click', e => { e.stopPropagation(); editEntry(entry.id); });
        actions.appendChild(b);
      } else {
        if (!isActive) {
          const b = document.createElement('button');
          b.className = 'btn btn-sm'; b.textContent = 'Pick';
          b.addEventListener('click', e => { e.stopPropagation(); activateEntry(entry.id); });
          actions.appendChild(b);
        }
        // Save button moved to entry bottom
        if (snapshots.has(entry.id)) {
          const b = document.createElement('button');
          b.className = 'btn btn-sm btn-danger'; b.textContent = 'Discard';
          b.addEventListener('click', e => { e.stopPropagation(); discardEntry(entry.id); });
          actions.appendChild(b);
        }
      }
      const del = document.createElement('button');
      del.className = 'btn btn-sm btn-danger'; del.textContent = '✕';
      del.addEventListener('click', e => { e.stopPropagation(); deleteEntry(entry.id); });
      actions.appendChild(del);

      bar.appendChild(actions);
      head.appendChild(bar);
      card.appendChild(head);

      // Body
      if (entry.selector) {
        const body = document.createElement('div');
        body.className = 'entry-body';
        const sel = document.createElement('div');
        sel.className = 'entry-sel';
        sel.textContent = entry.selector;
        sel.title = 'Click to copy full selector';
        sel.addEventListener('click', () => copyText(entry.selector));
        body.appendChild(sel);
        if (entry.sample) {
          const s = document.createElement('div');
          s.className = 'entry-sample';
          s.textContent = entry.sample;
          body.appendChild(s);
        }
        card.appendChild(body);

        // Save button at bottom (only for unsaved entries with selector)
        if (!entry.saved) {
          const saveBar = document.createElement('div');
          saveBar.className = 'entry-save-bar';
          const saveBtn = document.createElement('button');
          saveBtn.className = 'btn-entry-save';
          saveBtn.textContent = 'Save';
          saveBtn.addEventListener('click', e => { e.stopPropagation(); saveEntry(entry.id); });
          saveBar.appendChild(saveBtn);
          card.appendChild(saveBar);
        }
      }
      entriesEl.appendChild(card);
    });
    updateGenButton();
  }

  // ─── Export ────────────────────────────────────────────────────
  function updateExport() {
    const withSelector = entries.filter(e=>e.selector);
    if (!withSelector.length) {
      window.__autocliSelectorExport = null;
      exportSection.style.display = 'none';
      updateGenButton();
      return;
    }
    const data = {
      url: location.href,
      title: document.title,
      entries: withSelector.map(e=>({ name:e.name, selector:e.selector, matchCount:e.matchCount, saved:e.saved, sample:e.sample||'' })),
    };
    window.__autocliSelectorExport = data;
    exportSection.style.display = 'none';
    updateGenButton();
  }

  function updateGenButton() {
    if (generatedDone) {
      genBtn.disabled = true;
      genBtn.textContent = 'Done';
      genBtn.classList.remove('loading');
      return;
    }
    const hasSaved = entries.some(e => e.saved && e.selector);
    const hasUnsaved = entries.some(e => !e.saved && e.selector);
    genBtn.disabled = !hasSaved || hasUnsaved;
    genBtn.textContent = 'Generate Adapter with AI';
  }

  function resetGenerated() {
    generatedDone = false;
    updateGenButton();
  }

  // ─── Panel buttons ────────────────────────────────────────────
  q('s-add').addEventListener('click', () => {
    createEntry('');
  });

  // Blocks button removed from UI

  q('s-logo').addEventListener('click', (e) => {
    e.preventDefault();
    window.open('https://www.autocli.ai', '_blank');
  });

  // Export UI removed — data stored in window.__autocliSelectorExport for API calls

  // ─── Generate with AI ──────────────────────────────────────────
  genBtn.addEventListener('click', () => {
    const exportData = window.__autocliSelectorExport;
    if (!exportData) return;

    genBtn.disabled = true;
    genBtn.textContent = 'Cleaning DOM...';
    genBtn.classList.add('loading');
    genStream.style.display = 'block';
    genStream.textContent = '';
    genStream.classList.add('active');
    genSummary.style.display = 'none';
    genError.style.display = 'none';
    genRateLimit.style.display = 'none';

    (async () => {
    try {
      // Step 1: Clean DOM
      let domTree = '';
      try {
        const DC = window.__autocliDomClean;
        if (DC) {
          domTree = await eval(DC.fullCleanPipelineJs({ scrollPages: 2 }));
        } else {
          domTree = document.documentElement.outerHTML.substring(0, 30000);
        }
      } catch(e) {
        domTree = document.documentElement.outerHTML.substring(0, 30000);
      }

      genBtn.textContent = 'Analyzing...';

      // Step 2: Build request
      const capturedData = {
        url: exportData.url,
        title: exportData.title || document.title,
        entries: exportData.entries,
        dom_tree: domTree,
      };

      const DAEMON_PORT = 19925;
      const resp = await fetch(`http://localhost:${DAEMON_PORT}/ai-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captured_data: capturedData, stream: true }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        if (resp.status === 429) {
          // Rate limit — show friendly card
          let msg = errText;
          try {
            const parsed = JSON.parse(errText);
            msg = parsed.error?.message || parsed.detail || errText;
          } catch(e) {}
          const isZh = navigator.language.startsWith('zh');
          genStream.classList.remove('active');
          genStream.style.display = 'none';
          genRateLimit.style.display = 'block';
          genRateLimit.innerHTML = `
            <div class="gen-rl-header"><span class="gen-rl-bar"></span><span class="gen-rl-title">${isZh ? '已达到使用限制' : 'Limit Reached'}</span></div>
            <div class="gen-rl-msg">${esc(msg)}</div>
            <a class="gen-rl-link" href="https://www.autocli.ai" target="_blank">${isZh ? '前往 autocli.ai 了解更多 →' : 'Learn more at autocli.ai →'}</a>
          `;
          return;
        }
        throw new Error(`${resp.status}: ${errText}`);
      }

      // Step 3: Read SSE stream — show last 3 lines only
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              // Show only last 3 lines
              const allLines = fullContent.split('\n');
              genStream.textContent = allLines.slice(-4).join('\n');
            }
          } catch(e) {}
        }
      }

      // Hide stream, show summary
      genStream.classList.remove('active');
      genStream.style.display = 'none';

      if (!fullContent) {
        genError.textContent = 'AI returned empty response';
        genError.style.display = 'block';
        return;
      }

      // Step 4: Parse YAML and show summary
      const yaml = fullContent;
      const getField = (name) => {
        const match = yaml.match(new RegExp('^' + name + ':\\s*(.+)$', 'm'));
        return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
      };
      const site = getField('site') || '?';
      const cmdName = getField('name') || '?';
      const description = getField('description') || '';
      const domain = getField('domain') || '';

      const colMatch = yaml.match(/^columns:\s*\[([^\]]+)\]/m);
      const columns = colMatch ? colMatch[1].trim() : '';

      const tagMatch = yaml.match(/^tags:\s*\[([^\]]+)\]/m);
      const tags = tagMatch ? tagMatch[1].trim() : '';

      const argNames = [];
      const argSection = yaml.match(/^args:\n((?:  .+\n)*)/m);
      if (argSection) {
        const argMatches = argSection[1].matchAll(/^  (\w+):/gm);
        for (const m of argMatches) argNames.push(m[1]);
      }

      const argHints = argNames.filter(a => a !== 'limit').map(a => `<${a}>`).join(' ');
      const cmd = `autocli ${site} ${cmdName}${argHints ? ' ' + argHints : ''}`;

      // Build columns tags
      const colTags = columns ? columns.split(',').map(c => `<span class="sum-col">${esc(c.trim())}</span>`).join('') : '';

      // Build command with colored args
      const cmdHtml = `autocli ${esc(site)} ${esc(cmdName)}` +
        (argNames.filter(a => a !== 'limit').length ?
          argNames.filter(a => a !== 'limit').map(a => ` <span class="arg">&lt;${esc(a)}&gt;</span>`).join('') : '');

      genSummary.style.display = 'block';
      genSummary.innerHTML = `
        <div class="sum-title">${esc(site)}<span class="sep">/</span>${esc(cmdName)}</div>
        ${description ? `<div class="sum-desc">${esc(description)}</div>` : ''}
        ${domain ? `<div class="sum-meta"><span class="sum-tag accent">${esc(domain)}</span></div>` : ''}
        ${colTags ? `
          <div class="sum-section-title">Columns</div>
          <div class="sum-columns">${colTags}</div>
        ` : ''}
        <div class="sum-section-title">Usage</div>
        <div class="sum-cmd" title="Click to copy">
          <span class="sum-cmd-text">${cmdHtml}</span>
          <span class="sum-cmd-copy">copy</span>
        </div>
        <a class="sum-link" href="https://www.autocli.ai" target="_blank">View on autocli.ai →</a>
        <div class="sum-synced"><span class="check">✓</span> ${navigator.language.startsWith('zh') ? '配置已同步保存到本地和云端，可直接使用' : 'Saved locally & synced to cloud. Ready to use.'}</div>
      `;

      genSummary.querySelector('.sum-cmd')?.addEventListener('click', () => copyText(cmd));

      // Mark as done
      generatedDone = true;
      updateGenButton();

    } catch(e) {
      genStream.classList.remove('active');
      genStream.style.display = 'none';
      genError.textContent = e.message;
      genError.style.display = 'block';
    } finally {
      if (!generatedDone) {
        genBtn.disabled = false;
        genBtn.textContent = 'Generate Adapter with AI';
      }
      genBtn.classList.remove('loading');
    }
    })();
  });

  q('s-close').addEventListener('click', () => {
    stopPicking(); clearAllHighlights();
    root.style.display='none'; overlay.style.display='none';
    document.body.style.marginRight = window.__ospOrigMarginRight||'';
    document.body.style.overflowX = window.__ospOrigOverflowX||'';
  });

  console.log('[autocli-selector] Loaded');
})();
