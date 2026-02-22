// ============================================================
// Eagle Eye Tree - Views Module (v3.3)
// List view, Kanban view, Detail panel
// Inline editing for Parts & Fasteners
// ============================================================

import * as state from './state.js';
import { ECN_COLORS, ECN_ICONS } from './config.js';
import { reorderStep, reorderPart, updateSeqTag, updatePart, updateFastener } from './database.js';
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

  if (expandedGroups.size === 0) sortedGroups.forEach(g => expandedGroups.add(g.id));

  let html = '';
  sortedGroups.forEach(g => {
    const gSteps = state.steps.filter(s => s.group_id === g.id)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const open = expandedGroups.has(g.id);
    const ecnCount = gSteps.filter(s => state.ecnChanges[s.id]).length;

    html += '<div class="group-section">';
    html += '<div class="group-hdr" data-gid="' + g.id + '" style="border-bottom:2px solid ' + g.color + ';">';
    html += '<span class="arrow ' + (open ? 'open' : '') + '">▶</span>';
    html += '<span class="glabel" style="color:' + g.color + ';">' + (g.icon || '') + ' ' + g.label + '</span>';
    if (ecnCount > 0) html += '<span class="ecn-cnt">' + ecnCount + '</span>';
    html += '<span class="gcnt">' + gSteps.length + '</span>';
    html += '</div>';

    if (open) {
      gSteps.forEach(function(s, si) {
        var sp = state.parts.filter(function(p) { return p.step_id === s.id; });
        var sf = state.fasts.filter(function(f) { return f.step_id === s.id; });
        var ecn = state.ecnChanges[s.id];
        var sel = state.selectedStepId === s.id;
        var seqDisplay = s.seq_tag || (si + 1);

        var vis = true;
        if (search) {
          vis = s.label.toLowerCase().includes(search) ||
            sp.some(function(p) { return p.pn.toLowerCase().includes(search); }) ||
            sf.some(function(f) { return f.pn.toLowerCase().includes(search); });
        }

        var bgStyle = ecn ? 'background:' + ECN_COLORS[ecn] + '08;border-left-color:' + ECN_COLORS[ecn] + ';' : '';

        html += '<div class="step-row' + (sel ? ' selected' : '') + '" data-sid="' + s.id + '" data-gid="' + g.id + '" style="' + bgStyle + 'opacity:' + (vis ? 1 : 0.2) + ';">';
        html += '<div class="reorder-arrows">';
        html += '<span class="arr-btn ' + (si === 0 ? 'dim' : '') + '" data-dir="up" data-sid="' + s.id + '" data-gid="' + g.id + '">▲</span>';
        html += '<span class="arr-btn ' + (si === gSteps.length - 1 ? 'dim' : '') + '" data-dir="down" data-sid="' + s.id + '" data-gid="' + g.id + '">▼</span>';
        html += '</div>';
        html += '<span class="sid-edit' + (s.seq_tag ? ' has-tag' : '') + '" data-sid="' + s.id + '" data-tag="' + (s.seq_tag || '') + '" title="Click to set tag">' + seqDisplay + '</span>';
        html += '<span class="badge badge-' + s.type + '">' + ({ step: 'STEP', prep: 'PREP', kanryo: '完了', note: 'NOTE' }[s.type] || 'STEP') + '</span>';
        html += '<span class="slabel' + (s.type === 'kanryo' ? ' kanryo' : '') + '">' + s.label + '</span>';
        if (ecn) html += '<span class="ecn-mark" style="color:' + ECN_COLORS[ecn] + ';">' + ECN_ICONS[ecn] + '</span>';
        if (sp.length > 0) html += '<span class="tag tag-p">' + sp.length + 'P</span>';
        if (sf.length > 0) html += '<span class="tag tag-f">' + sf.length + 'F</span>';
        html += '</div>';
      });
    }
    html += '</div>';
  });

  container.innerHTML = html;

  // Event: toggle group
  container.querySelectorAll('.group-hdr').forEach(function(el) {
    el.addEventListener('click', function() {
      var gid = parseInt(el.dataset.gid);
      expandedGroups.has(gid) ? expandedGroups.delete(gid) : expandedGroups.add(gid);
      renderListView();
    });
  });

  // Event: click step row
  container.querySelectorAll('.step-row').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.closest('.reorder-arrows') || e.target.closest('.sid-edit')) return;
      var sid = parseInt(el.dataset.sid);
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
  container.querySelectorAll('.arr-btn').forEach(function(el) {
    el.addEventListener('click', async function(e) {
      e.stopPropagation();
      if (el.classList.contains('dim')) return;
      var sid = parseInt(el.dataset.sid);
      var gid = parseInt(el.dataset.gid);
      var dir = el.dataset.dir;
      var ok = await reorderStep(sid, dir, gid);
      if (ok) {
        await window._eagleEyeReload?.();
        showToast('Moved ' + dir);
      }
    });
  });

  // Event: click seq tag to edit
  container.querySelectorAll('.sid-edit').forEach(function(el) {
    el.addEventListener('click', async function(e) {
      e.stopPropagation();
      var sid = parseInt(el.dataset.sid);
      var current = el.dataset.tag || '';
      var tag = prompt('Sequence tag (e.g. 1a, 2b, 3c):', current);
      if (tag === null) return;
      var ok = await updateSeqTag(sid, tag.trim());
      if (ok) {
        var step = state.steps.find(function(s) { return s.id === sid; });
        if (step) step.seq_tag = tag.trim() || null;
        renderListView();
        showToast(tag.trim() ? 'Tag: ' + tag.trim() : 'Tag cleared');
      }
    });
  });
}

