// ============================================================
// Eagle Eye Tree - Main Application
// ============================================================

import * as state from './state.js';
import { loadAssemblyData, autoGenerateLinks, bulkCreateStepLinks } from './database.js';
import { renderGraph, zoomIn, zoomOut, fitToScreen, handleSave, hideContextMenu } from './graph.js';
import { showToast } from './ui.js';
import { renderListView, renderKanbanView, renderDetail, updateEcnSummary } from './views.js';

let currentView = 'list'; // 'list' | 'graph' | 'kanban'

// ============================================================
// VIEW SWITCHING
// ============================================================

function switchView(view) {
  currentView = view;

  // Update tabs
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));

  // Sidebar width
  const sidebar = document.getElementById('sidebar');
  sidebar.style.width = view === 'list' ? '420px' : '320px';

  // Show/hide sidebar content
  document.getElementById('listView').style.display = view === 'list' ? '' : 'none';
  document.getElementById('sidebarDetail').style.display = view !== 'list' ? '' : 'none';

  // Show/hide main areas
  document.getElementById('mainDetail').style.display = view === 'list' ? '' : 'none';
  document.getElementById('graphToolbar').style.display = view === 'graph' ? '' : 'none';
  document.getElementById('treeContainer').style.display = view === 'graph' ? '' : 'none';
  document.getElementById('kanbanView').style.display = view === 'kanban' ? '' : 'none';

  // Render the appropriate view
  if (view === 'list') {
    renderListView();
    updateDetailPanel();
  } else if (view === 'graph') {
    renderGraph();
    updateDetailPanel();
  } else if (view === 'kanban') {
    renderKanbanView();
    updateDetailPanel();
  }
}

// ============================================================
// DETAIL PANEL MANAGEMENT
// ============================================================

function updateDetailPanel() {
  if (currentView === 'list') {
    renderDetail('mainDetailContent');
  } else {
    renderDetail('sidebarDetailContent');
  }
}

// Expose for views.js to call
window._eagleEyeUpdateDetail = updateDetailPanel;

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  console.log('Eagle Eye Tree initializing...');
  setStatus('Loading…');

  try {
    const data = await loadAssemblyData('HBD_assy');
    state.setData(data);

    document.getElementById('assyTag').textContent = data.assy.tag;
    updateStats();

    // Auto-generate links if none exist
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

    setStatus('Connected');
    document.getElementById('statusDot').style.background = '#10b981';

    // Render initial view
    switchView('list');
    console.log('Eagle Eye Tree ready');
  } catch (e) {
    console.error(e);
    setStatus('Error: ' + e.message);
    document.getElementById('statusDot').style.background = '#ef4444';
    showToast(e.message, 'error');
  }
}

function setStatus(msg) {
  const el = document.getElementById('statusText');
  if (el) el.textContent = msg;
}

function updateStats() {
  document.getElementById('statsText').textContent =
    `${state.steps.length} steps · ${state.stepLinks.length} links · ${Object.keys(state.masterMap).length} master`;
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEventListeners() {
  // Tab switching
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => switchView(t.dataset.view));
  });

  // Search
  document.getElementById('searchInput')?.addEventListener('input', () => {
    if (currentView === 'list') renderListView();
  });

  // Zoom buttons
  document.getElementById('zoomInBtn')?.addEventListener('click', zoomIn);
  document.getElementById('zoomOutBtn')?.addEventListener('click', zoomOut);
  document.getElementById('fitBtn')?.addEventListener('click', () => fitToScreen(false));
  document.getElementById('fitBtn2')?.addEventListener('click', () => fitToScreen(false));
  document.getElementById('saveBtn')?.addEventListener('click', handleSave);

  // Toggle buttons
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

  // ECN mode
  document.getElementById('ecnToggle')?.addEventListener('click', () => {
    state.setEcnMode(!state.ecnMode);
    const btn = document.getElementById('ecnToggle');
    const brushes = document.getElementById('ecnBrushes');
    btn.classList.toggle('ecn-active', state.ecnMode);
    btn.textContent = state.ecnMode ? '⚡ ECN' : 'ECN';
    brushes.style.display = state.ecnMode ? 'flex' : 'none';
    // Re-render current view
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

  document.getElementById('ecnClear')?.addEventListener('click', () => {
    state.clearEcnChanges();
    updateEcnSummary();
    if (currentView === 'list') renderListView();
    else if (currentView === 'graph') renderGraph();
    else if (currentView === 'kanban') renderKanbanView();
  });

  // Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideContextMenu();
  });

  // Window resize
  window.addEventListener('resize', () => {
    if (currentView === 'graph' && state.steps.length > 0) renderGraph();
  });
}

// ============================================================
// START
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  init();
});
