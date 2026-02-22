// ============================================================
// Eagle Eye Tree - Main Application
// ============================================================

import * as state from './state.js';
import { loadAssemblyData, autoGenerateLinks, bulkCreateStepLinks } from './database.js';
import { renderGraph, zoomIn, zoomOut, fitToScreen, handleSave, hideContextMenu } from './graph.js';
import { showToast, updateSidePanel, closeSidePanel } from './ui.js';

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  console.log('Eagle Eye Tree initializing...');
  setStatus('Loading…');

  try {
    const data = await loadAssemblyData('HBD_assy');
    state.setData(data);

    // Update header info
    document.getElementById('assyTag').textContent = data.assy.tag;
    document.getElementById('statsText').textContent =
      `${data.steps.length} steps · ${data.stepLinks.length} links · ${Object.keys(data.masterMap).length} master parts`;

    // Auto-generate links if none exist
    if (data.stepLinks.length === 0 && data.steps.length > 0) {
      setStatus('Auto-generating links…');
      const autoLinks = autoGenerateLinks(data.assy.id, data.groups, data.steps, []);
      if (autoLinks.length > 0) {
        await bulkCreateStepLinks(autoLinks);
        // Reload to get IDs
        const fresh = await loadAssemblyData('HBD_assy');
        state.setData(fresh);
        document.getElementById('statsText').textContent =
          `${fresh.steps.length} steps · ${fresh.stepLinks.length} links · ${Object.keys(fresh.masterMap).length} master parts`;
        showToast(`Auto-generated ${autoLinks.length} links`);
      }
    }

    setStatus('Connected');
    document.getElementById('statusDot').style.background = '#10b981';

    // Render
    renderGraph();
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

// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEventListeners() {
  // Zoom buttons
  document.getElementById('zoomInBtn').onclick = zoomIn;
  document.getElementById('zoomOutBtn').onclick = zoomOut;
  document.getElementById('fitBtn').onclick = () => fitToScreen(false);
  document.getElementById('saveBtn').onclick = handleSave;

  // Toggle buttons
  document.getElementById('seqToggle').onclick = () => {
    state.setShowSequenceNumbers(!state.showSequenceNumbers);
    const btn = document.getElementById('seqToggle');
    btn.style.background = state.showSequenceNumbers ? '#3b82f6' : '';
    renderGraph();
  };

  document.getElementById('partsToggle').onclick = () => {
    state.setShowPartNodes(!state.showPartNodes);
    const btn = document.getElementById('partsToggle');
    btn.style.background = state.showPartNodes ? '#3b82f6' : '';
    renderGraph();
  };

  document.getElementById('headersToggle').onclick = () => {
    state.setShowLevelHeaders(!state.showLevelHeaders);
    const btn = document.getElementById('headersToggle');
    btn.style.background = state.showLevelHeaders ? '#3b82f6' : '';
    renderGraph();
  };

  // ECN mode
  document.getElementById('ecnToggle').onclick = () => {
    state.setEcnMode(!state.ecnMode);
    const btn = document.getElementById('ecnToggle');
    const bar = document.getElementById('ecnBar');
    btn.style.background = state.ecnMode ? '#f59e0b' : '';
    btn.style.color = state.ecnMode ? '#000' : '';
    bar.style.display = state.ecnMode ? 'flex' : 'none';
    renderGraph();
  };

  ['remove', 'replace', 'add', 'modify'].forEach(brush => {
    const btn = document.getElementById('ecn_' + brush);
    if (btn) {
      btn.onclick = () => {
        state.setEcnBrush(brush);
        document.querySelectorAll('.ecn-brush-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      };
    }
  });

  document.getElementById('ecnClear')?.addEventListener('click', () => {
    state.clearEcnChanges();
    renderGraph();
  });

  // Escape to close menus
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideContextMenu();
  });

  // Window resize
  window.addEventListener('resize', () => {
    if (state.steps.length > 0) renderGraph();
  });
}

// ============================================================
// WINDOW EXPORTS
// ============================================================

window.closeSidePanel = closeSidePanel;

// ============================================================
// START
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  init();
});
