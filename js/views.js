// ============================================================
// Eagle Eye Tree - Views Module (v3.2)
// List view with ▲▼ reorder arrows
// Kanban view
// Detail panel with part ▲▼ reorder arrows
// ============================================================

import * as state from './state.js';
import { ECN_COLORS, ECN_ICONS } from './config.js';
import { reorderStep, reorderPart, updateSeqTag } from './database.js';
import { showToast } from './ui.js';

const expandedGroups = new Set();

// ============================================================
// LIST VIEW — with ▲▼ reorder arrows per step
// ============================================================

export function renderListView() {
  const container = document.getElementById('listView');
  if (!container) return;

  const sortedGroups = state.groups.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const search = (document.getElementById('searchInput')?.value || '').toLowerCase();

  // Auto-expand all on first load
  if (expandedGroups.size === 0) sortedGroups.forEach(g => expandedGroups.add(g.id));

  let html = '';
  sortedGroups.forEach(g => {
    const gSteps = state.steps.filter(s => s.group_id === g.id)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const open = expandedGroups.has(g.id);
    const ecnCount = gSteps.filter(s => state.ecnChanges[s.id]).length;

    html += `<div class="group-section">
      <div class="group-hdr" data-gid="${g.id}" style="border-bottom:2px solid ${g.color};">
        <span class="arrow ${open ? 'open' : ''}">▶</span>
        <span class="glabel" style="color:${g.color};">${g.icon || ''} ${g.label}</span>
        ${ecnCount > 0 ? `<span class="ecn-cnt">${ecnCount}</span>` : ''}
        <span class="gcnt">${gSteps.length}</span>
      </div>`;

    if (open) {
      gSteps.forEach((s, si) => {
        const sp = state.parts.filter(p => p.step_id === s.id);
        const sf = state.fasts.filter(f => f.step_id === s.id);
        const ecn = state.ecnChanges[s.id];
        const sel = state.selectedStepId === s.id;
        const seqDisplay = s.seq_tag || (si + 1);

        let vis = true;
        if (search) {
          vis = s.label.toLowerCase().includes(search) ||
            sp.some(p => p.pn.toLowerCase().includes(search)) ||
            sf.some(f => f.pn.toLowerCase().includes(search));
        }

        const bgStyle = ecn ? `background:${ECN_COLORS[ecn]}08;border-left-color:${ECN_COLORS[ecn]};` : '';

        html += `<div class="step-row${sel ? ' selected' : ''}" data-sid="${s.id}" data-gid="${g.id}" style="${bgStyle}opacity:${vis ? 1 : 0.2};">
          <div class="reorder-arrows">
            <span class="arr-btn ${si === 0 ? 'dim' : ''}" data-dir="up" data-sid="${s.id}" data-gid="${g.id}" title="Move up">▲</span>
            <span class="arr-btn ${si === gSteps.length - 1 ? 'dim' : ''}" data-dir="down" data-sid="${s.id}" data-gid="${g.id}" title="Move down">▼</span>
          </div>
          <span class="sid-edit${s.seq_tag ? ' has-tag' : ''}" data-sid="${s.id}" data-tag="${s.seq_tag || ''}" title="Click to set tag (e.g. 1a, 2b)">${seqDisplay}</span>
          <span class="badge badge-${s.type}">${({ step: 'STEP', prep: 'PREP', kanryo: '完了', note: 'NOTE' })[s.type] || 'STEP'}</span>
          <span class="slabel${s.type === 'kanryo' ? ' kanryo' : ''}">${s.label}</span>
          ${ecn ? `<span class="ecn-mark" style="color:${ECN_COLORS[ecn]};">${ECN_ICONS[ecn]}</span>` : ''}
          ${sp.length > 0 ? `<span class="tag tag-p">${sp.length}P</span>` : ''}
          ${sf.length > 0 ? `<span class="tag tag-f">${sf.length}F</span>` : ''}
        </div>`;
      });
    }
    html += `</div>`;
  });

  container.innerHTML = html;

  // Event: toggle group
  container.querySelectorAll('.group-hdr').forEach(el => {
    el.addEventListener('click', () => {
      const gid = parseInt(el.dataset.gid);
      expandedGroups.has(gid) ? expandedGroups.delete(gid) : expandedGroups.add(gid);
      renderListView();
    });
  });

  // Event: click step row
  container.querySelectorAll('.step-row').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.reorder-arrows')) return;
      const sid = parseInt(el.dataset.sid);
      if (state.ecnMode) {
        state.toggleEcnStep(sid);
        renderListView();
        updateEcnSummary();
      } else {
        state.setSelectedStep(state.selectedStepId === sid ? null : sid);
        renderListView();
        window._eagleEyeUpdateDetail?.();
      }
    });
  });

  // Event: reorder arrows ▲▼
  container.querySelectorAll('.arr-btn').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (el.classList.contains('dim')) return;
      const sid = parseInt(el.dataset.sid);
      const gid = parseInt(el.dataset.gid);
      const dir = el.dataset.dir;
      const ok = await reorderStep(sid, dir, gid);
      if (ok) {
        await window._eagleEyeReload?.();
        showToast(`Moved ${dir}`);
      }
    });
  });

  // Event: click seq tag to edit
  container.querySelectorAll('.sid-edit').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sid = parseInt(el.dataset.sid);
      const current = el.dataset.tag || '';
      const tag = prompt('Sequence tag (e.g. 1a, 2b, 3c):', current);
      if (tag === null) return;
      const ok = await updateSeqTag(sid, tag.trim());
      if (ok) {
        const step = state.steps.find(s => s.id === sid);
        if (step) step.seq_tag = tag.trim() || null;
        renderListView();
        showToast(tag.trim() ? `Tag: ${tag.trim()}` : 'Tag cleared');
      }
    });
  });
}

