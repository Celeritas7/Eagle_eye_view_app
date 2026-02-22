// ============================================================
// Eagle Eye Tree - Shared State (v3.5)
// ECN persistence, cascade, step P/N
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

  // Restore ECN state from DB
  ecnChanges = {};
  steps.forEach(function(s) {
    if (s.ecn_status) ecnChanges[s.id] = s.ecn_status;
  });
}
export function setStepLinks(links) { stepLinks = links; }

// Selected step
export let selectedStepId = null;
export function setSelectedStep(id) { selectedStepId = id; }

// ============================================================
// ECN — persisted to step.ecn_status column
// ============================================================
export let ecnMode = false;
export let ecnBrush = 'remove';
export let ecnChanges = {};  // { stepId: 'remove'|'replace'|'add'|'modify'|'affected' }

export function setEcnMode(on) { ecnMode = on; }
export function setEcnBrush(brush) { ecnBrush = brush; }

// Toggle ECN on a step (returns { id, status } for caller to persist)
export function toggleEcnStep(id) {
  if (ecnChanges[id] === ecnBrush) {
    delete ecnChanges[id];
    return { id: id, status: null };
  } else {
    ecnChanges[id] = ecnBrush;
    return { id: id, status: ecnBrush };
  }
}

export function clearEcnChanges() { ecnChanges = {}; }

// Set ECN status directly (used during load)
export function setEcnStatus(id, status) {
  if (status) ecnChanges[id] = status;
  else delete ecnChanges[id];
}

// ============================================================
// ECN CASCADE — auto ⚠️ for downstream steps in same group
// ============================================================
// Returns a Set of step IDs that are auto-affected (not directly marked)
// Logic: in each group, find earliest directly-ECN-marked step (by sort_order),
// then every step AFTER it in that group is affected.
export function getEcnAffectedSteps() {
  var affected = new Set();
  var directTypes = { remove: 1, replace: 1, add: 1, modify: 1 };

  groups.forEach(function(grp) {
    var gSteps = steps
      .filter(function(s) { return s.group_id === grp.id; })
      .sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

    // Find earliest directly-marked step index
    var earliestIdx = -1;
    for (var i = 0; i < gSteps.length; i++) {
      var ecn = ecnChanges[gSteps[i].id];
      if (ecn && directTypes[ecn]) {
        earliestIdx = i;
        break;
      }
    }

    if (earliestIdx >= 0) {
      // All steps AFTER the earliest marked one are affected
      for (var j = earliestIdx + 1; j < gSteps.length; j++) {
        var sid = gSteps[j].id;
        // Don't override if step is already directly marked
        if (!ecnChanges[sid]) {
          affected.add(sid);
        }
      }
    }
  });

  return affected;
}

// ============================================================
// VIEW SETTINGS
// ============================================================
export let showSequenceNumbers = true;
export let showLevelHeaders = true;
export let showPartNodes = true;
export let showFastenerLabels = true;
export let layoutDirty = false;
export let gap1 = 300;
export let gap2 = 240;
export let visibleGroupIds = null;

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
