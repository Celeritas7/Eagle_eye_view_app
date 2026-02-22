// ============================================================
// Eagle Eye Tree - Main Application (v3.2)
// ============================================================

import * as state from './state.js';
import { loadAssemblyData, autoGenerateLinks, bulkCreateStepLinks, ensureSeqTagColumn, updateStepEcnStatus, clearAllEcnStatus } from './database.js';
import { renderGraph, zoomIn, zoomOut, fitToScreen, handleSave, hideContextMenu } from './graph.js';
import { showToast } from './ui.js';
import { renderListView, renderKanbanView, renderDetail, updateEcnSummary } from './views.js';

const APP_VERSION = 'v3.5';
let currentView = 'list';

// ============================================================
// RELOAD (after reorder etc.)
// ============================================================

async function reload() {
  const tag = state.assy?.tag || 'HBD_assy';
  const data = await loadAssemblyData(tag);
  state.setData(data);
  updateStats();
  buildGroupFilterChips();
  updateFilterChipStates();
  switchView(currentView);
}
window._eagleEyeReload = reload;

// ============================================================
// VIEW SWITCHING
// ============================================================

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));

  const sidebar = document.getElementById('sidebar');
  sidebar.style.width = view === 'list' ? '420px' : '320px';

  document.getElementById('listView').style.display = view === 'list' ? '' : 'none';
  document.getElementById('sidebarDetail').style.display = view !== 'list' ? '' : 'none';
  document.getElementById('mainDetail').style.display = view === 'list' ? '' : 'none';
  document.getElementById('graphToolbar').style.display = view === 'graph' ? '' : 'none';
  document.getElementById('groupFilterBar').style.display = view === 'graph' ? 'flex' : 'none';
  document.getElementById('treeContainer').style.display = view === 'graph' ? '' : 'none';
  document.getElementById('kanbanView').style.display = view === 'kanban' ? '' : 'none';

  if (view === 'list') { renderListView(); updateDetailPanel(); }
  else if (view === 'graph') { renderGraph(); updateDetailPanel(); }
  else if (view === 'kanban') { renderKanbanView(); updateDetailPanel(); }
}

function updateDetailPanel() {
  if (currentView === 'list') renderDetail('mainDetailContent');
  else renderDetail('sidebarDetailContent');
}
window._eagleEyeUpdateDetail = updateDetailPanel;
window._eagleEyeRefreshView = function() {
  if (currentView === 'list') renderListView();
  else if (currentView === 'graph') renderGraph();
  else if (currentView === 'kanban') renderKanbanView();
};

// ============================================================
// GROUP FILTER CHIPS
// ============================================================

function buildGroupFilterChips() {
  const container = document.getElementById('filterChips');
  if (!container) return;
  container.innerHTML = '';

  const sortedGroups = state.groups.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  sortedGroups.forEach(g => {
    const chip = document.createElement('button');
    chip.className = 'filter-chip active';
    chip.dataset.gid = g.id;
    chip.innerHTML = `<span class="chip-dot" style="background:${g.color}"></span>${g.icon || ''} ${g.label}`;
    chip.addEventListener('click', () => toggleGroupFilter(g.id));
    container.appendChild(chip);
  });
}

function toggleGroupFilter(gid) {
  // If currently showing all, switch to showing only this one
  if (!state.visibleGroupIds) {
    state.setVisibleGroupIds(new Set([gid]));
  } else if (state.visibleGroupIds.has(gid)) {
    // Remove this group
    const next = new Set(state.visibleGroupIds);
    next.delete(gid);
    state.setVisibleGroupIds(next.size === 0 ? null : next);  // if none selected, show all
  } else {
    // Add this group
    const next = new Set(state.visibleGroupIds);
    next.add(gid);
    // If all groups selected, reset to null (all)
    if (next.size === state.groups.length) state.setVisibleGroupIds(null);
    else state.setVisibleGroupIds(next);
  }
  updateFilterChipStates();
  if (currentView === 'graph') { renderGraph(); fitToScreen(false); }
}