// ============================================================
// KANBAN VIEW
// ============================================================

export function renderKanbanView() {
  var container = document.getElementById('kanbanView');
  if (!container) return;

  var sortedGroups = state.groups.slice().sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

  var html = '';
  sortedGroups.forEach(function(g) {
    var gSteps = state.steps.filter(function(s) { return s.group_id === g.id; })
      .sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

    html += '<div class="kan-col">';
    html += '<div class="kan-hdr" style="background:' + g.color + '15;border-bottom:2px solid ' + g.color + ';">';
    html += '<span style="font-size:11px;font-weight:800;color:' + g.color + ';">' + (g.icon || '') + ' ' + g.label + '</span>';
    html += '<div style="font-size:9px;color:#64748b;margin-top:1px;">' + gSteps.length + ' steps</div>';
    html += '</div><div class="kan-cards">';

    gSteps.forEach(function(s) {
      var sp = state.parts.filter(function(p) { return p.step_id === s.id; });
      var sf = state.fasts.filter(function(f) { return f.step_id === s.id; });
      var ecn = state.ecnChanges[s.id];
      var sel = state.selectedStepId === s.id;
      var seqDisplay = s.seq_tag || '';

      html += '<div class="kan-card' + (sel ? ' selected' : '') + '" data-sid="' + s.id + '" style="' + (ecn ? 'border-color:' + ECN_COLORS[ecn] + ';' : '') + '">';
      html += '<div style="display:flex;gap:4px;align-items:center;">';
      if (seqDisplay) html += '<span style="font-size:9px;font-weight:800;color:#7c3aed;min-width:18px;">' + seqDisplay + '</span>';
      html += '<span style="font-size:11px;font-weight:600;color:' + (s.type === 'kanryo' ? '#f59e0b' : '#e2e8f0') + ';flex:1;">' + s.label + '</span>';
      html += '</div>';
      html += '<div style="display:flex;gap:4px;margin-top:4px;">';
      if (sp.length) html += '<span class="tag tag-p">' + sp.length + 'P</span>';
      if (sf.length) html += '<span class="tag tag-f">' + sf.length + 'F</span>';
      html += '</div></div>';
    });
    html += '</div></div>';
  });

  container.innerHTML = html;

  container.querySelectorAll('.kan-card').forEach(function(el) {
    el.addEventListener('click', function() {
      var sid = parseInt(el.dataset.sid);
      if (state.ecnMode) {
        state.toggleEcnStep(sid); renderKanbanView(); updateEcnSummary();
      } else {
        state.setSelectedStep(state.selectedStepId === sid ? null : sid);
        renderKanbanView(); window._eagleEyeUpdateDetail?.();
      }
    });
  });
}

// ============================================================
// LOCTITE OPTIONS (from Logi Assembly reference)
// ============================================================
var LOCTITE_OPTIONS = [
  { value: '', label: 'None' },
  { value: '222', label: '222 (Purple - Low)' },
  { value: '243', label: '243 (Blue - Medium)' },
  { value: '262', label: '262 (Red - High)' },
  { value: '263', label: '263 (Green - High)' },
  { value: '271', label: '271 (Red - High Strength)' },
  { value: '290', label: '290 (Green - Wicking)' },
  { value: '333', label: '333' },
  { value: '425', label: '425' },
  { value: '648', label: '648' }
];

function loctiteSelect(id, current) {
  var curr = (current || '').replace('---', '');
  var html = '<select class="ef-input" id="' + id + '">';
  LOCTITE_OPTIONS.forEach(function(opt) {
    var sel = (opt.value === curr) ? ' selected' : '';
    html += '<option value="' + opt.value + '"' + sel + '>' + opt.label + '</option>';
  });
  html += '</select>';
  return html;
}

