// ============================================================
// Eagle Eye Tree - UI Module
// ============================================================

import * as state from './state.js';
import { ECN_COLORS, ECN_ICONS } from './config.js';

// ============================================================
// TOAST
// ============================================================

export function showToast(msg, type = 'ok') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'toast';
  el.style.background = type === 'error' ? '#ef4444' : '#10b981';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

// ============================================================
// SIDE PANEL - Step Detail
// ============================================================

export function updateSidePanel() {
  const panel = document.getElementById('sidePanel');
  const content = document.getElementById('sidePanelContent');

  if (!state.selectedStepId) {
    panel.classList.remove('open');
    return;
  }

  const step = state.steps.find(s => s.id === state.selectedStepId);
  if (!step) { panel.classList.remove('open'); return; }

  const grp = state.groups.find(g => g.id === step.group_id);
  const sp = state.parts.filter(p => p.step_id === step.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const sf = state.fasts.filter(f => f.step_id === step.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const ecn = state.ecnChanges[step.id];

  let html = `
    <div class="panel-header">
      <div>
        <div style="font-size:10px;color:${grp?.color || '#888'};">↳ ${grp?.label || 'Unknown'}</div>
        <div style="font-size:15px;font-weight:700;color:${step.type === 'kanryo' ? '#f59e0b' : '#e2e8f0'}">${step.label}</div>
        <div style="font-size:9px;color:#64748b;font-family:monospace;margin-top:2px;">ID: ${step.id}</div>
      </div>
      ${ecn ? `<span style="padding:3px 10px;border-radius:5px;background:${ECN_COLORS[ecn]}18;border:1px solid ${ECN_COLORS[ecn]};color:${ECN_COLORS[ecn]};font-size:10px;font-weight:800;text-transform:uppercase;">${ecn}</span>` : ''}
      <button onclick="closeSidePanel()" style="background:none;border:none;color:#64748b;font-size:16px;cursor:pointer;">✕</button>
    </div>
  `;

  // Parts
  html += `<div class="section-title" style="color:#10b981;">PARTS (${sp.length})</div>`;
  sp.forEach((p, i) => {
    const m = state.lookup(p.pn);
    html += `
      <div class="item-row" style="background:${i % 2 ? '#071a12' : 'transparent'};">
        <span class="dot" style="background:#10b981;"></span>
        <span class="mono" style="color:#34d399;">${p.pn}</span>
        <span class="iqty" style="color:#6ee7b7;">×${p.qty}</span>
      </div>
      <div style="padding-left:11px;display:flex;gap:12px;font-size:10px;margin-top:1px;">
        ${m.name ? `<span style="color:#86efac;">${m.name}</span>` : ''}
        ${m.location ? `<span style="color:#475569;">📍 ${m.location}</span>` : ''}
        ${!m.name ? `<span style="color:#475569;font-style:italic;">not in master DB</span>` : ''}
      </div>
    `;
  });

  // Fasteners
  html += `<div class="section-title" style="color:#ef4444;margin-top:16px;">FASTENERS (${sf.length})</div>`;
  sf.forEach((f, i) => {
    const m = state.lookup(f.pn);
    html += `
      <div class="item-row" style="background:${i % 2 ? '#1a0505' : 'transparent'};">
        <span class="dot" style="background:#ef4444;"></span>
        <span class="mono" style="color:#fca5a5;">${f.pn}</span>
        <span class="iqty" style="color:#f87171;">×${f.qty}</span>
      </div>
      <div style="padding-left:11px;display:flex;gap:12px;font-size:10px;margin-top:1px;">
        ${m.name ? `<span style="color:#fecaca;">${m.name}</span>` : ''}
        ${m.location ? `<span style="color:#475569;">📍 ${m.location}</span>` : ''}
      </div>
      <div style="display:flex;gap:14px;padding-left:11px;font-size:10px;margin-top:1px;">
        <span><span style="color:#475569;">LT </span><span style="color:${f.loctite === '---' ? '#475569' : '#f59e0b'};font-weight:700;">${f.loctite || '—'}</span></span>
        <span><span style="color:#475569;">TQ </span><span style="color:${!f.torque || f.torque === '---' ? '#475569' : '#60a5fa'};font-weight:700;">${f.torque || '—'}</span></span>
      </div>
    `;
  });

  // Links
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

  content.innerHTML = html;
  panel.classList.add('open');
}

export function closeSidePanel() {
  document.getElementById('sidePanel').classList.remove('open');
  state.setSelectedStep(null);
}

// Make closeSidePanel available globally for onclick
window.closeSidePanel = closeSidePanel;