function updateFilterChipStates() {
  const allBtn = document.getElementById('filterAll');
  const ecnBtn = document.getElementById('filterEcnOnly');
  const isAll = !state.visibleGroupIds;

  if (allBtn) allBtn.classList.toggle('active', isAll);
  if (ecnBtn) ecnBtn.classList.toggle('active', false);  // reset

  document.querySelectorAll('#filterChips .filter-chip').forEach(chip => {
    const gid = parseInt(chip.dataset.gid);
    chip.classList.toggle('active', isAll || (state.visibleGroupIds && state.visibleGroupIds.has(gid)));
  });

  // Check if ECN filter is active
  if (!isAll && state.visibleGroupIds) {
    const ecnGroupIds = new Set();
    Object.keys(state.ecnChanges).forEach(stepId => {
      const step = state.steps.find(s => s.id === parseInt(stepId));
      if (step) ecnGroupIds.add(step.group_id);
    });
    if (ecnGroupIds.size > 0 && state.visibleGroupIds.size === ecnGroupIds.size) {
      let match = true;
      ecnGroupIds.forEach(id => { if (!state.visibleGroupIds.has(id)) match = false; });
      if (ecnBtn && match) ecnBtn.classList.add('active');
    }
  }
}

// ============================================================
// INIT
// ============================================================

async function init() {
  console.log(`Eagle Eye Tree ${APP_VERSION} initializing...`);
  setStatus('Loading…');
  try {
    // Auto-check seq_tag column
    try { await ensureSeqTagColumn(); } catch (e) { console.warn('seq_tag check:', e.message); }

    const data = await loadAssemblyData('HBD_assy');
    state.setData(data);
    document.getElementById('assyTag').textContent = data.assy.tag;
    updateStats();

    if (data.stepLinks.length === 0 && data.steps.length > 0) {
      setStatus('Auto-generating links…');
      const autoLinks = autoGenerateLinks(data.assy.id, data.groups, data.steps, []);
      if (autoLinks.length > 0) {
        await bulkCreateStepLinks(autoLinks);
        const fresh = await loadAssemblyData('HBD_assy');
        state.setData(fresh);
        updateStats();
        showToast(`Auto-generated ${autoLinks.length} links`);
      }
    }

    setStatus(`Connected ${APP_VERSION}`);
    document.getElementById('statusDot').style.background = '#10b981';
    buildGroupFilterChips();
    switchView('list');
    console.log(`Eagle Eye Tree ${APP_VERSION} ready — ${state.steps.length} steps`);
  } catch (e) {
    console.error(e);
    setStatus('Error: ' + e.message);
    document.getElementById('statusDot').style.background = '#ef4444';
    showToast(e.message, 'error');
  }
}

function setStatus(msg) { const el = document.getElementById('statusText'); if (el) el.textContent = msg; }

function updateStats() {
  document.getElementById('statsText').textContent =
    `${state.steps.length} steps · ${state.stepLinks.length} links · ${Object.keys(state.masterMap).length} master`;
}

// ============================================================
// EVENTS
// ============================================================