// ============================================================
// DETAIL PANEL — Editable Parts & Fasteners
// ============================================================

export function renderDetail(containerId) {
  var contentEl = document.getElementById(containerId);
  var emptyEl = containerId === 'mainDetailContent'
    ? document.getElementById('mainEmptyDetail')
    : document.getElementById('sidebarEmptyDetail');
  if (!contentEl) return;

  if (!state.selectedStepId) {
    contentEl.style.display = 'none'; contentEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  var step = state.steps.find(function(s) { return s.id === state.selectedStepId; });
  if (!step) { contentEl.style.display = 'none'; if (emptyEl) emptyEl.style.display = ''; return; }

  if (emptyEl) emptyEl.style.display = 'none';
  contentEl.style.display = '';

  var grp = state.groups.find(function(g) { return g.id === step.group_id; });
  var sp = state.parts.filter(function(p) { return p.step_id === step.id; }).sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
  var sf = state.fasts.filter(function(f) { return f.step_id === step.id; }).sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
  var ecn = state.ecnChanges[step.id];

  // ── HEADER ──
  var html = '<div class="detail-hdr">';
  html += '<div style="flex:1;">';
  html += '<div style="font-size:10px;color:' + (grp?.color || '#888') + ';font-weight:600;">↳ ' + (grp?.label || 'Unknown') + '</div>';
  html += '<div style="font-size:15px;font-weight:700;color:' + (step.type === 'kanryo' ? '#f59e0b' : '#e2e8f0') + '">' + step.label + '</div>';
  html += '<div style="display:flex;gap:12px;margin-top:3px;">';
  html += '<span style="font-size:9px;color:#64748b;font-family:monospace;">ID: ' + step.id + '</span>';
  if (step.seq_tag) html += '<span style="font-size:10px;font-weight:800;color:#7c3aed;">🏷 ' + step.seq_tag + '</span>';
  html += '</div></div>';
  if (ecn) html += '<span class="ecn-badge" style="background:' + ECN_COLORS[ecn] + '18;border:1px solid ' + ECN_COLORS[ecn] + ';color:' + ECN_COLORS[ecn] + ';">' + ecn + '</span>';
  html += '</div>';

  // ══════════════════════════════════════════
  // PARTS — Name + P/N display + ✏️ edit
  // ══════════════════════════════════════════
  html += '<div class="section-title" style="color:#10b981;">PARTS (' + sp.length + ')</div>';
  sp.forEach(function(p, i) {
    var m = state.lookup(p.pn);
    var displayName = m.name || p.pn;

    // Display row
    html += '<div class="item-row" style="background:' + (i % 2 ? '#071a12' : 'transparent') + ';">';
    html += '<div class="part-reorder">';
    html += '<span class="arr-sm ' + (i === 0 ? 'dim' : '') + '" data-dir="up" data-pid="' + p.id + '" data-sid="' + step.id + '">▲</span>';
    html += '<span class="arr-sm ' + (i === sp.length - 1 ? 'dim' : '') + '" data-dir="down" data-pid="' + p.id + '" data-sid="' + step.id + '">▼</span>';
    html += '</div>';
    html += '<span class="dot" style="background:#10b981;"></span>';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="font-size:11px;font-weight:600;color:#86efac;">' + displayName + '</div>';
    html += '<div style="font-size:9px;color:#34d399;font-family:monospace;margin-top:1px;">' + p.pn + '</div>';
    if (m.location) html += '<div style="font-size:9px;color:#475569;margin-top:1px;">📍 ' + m.location + '</div>';
    if (!m.name) html += '<div style="font-size:9px;color:#475569;font-style:italic;margin-top:1px;">not in master DB</div>';
    html += '</div>';
    html += '<span class="iqty" style="color:#6ee7b7;">×' + p.qty + '</span>';
    html += '<span class="edit-btn" data-edit="part" data-id="' + p.id + '" title="Edit part">✏️</span>';
    html += '</div>';

    // Edit form (hidden)
    html += '<div class="edit-form" id="edit-part-' + p.id + '" style="display:none;">';
    html += '<div class="ef-row"><label>P/N</label><input type="text" class="ef-input" id="ep-pn-' + p.id + '" value="' + p.pn + '"></div>';
    html += '<div class="ef-row"><label>Qty</label><input type="number" class="ef-input ef-sm" id="ep-qty-' + p.id + '" value="' + p.qty + '" min="1"></div>';
    html += '<div class="ef-actions">';
    html += '<button class="ef-btn ef-cancel" data-close="part-' + p.id + '">Cancel</button>';
    html += '<button class="ef-btn ef-save" data-save="part" data-id="' + p.id + '">Save</button>';
    html += '</div></div>';
  });

  // ══════════════════════════════════════════
  // FASTENERS — P/N, Qty, Loctite, Torque + ✏️ edit
  // ══════════════════════════════════════════
  html += '<div class="section-title" style="color:#ef4444;margin-top:16px;">FASTENERS (' + sf.length + ')</div>';
  sf.forEach(function(f, i) {
    var m = state.lookup(f.pn);

    // Display row
    html += '<div class="item-row" style="background:' + (i % 2 ? '#1a0505' : 'transparent') + ';">';
    html += '<span class="dot" style="background:#ef4444;"></span>';
    html += '<div style="flex:1;min-width:0;">';
    html += '<div style="font-size:11px;font-weight:600;color:#fca5a5;">' + (m.name || f.pn) + '</div>';
    html += '<div style="font-size:9px;color:#f87171;font-family:monospace;margin-top:1px;">' + f.pn + '</div>';
    if (m.location) html += '<div style="font-size:9px;color:#475569;margin-top:1px;">📍 ' + m.location + '</div>';
    html += '</div>';
    html += '<span class="iqty" style="color:#f87171;">×' + f.qty + '</span>';
    html += '<span class="edit-btn" data-edit="fast" data-id="' + f.id + '" title="Edit fastener">✏️</span>';
    html += '</div>';

    // Loctite + Torque info line
    html += '<div style="display:flex;gap:14px;padding-left:11px;font-size:10px;margin-top:1px;margin-bottom:4px;">';
    html += '<span><span style="color:#475569;">LT </span><span style="color:' + (f.loctite === '---' || !f.loctite ? '#475569' : '#f59e0b') + ';font-weight:700;">' + (f.loctite || '—') + '</span></span>';
    html += '<span><span style="color:#475569;">TQ </span><span style="color:' + (!f.torque || f.torque === '---' ? '#475569' : '#60a5fa') + ';font-weight:700;">' + (f.torque || '—') + '</span></span>';
    html += '</div>';

    // Edit form (hidden)
    html += '<div class="edit-form" id="edit-fast-' + f.id + '" style="display:none;">';
    html += '<div class="ef-row"><label>P/N</label><input type="text" class="ef-input" id="ef-pn-' + f.id + '" value="' + f.pn + '" placeholder="e.g. CBE6-30, CSH-M3-5"></div>';
    html += '<div class="ef-row"><label>Qty</label><input type="number" class="ef-input ef-sm" id="ef-qty-' + f.id + '" value="' + f.qty + '" min="1"></div>';
    html += '<div class="ef-row"><label>Loctite</label>' + loctiteSelect('ef-lt-' + f.id, f.loctite) + '</div>';
    html += '<div class="ef-row"><label>Torque</label><input type="text" class="ef-input" id="ef-tq-' + f.id + '" value="' + (f.torque && f.torque !== '---' ? f.torque : '') + '" placeholder="e.g. 25Nm, 3.5Nm"></div>';
    html += '<div class="ef-actions">';
    html += '<button class="ef-btn ef-cancel" data-close="fast-' + f.id + '">Cancel</button>';
    html += '<button class="ef-btn ef-save" data-save="fast" data-id="' + f.id + '">Save</button>';
    html += '</div></div>';
  });

  // ── LINKS ──
  var inLinks = state.stepLinks.filter(function(l) { return l.child_step_id === step.id; });
  var outLinks = state.stepLinks.filter(function(l) { return l.parent_step_id === step.id; });
  if (inLinks.length || outLinks.length) {
    html += '<div class="section-title" style="color:#60a5fa;margin-top:16px;">LINKS (' + inLinks.length + ' in · ' + outLinks.length + ' out)</div>';
    inLinks.forEach(function(l) {
      var parent = state.steps.find(function(s) { return s.id === l.parent_step_id; });
      html += '<div class="item-row"><span class="dot" style="background:#60a5fa;"></span><span style="font-size:10px;color:#93c5fd;">← ' + (parent?.label || l.parent_step_id) + '</span></div>';
    });
    outLinks.forEach(function(l) {
      var child = state.steps.find(function(s) { return s.id === l.child_step_id; });
      html += '<div class="item-row"><span class="dot" style="background:#a78bfa;"></span><span style="font-size:10px;color:#c4b5fd;">→ ' + (child?.label || l.child_step_id) + '</span></div>';
    });
  }

  contentEl.innerHTML = html;

  // ══════════════════════════════════════════
  // WIRE ALL EVENT HANDLERS
  // ══════════════════════════════════════════

  // Part reorder arrows ▲▼
  contentEl.querySelectorAll('.arr-sm').forEach(function(el) {
    el.addEventListener('click', async function(e) {
      e.stopPropagation();
      if (el.classList.contains('dim')) return;
      var pid = parseInt(el.dataset.pid);
      var sid = parseInt(el.dataset.sid);
      var dir = el.dataset.dir;
      var ok = await reorderPart(pid, dir, sid);
      if (ok) { await window._eagleEyeReload?.(); showToast('Part moved ' + dir); }
    });
  });

  // ✏️ Edit toggle buttons
  contentEl.querySelectorAll('.edit-btn').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      var type = el.dataset.edit; // 'part' or 'fast'
      var id = el.dataset.id;
      var form = document.getElementById('edit-' + type + '-' + id);
      if (form) {
        // Close all other open forms first
        contentEl.querySelectorAll('.edit-form').forEach(function(f) { f.style.display = 'none'; });
        form.style.display = '';
        // Focus first input
        var firstInput = form.querySelector('input[type="text"]');
        if (firstInput) firstInput.focus();
      }
    });
  });

  // Cancel buttons
  contentEl.querySelectorAll('.ef-cancel').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      var key = el.dataset.close; // e.g. 'part-123' or 'fast-456'
      var form = document.getElementById('edit-' + key);
      if (form) form.style.display = 'none';
    });
  });

  // Save buttons
  contentEl.querySelectorAll('.ef-save').forEach(function(el) {
    el.addEventListener('click', async function(e) {
      e.stopPropagation();
      var type = el.dataset.save; // 'part' or 'fast'
      var id = parseInt(el.dataset.id);

      if (type === 'part') {
        await savePartEdit(id);
      } else if (type === 'fast') {
        await saveFastenerEdit(id);
      }
    });
  });
}

