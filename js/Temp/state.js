// ============================================================
// Eagle Eye Tree - Shared State (v3.2)
// ============================================================

export let assy = null;
export let groups = [];
export let steps = [];
export let parts = [];
export let fasts = [];
export let stepLinks = [];
export let masterMap = {};

export function setData(data) {
  assy = data.assy; groups = data.groups; steps = data.steps;
  parts = data.parts; fasts = data.fasts;
  stepLinks = data.stepLinks; masterMap = data.masterMap;
}
export function setStepLinks(links) { stepLinks = links; }

// Selected step
export let selectedStepId = null;
export function setSelectedStep(id) { selectedStepId = id; }

// ECN
export let ecnMode = false;
export let ecnBrush = 'remove';
export let ecnChanges = {};
export function setEcnMode(on) { ecnMode = on; }
export function setEcnBrush(brush) { ecnBrush = brush; }
export function toggleEcnStep(id) {
  if (ecnChanges[id] === ecnBrush) delete ecnChanges[id];
  else ecnChanges[id] = ecnBrush;
}
export function clearEcnChanges() { ecnChanges = {}; }

// View settings
export let showSequenceNumbers = true;
export let showLevelHeaders = true;
export let showPartNodes = true;
export let showFastenerLabels = true;
export let layoutDirty = false;
export let gap1 = 300;   // Steps ↔ Groups
export let gap2 = 240;   // Groups ↔ Root
export let visibleGroupIds = null;  // null = all visible, Set = only these

export function setShowSequenceNumbers(v) { showSequenceNumbers = v; }
export function setShowLevelHeaders(v) { showLevelHeaders = v; }
export function setShowPartNodes(v) { showPartNodes = v; }
export function setShowFastenerLabels(v) { showFastenerLabels = v; }
export function setLayoutDirty(v) { layoutDirty = v; }
export function setGap1(v) { gap1 = v; }
export function setGap2(v) { gap2 = v; }
export function setVisibleGroupIds(ids) { visibleGroupIds = ids; }

// Lookup
export function lookup(pn) { return masterMap[pn] || { name: null, location: null }; }
