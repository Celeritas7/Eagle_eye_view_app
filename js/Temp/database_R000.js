// ============================================================
// Eagle Eye Tree - Database Module
// ============================================================

import { SUPABASE_URL, SUPABASE_ANON_KEY, TABLES as T } from './config.js';

export const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// DATA LOADING
// ============================================================

export async function loadAssemblyData(tag = 'HBD_assy') {
  // Load assembly
  const { data: assy, error: ae } = await db.from(T.assy).select('*').eq('tag', tag).single();
  if (ae || !assy) throw new Error(ae?.message || `Assembly ${tag} not found`);

  // Load groups
  const { data: groups } = await db.from(T.grp).select('*').eq('assembly_id', assy.id).order('sort_order');

  // Load steps
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

  // Load step links
  const { data: stepLinks } = await db.from(T.slink).select('*').eq('assembly_id', assy.id);

  // Load master parts
  const { data: mp } = await db.from(T.master).select('pn,name,location');
  const masterMap = {};
  (mp || []).forEach(p => { masterMap[p.pn] = { name: p.name, location: p.location }; });

  return { assy, groups: groups || [], steps, parts, fasts, stepLinks: stepLinks || [], masterMap };
}

// ============================================================
// STEP LINK CRUD
// ============================================================

export async function createStepLink(assemblyId, parentStepId, childStepId, fastenerPn, qty, loctite, torque) {
  const { data, error } = await db.from(T.slink).insert({
    assembly_id: assemblyId,
    parent_step_id: parentStepId,
    child_step_id: childStepId,
    fastener_pn: fastenerPn || null,
    qty: qty || 1,
    loctite: loctite || null,
    torque: torque || null
  }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteStepLink(id) {
  const { error } = await db.from(T.slink).delete().eq('id', id);
  if (error) throw error;
}

export async function bulkCreateStepLinks(links) {
  if (!links.length) return;
  const { error } = await db.from(T.slink).insert(links);
  if (error) throw error;
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
// AUTO-GENERATE LINKS FROM GROUP ORDER
// Connects last step of group N → first step of group N+1
// Also connects steps within a group sequentially
// ============================================================

export function autoGenerateLinks(assemblyId, groups, steps, existingLinks) {
  if (existingLinks.length > 0) return []; // Don't auto-generate if links exist

  const sortedGroups = groups.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const links = [];
  const seen = new Set();
  const key = (a, b) => `${a}-${b}`;

  sortedGroups.forEach((grp, gi) => {
    const gSteps = steps.filter(s => s.group_id === grp.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    // Connect steps within group sequentially (child → parent means earlier → later)
    for (let i = 0; i < gSteps.length - 1; i++) {
      const k = key(gSteps[i].id, gSteps[i + 1].id);
      if (!seen.has(k)) {
        links.push({
          assembly_id: assemblyId,
          parent_step_id: gSteps[i].id,
          child_step_id: gSteps[i + 1].id
        });
        seen.add(k);
      }
    }

    // Connect last step of this group → first step of next group
    if (gi < sortedGroups.length - 1) {
      const nextGrp = sortedGroups[gi + 1];
      const nextSteps = steps.filter(s => s.group_id === nextGrp.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      if (gSteps.length > 0 && nextSteps.length > 0) {
        const lastStep = gSteps[gSteps.length - 1];
        const firstNext = nextSteps[0];
        const k = key(lastStep.id, firstNext.id);
        if (!seen.has(k)) {
          links.push({
            assembly_id: assemblyId,
            parent_step_id: lastStep.id,
            child_step_id: firstNext.id
          });
          seen.add(k);
        }
      }
    }
  });

  return links;
}
