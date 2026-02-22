// ============================================================
// Eagle Eye Tree - Database Module (v3.2)
// ============================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY, TABLES as T } from './config.js';

export const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// DATA LOADING
// ============================================================

export async function loadAssemblyData(tag = 'HBD_assy') {
  const { data: assy, error: ae } = await db.from(T.assy).select('*').eq('tag', tag).single();
  if (ae || !assy) throw new Error(ae?.message || `Assembly ${tag} not found`);

  const { data: groups } = await db.from(T.grp).select('*').eq('assembly_id', assy.id).order('sort_order');
  const gids = (groups || []).map(g => g.id);
  let steps = [], parts = [], fasts = [];
  if (gids.length) {
    const { data: s } = await db.from(T.step).select('*').in('group_id', gids).order('sort_order');
    steps = s || [];
    const sids = steps.map(x => x.id);
    if (sids.length) {
      const { data: p } = await db.from(T.part).select('*').in('step_id', sids).order('sort_order');
      parts = p || [];
      const { data: f } = await db.from(T.fast).select('*').in('step_id', sids).order('sort_order');
      fasts = f || [];
    }
  }

  const { data: stepLinks } = await db.from(T.slink).select('*').eq('assembly_id', assy.id);
  const { data: mp } = await db.from(T.master).select('pn,name,location');
  const masterMap = {};
  (mp || []).forEach(p => { masterMap[p.pn] = { name: p.name, location: p.location }; });

  return { assy, groups: groups || [], steps, parts, fasts, stepLinks: stepLinks || [], masterMap };
}

// ============================================================
// REORDER — swap sort_order of two adjacent items
// ============================================================

export async function reorderStep(stepId, direction, groupId) {
  const { data: steps } = await db.from(T.step).select('id,sort_order')
    .eq('group_id', groupId).order('sort_order');
  if (!steps) return false;

  const idx = steps.findIndex(s => s.id === stepId);
  if (idx < 0) return false;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= steps.length) return false;

  const a = steps[idx], b = steps[swapIdx];
  await db.from(T.step).update({ sort_order: b.sort_order }).eq('id', a.id);
  await db.from(T.step).update({ sort_order: a.sort_order }).eq('id', b.id);
  return true;
}

export async function reorderPart(partId, direction, stepId) {
  const { data: parts } = await db.from(T.part).select('id,sort_order')
    .eq('step_id', stepId).order('sort_order');
  if (!parts) return false;

  const idx = parts.findIndex(p => p.id === partId);
  if (idx < 0) return false;
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= parts.length) return false;

  const a = parts[idx], b = parts[swapIdx];
  await db.from(T.part).update({ sort_order: b.sort_order }).eq('id', a.id);
  await db.from(T.part).update({ sort_order: a.sort_order }).eq('id', b.id);
  return true;
}

// ============================================================
// SEQ TAG
// ============================================================

export async function updateSeqTag(stepId, tag) {
  const { error } = await db.from(T.step).update({ seq_tag: tag || null }).eq('id', stepId);
  return !error;
}

// ============================================================
// AUTO-MIGRATION — ensure seq_tag column exists
// ============================================================

export async function ensureSeqTagColumn() {
  const { error } = await db.from(T.step).select('seq_tag').limit(1);
  if (error && error.message.includes('seq_tag')) {
    console.warn('⚠️ seq_tag column missing! Run in Supabase SQL Editor:');
    console.warn('ALTER TABLE eagle_eye_app_steps ADD COLUMN IF NOT EXISTS seq_tag TEXT;');
  }
}

// ============================================================
// UPDATE PART
// ============================================================

export async function updatePart(partId, updates) {
  const { error } = await db.from(T.part).update(updates).eq('id', partId);
  if (error) console.error('updatePart error:', error.message);
  return !error;
}

// ============================================================
// UPDATE FASTENER
// ============================================================

export async function updateFastener(fastId, updates) {
  const { error } = await db.from(T.fast).update(updates).eq('id', fastId);
  if (error) console.error('updateFastener error:', error.message);
  return !error;
}

// ============================================================
// UPDATE LABEL POSITION (t = 0..1 along bezier)
// ============================================================

export async function updateLabelPosition(stepId, t) {
  const { error } = await db.from(T.step).update({ label_position: t }).eq('id', stepId);
  if (error) console.error('updateLabelPosition error:', error.message);
  return !error;
}

// ============================================================
// STEP P/N
// ============================================================

export async function updateStepPN(stepId, pn) {
  const { error } = await db.from(T.step).update({ pn: pn || null }).eq('id', stepId);
  if (error) console.error('updateStepPN error:', error.message);
  return !error;
}

export async function updateStepLabel(stepId, label) {
  const { error } = await db.from(T.step).update({ label: label }).eq('id', stepId);
  if (error) console.error('updateStepLabel error:', error.message);
  return !error;
}

// ============================================================
// ECN STATUS — persist per-step ECN markings
// ============================================================

export async function updateStepEcnStatus(stepId, status) {
  const { error } = await db.from(T.step).update({ ecn_status: status || null }).eq('id', stepId);
  if (error) console.error('updateStepEcnStatus error:', error.message);
  return !error;
}

export async function clearAllEcnStatus(assemblyId, groupIds) {
  if (!groupIds || !groupIds.length) return false;
  // Get all step IDs for this assembly's groups
  const { data: steps } = await db.from(T.step).select('id').in('group_id', groupIds);
  if (!steps || !steps.length) return false;
  const ids = steps.map(s => s.id);
  const { error } = await db.from(T.step).update({ ecn_status: null }).in('id', ids);
  if (error) console.error('clearAllEcnStatus error:', error.message);
  return !error;
}

// ============================================================
// POSITION SAVING
// ============================================================

export async function savePositions(posMap) {
  let count = 0;
  for (const [id, { x, y }] of Object.entries(posMap)) {
    const { error } = await db.from(T.step).update({ x, y }).eq('id', id);
    if (!error) count++;
  }
  return count;
}

// ============================================================
// AUTO-GENERATE LINKS
// ============================================================

export function autoGenerateLinks(assemblyId, groups, steps, existingLinks) {
  if (existingLinks.length > 0) return [];
  const sortedGroups = groups.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const links = [];
  const seen = new Set();
  const key = (a, b) => `${a}-${b}`;

  sortedGroups.forEach((grp, gi) => {
    const gSteps = steps.filter(s => s.group_id === grp.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    for (let i = 0; i < gSteps.length - 1; i++) {
      const k = key(gSteps[i].id, gSteps[i + 1].id);
      if (!seen.has(k)) { links.push({ assembly_id: assemblyId, parent_step_id: gSteps[i].id, child_step_id: gSteps[i + 1].id }); seen.add(k); }
    }
    if (gi < sortedGroups.length - 1) {
      const nextGrp = sortedGroups[gi + 1];
      const nextSteps = steps.filter(s => s.group_id === nextGrp.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      if (gSteps.length > 0 && nextSteps.length > 0) {
        const k = key(gSteps[gSteps.length - 1].id, nextSteps[0].id);
        if (!seen.has(k)) { links.push({ assembly_id: assemblyId, parent_step_id: gSteps[gSteps.length - 1].id, child_step_id: nextSteps[0].id }); seen.add(k); }
      }
    }
  });
  return links;
}

export async function bulkCreateStepLinks(links) {
  if (!links.length) return;
  const { error } = await db.from(T.slink).insert(links);
  if (error) throw error;
}