// ============================================================
// SAVE PART EDIT → Supabase
// ============================================================

async function savePartEdit(partId) {
  var pnEl = document.getElementById('ep-pn-' + partId);
  var qtyEl = document.getElementById('ep-qty-' + partId);
  if (!pnEl || !qtyEl) return;

  var pn = pnEl.value.trim();
  var qty = parseInt(qtyEl.value) || 1;

  if (!pn) { showToast('P/N is required', 'error'); return; }

  var ok = await updatePart(partId, { pn: pn, qty: qty });
  if (ok) {
    // Update local state
    var part = state.parts.find(function(p) { return p.id === partId; });
    if (part) { part.pn = pn; part.qty = qty; }
    showToast('Part updated');
    renderDetail(document.getElementById('mainDetailContent') ? 'mainDetailContent' : 'sidebarDetailContent');
  } else {
    showToast('Failed to update part', 'error');
  }
}

// ============================================================
// SAVE FASTENER EDIT → Supabase
// ============================================================

async function saveFastenerEdit(fastId) {
  var pnEl = document.getElementById('ef-pn-' + fastId);
  var qtyEl = document.getElementById('ef-qty-' + fastId);
  var ltEl = document.getElementById('ef-lt-' + fastId);
  var tqEl = document.getElementById('ef-tq-' + fastId);
  if (!pnEl || !qtyEl) return;

  var pn = pnEl.value.trim();
  var qty = parseInt(qtyEl.value) || 1;
  var loctite = ltEl ? ltEl.value : null;
  var torque = tqEl ? tqEl.value.trim() : null;

  if (!pn) { showToast('P/N is required', 'error'); return; }

  var updates = {
    pn: pn,
    qty: qty,
    loctite: loctite || null,
    torque: torque || null
  };

  var ok = await updateFastener(fastId, updates);
  if (ok) {
    // Update local state
    var fast = state.fasts.find(function(f) { return f.id === fastId; });
    if (fast) {
      fast.pn = pn;
      fast.qty = qty;
      fast.loctite = loctite || null;
      fast.torque = torque || null;
    }
    showToast('Fastener updated');
    renderDetail(document.getElementById('mainDetailContent') ? 'mainDetailContent' : 'sidebarDetailContent');
  } else {
    showToast('Failed to update fastener', 'error');
  }
}

// ============================================================
// ECN SUMMARY
// ============================================================

export function updateEcnSummary() {
  var el = document.getElementById('ecnSummary');
  var count = Object.keys(state.ecnChanges).length;
  if (count > 0) { el.style.display = ''; el.textContent = '⚡ ' + count + ' steps affected'; }
  else { el.style.display = 'none'; }
}