// ============================================================
// KANBAN VIEW
// ============================================================

export function renderKanbanView() {
  const container = document.getElementById('kanbanView');
  if (!container) return;

  const sortedGroups = state.groups.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  let html = '';
  sortedGroups.forEach(g => {
    const gSteps = state.steps.filter(s => s.group_id === g.id)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    html += `<div class="kan-col">
      <div class="kan-hdr" style="background:${g.color}15;border-bottom:2px solid ${g.color};">
        <span style="font-size:11px;font-weight:800;color:${g.color};">${g.icon || ''} ${g.label}</span>
        <div style="font-size:9px;color:#64748b;margin-top:1px;">${gSteps.length} steps</div>
      </div>
      <div class="kan-cards">`;
    gSteps.forEach(s => {
      const sp = state.parts.filter(p => p.step_id === s.id);
      const sf = state.fasts.filter(f => f.step_id === s.id);
      const ecn = state.ecnChanges[s.id];
      const sel = state.selectedStepId === s.id;
      const seqDisplay = s.seq_tag || '';

      html += `<div class="kan-card${sel ? ' selected' : ''}" data-sid="${s.id}" style="${ecn ? `border-color:${ECN_COLORS[ecn]};` : ''}">
        <div style="display:flex;gap:4px;align-items:center;">
          ${seqDisplay ? `<span style="font-size:9px;font-weight:800;color:#7c3aed;min-width:18px;">${seqDisplay}</span>` : ''}
          <span style="font-size:11px;font-weight:600;color:${s.type === 'kanryo' ? '#f59e0b' : '#e2e8f0'};flex:1;">${s.label}</span>
        </div>
        <div style="display:flex;gap:4px;margin-top:4px;">
          ${sp.length ? `<span class="tag tag-p">${sp.length}P</span>` : ''}
          ${sf.length ? `<span class="tag tag-f">${sf.length}F</span>` : ''}
        </div>
      </div>`;
    });
    html += `</div></div>`;
  });

  container.innerHTML = html;

  container.querySelectorAll('.kan-card').forEach(el => {
    el.addEventListener('click', () => {
      const sid = parseInt(el.dataset.sid);
      if (state.ecnMode) {
        state.toggleEcnStep(sid);
        renderKanbanView();
        updateEcnSummary();
      } else {
        state.setSelectedStep(state.selectedStepId === sid ? null : sid);
        renderKanbanView();
        window._eagleEyeUpdateDetail?.();
      }
    });
  });
}

// ============================================================
// DETAIL PANEL — with part ▲▼ reorder arrows
// ============================================================