function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchView(t.dataset.view));
  });

  // Search
  document.getElementById('searchInput')?.addEventListener('input', () => {
    if (currentView === 'list') renderListView();
  });

  // Graph toolbar
  document.getElementById('zoomInBtn')?.addEventListener('click', zoomIn);
  document.getElementById('zoomOutBtn')?.addEventListener('click', zoomOut);
  document.getElementById('fitBtn')?.addEventListener('click', () => fitToScreen(false));
  document.getElementById('fitBtn2')?.addEventListener('click', () => fitToScreen(false));
  document.getElementById('saveBtn')?.addEventListener('click', handleSave);

  // Toggles
  document.getElementById('seqToggle')?.addEventListener('click', () => {
    state.setShowSequenceNumbers(!state.showSequenceNumbers);
    document.getElementById('seqToggle').classList.toggle('active', state.showSequenceNumbers);
    if (currentView === 'graph') renderGraph();
  });

  document.getElementById('partsToggle')?.addEventListener('click', () => {
    state.setShowPartNodes(!state.showPartNodes);
    document.getElementById('partsToggle').classList.toggle('active', state.showPartNodes);
    if (currentView === 'graph') renderGraph();
  });

  document.getElementById('headersToggle')?.addEventListener('click', () => {
    state.setShowLevelHeaders(!state.showLevelHeaders);
    document.getElementById('headersToggle').classList.toggle('active', state.showLevelHeaders);
    if (currentView === 'graph') renderGraph();
  });

  document.getElementById('fastToggle')?.addEventListener('click', () => {
    state.setShowFastenerLabels(!state.showFastenerLabels);
    document.getElementById('fastToggle').classList.toggle('active', state.showFastenerLabels);
    if (currentView === 'graph') renderGraph();
  });

  // Spacing panel toggle
  document.getElementById('spacingBtn')?.addEventListener('click', () => {
    const panel = document.getElementById('spacingPanel');
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
  });
  document.getElementById('spacingClose')?.addEventListener('click', () => {
    document.getElementById('spacingPanel').style.display = 'none';
  });

  // Gap 1: Steps ↔ Groups
  const syncGap1 = (val) => {
    val = Math.max(120, Math.min(500, parseInt(val) || 300));
    state.setGap1(val);
    document.getElementById('gap1Slider').value = val;
    document.getElementById('gap1Input').value = val;
    if (currentView === 'graph') renderGraph();
  };
  document.getElementById('gap1Slider')?.addEventListener('input', e => syncGap1(e.target.value));
  document.getElementById('gap1Input')?.addEventListener('change', e => syncGap1(e.target.value));

  // Gap 2: Groups ↔ Root
  const syncGap2 = (val) => {
    val = Math.max(100, Math.min(400, parseInt(val) || 240));
    state.setGap2(val);
    document.getElementById('gap2Slider').value = val;
    document.getElementById('gap2Input').value = val;
    if (currentView === 'graph') renderGraph();
  };
  document.getElementById('gap2Slider')?.addEventListener('input', e => syncGap2(e.target.value));
  document.getElementById('gap2Input')?.addEventListener('change', e => syncGap2(e.target.value));

  // Reset / Equal buttons
  document.getElementById('spacingReset')?.addEventListener('click', () => { syncGap1(300); syncGap2(240); });
  document.getElementById('spacingEqual')?.addEventListener('click', () => {
    const avg = Math.round((state.gap1 + state.gap2) / 2);
    syncGap1(avg); syncGap2(avg);
  });

  // Group filter: All button
  document.getElementById('filterAll')?.addEventListener('click', () => {
    state.setVisibleGroupIds(null);
    updateFilterChipStates();
    if (currentView === 'graph') { renderGraph(); fitToScreen(false); }
  });

  // Group filter: ECN only
  document.getElementById('filterEcnOnly')?.addEventListener('click', () => {
    const ecnGroupIds = new Set();
    Object.keys(state.ecnChanges).forEach(stepId => {
      const step = state.steps.find(s => s.id === parseInt(stepId));
      if (step) ecnGroupIds.add(step.group_id);
    });
    if (ecnGroupIds.size === 0) {
      showToast('No ECN changes to filter by', 'error');
      return;
    }
    state.setVisibleGroupIds(ecnGroupIds);
    updateFilterChipStates();
    if (currentView === 'graph') { renderGraph(); fitToScreen(false); }
  });

  // ECN
  document.getElementById('ecnToggle')?.addEventListener('click', () => {
    state.setEcnMode(!state.ecnMode);
    const btn = document.getElementById('ecnToggle');
    const brushes = document.getElementById('ecnBrushes');
    btn.classList.toggle('ecn-active', state.ecnMode);
    btn.textContent = state.ecnMode ? '⚡ ECN' : 'ECN';
    brushes.style.display = state.ecnMode ? 'flex' : 'none';
    if (currentView === 'list') renderListView();
    else if (currentView === 'graph') renderGraph();
    else if (currentView === 'kanban') renderKanbanView();
  });

  document.querySelectorAll('.ecn-brush-btn[data-brush]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.setEcnBrush(btn.dataset.brush);
      document.querySelectorAll('.ecn-brush-btn[data-brush]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('ecnClear')?.addEventListener('click', async () => {
    // Clear all ECN status in Supabase
    var gids = state.groups.map(function(g) { return g.id; });
    await clearAllEcnStatus(state.assy?.id, gids);
    // Clear local state
    state.steps.forEach(function(s) { s.ecn_status = null; });
    state.clearEcnChanges(); updateEcnSummary();
    showToast('ECN markings cleared & saved');
    if (currentView === 'list') renderListView();
    else if (currentView === 'graph') renderGraph();
    else if (currentView === 'kanban') renderKanbanView();
  });

  // Global
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideContextMenu(); });
  window.addEventListener('resize', () => { if (currentView === 'graph' && state.steps.length > 0) renderGraph(); });
}

document.addEventListener('DOMContentLoaded', () => { setupEventListeners(); init(); });