export function renderDetail(containerId) {
  const contentEl = document.getElementById(containerId);
  const emptyEl = containerId === 'mainDetailContent'
    ? document.getElementById('mainEmptyDetail')
    : document.getElementById('sidebarEmptyDetail');
  if (!contentEl) return;

  if (!state.selectedStepId) {
    contentEl.style.display = 'none'; contentEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  const step = state.steps.find(s => s.id === state.selectedStepId);
  if (!step) { contentEl.style.display = 'none'; if (emptyEl) emptyEl.style.display = ''; return; }

  if (emptyEl) emptyEl.style.display = 'none';
  contentEl.style.display = '';

  const grp = state.groups.find(g => g.id === step.group_id);
  const sp = state.parts.filter(p => p.step_id === step.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const sf = state.fasts.filter(f => f.step_id === step.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const ecn = state.ecnChanges[step.id];

  let html = `<div class="detail-hdr">
    <div style="flex:1;">
      <div style="font-size:10px;color:${grp?.color || '#888'};font-weight:600;">↳ ${grp?.label || 'Unknown'}</div>
      <div style="font-size:15px;font-weight:700;color:${step.type === 'kanryo' ? '#f59e0b' : '#e2e8f0'}">${step.label}</div>
      <div style="display:flex;gap:12px;margin-top:3px;">
        <span style="font-size:9px;color:#64748b;font-family:monospace;">ID: ${step.id}</span>
        ${step.seq_tag ? `<span style="font-size:10px;font-weight:800;color:#7c3aed;">🏷 ${step.seq_tag}</span>` : ''}
      </div>
    </div>
    ${ecn ? `<span class="ecn-badge" style="background:${ECN_COLORS[ecn]}18;border:1px solid ${ECN_COLORS[ecn]};color:${ECN_COLORS[ecn]};">${ecn}</span>` : ''}
  </div>`;

  // ── PARTS with ▲▼ reorder arrows ──
  html += `<div class="section-title" style="color:#10b981;">PARTS (${sp.length})</div>`;
  sp.forEach((p, i) => {
    const m = state.lookup(p.pn);
    html += `<div class="item-row" style="background:${i % 2 ? '#071a12' : 'transparent'};">
      <div class="part-reorder">
        <span class="arr-sm ${i === 0 ? 'dim' : ''}" data-dir="up" data-pid="${p.id}" data-sid="${step.id}" title="Move up">▲</span>
        <span class="arr-sm ${i === sp.length - 1 ? 'dim' : ''}" data-dir="down" data-pid="${p.id}" data-sid="${step.id}" title="Move down">▼</span>
      </div>
      <span class="dot" style="background:#10b981;"></span>
      <span class="mono" style="color:#34d399;">${p.pn}</span>
      <span class="iqty" style="color:#6ee7b7;">×${p.qty}</span>
    </div>
    <div style="padding-left:36px;display:flex;gap:10px;font-size:10px;margin-top:1px;">
      ${m.name ? `<span style="color:#86efac;">${m.name}</span>` : ''}
      ${m.location ? `<span style="color:#475569;">📍 ${m.location}</span>` : ''}
      ${!m.name ? `<span style="color:#475569;font-style:italic;">not in master DB</span>` : ''}
    </div>`;
  });

  // ── FASTENERS ──
  html += `<div class="section-title" style="color:#ef4444;margin-top:16px;">FASTENERS (${sf.length})</div>`;
  sf.forEach((f, i) => {
    const m = state.lookup(f.pn);
    html += `<div class="item-row" style="background:${i % 2 ? '#1a0505' : 'transparent'};">
      <span class="dot" style="background:#ef4444;"></span>
      <span class="mono" style="color:#fca5a5;">${f.pn}</span>
      <span class="iqty" style="color:#f87171;">×${f.qty}</span>
    </div>
    <div style="padding-left:11px;display:flex;gap:10px;font-size:10px;margin-top:1px;">
      ${m.name ? `<span style="color:#fecaca;">${m.name}</span>` : ''}
      ${m.location ? `<span style="color:#475569;">📍 ${m.location}</span>` : ''}
    </div>
    <div style="display:flex;gap:14px;padding-left:11px;font-size:10px;margin-top:1px;">
      <span><span style="color:#475569;">LT </span><span style="color:${f.loctite === '---' ? '#475569' : '#f59e0b'};font-weight:700;">${f.loctite || '—'}</span></span>
      <span><span style="color:#475569;">TQ </span><span style="color:${!f.torque || f.torque === '---' ? '#475569' : '#60a5fa'};font-weight:700;">${f.torque || '—'}</span></span>
    </div>`;
  });

  // ── LINKS ──
  const inLinks = state.stepLinks.filter(l => l.child_step_id === step.id);
  const outLinks = state.stepLinks.filter(l => l.parent_step_id === step.id);
  if (inLinks.length || outLinks.length) {
    html += `<div class="section-title" style="color:#60a5fa;margin-top:16px;">LINKS (${inLinks.length} in · ${outLinks.length} out)</div>`;
    inLinks.forEach(l => {
      const parent = state.steps.find(s => s.id === l.parent_step_id);
      html += `<div class="item-row"><span class="dot" style="background:#60a5fa;"></span><span style="font-size:10px;color:#93c5fd;">← ${parent?.label || l.parent_step_id}</span></div>`;
    });
    outLinks.forEach(l => {
      const child = state.steps.find(s => s.id === l.child_step_id);
      html += `<div class="item-row"><span class="dot" style="background:#a78bfa;"></span><span style="font-size:10px;color:#c4b5fd;">→ ${child?.label || l.child_step_id}</span></div>`;
    });
  }

  contentEl.innerHTML = html;

  // Wire part reorder arrows ▲▼
  contentEl.querySelectorAll('.arr-sm').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (el.classList.contains('dim')) return;
      const pid = parseInt(el.dataset.pid);
      const sid = parseInt(el.dataset.sid);
      const dir = el.dataset.dir;
      const ok = await reorderPart(pid, dir, sid);
      if (ok) {
        await window._eagleEyeReload?.();
        showToast(`Part moved ${dir}`);
      }
    });
  });
}

// ============================================================
// ECN SUMMARY
// ============================================================

export function updateEcnSummary() {
  const el = document.getElementById('ecnSummary');
  const count = Object.keys(state.ecnChanges).length;
  if (count > 0) { el.style.display = ''; el.textContent = `⚡ ${count} steps affected`; }
  else { el.style.display = 'none'; }
}
