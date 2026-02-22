// ============================================================
// Eagle Eye Tree - Graph Module (v3.2)
// Swimlane layout: Steps col → Groups col → Root
// Increased vertical spacing, seq tags, fastener labels
// ============================================================

import * as state from './state.js';
import {
  NODE_WIDTH, NODE_HEIGHT, VERTICAL_GAP,
  getLevelColor, getLevelShape, getLevelFontSize, getLevelFontWeight,
  getFastenerColor, darkenColor, lightenColor,
  ECN_COLORS, ECN_ICONS, STATUS_COLORS, PART_NODE_WIDTH, PART_NODE_HEIGHT
} from './config.js';
import { savePositions, updateSeqTag } from './database.js';
import { showToast } from './ui.js';

let zoomBehavior = null;
let currentTransform = d3.zoomIdentity;

// ── SHAPES ──
function shapePath(type, w, h) {
  const hw = w / 2, hh = h / 2;
  switch (type) {
    case 'stadium': return `M${-hw + hh},${-hh}L${hw - hh},${-hh}A${hh},${hh} 0 0,1 ${hw - hh},${hh}L${-hw + hh},${hh}A${hh},${hh} 0 0,1 ${-hw + hh},${-hh}Z`;
    case 'hexagon': { const s = Math.min(14, hw * 0.22); return `M${-hw + s},${-hh}L${hw - s},${-hh}L${hw},0L${hw - s},${hh}L${-hw + s},${hh}L${-hw},0Z`; }
    case 'octagon': { const c = Math.min(hw, hh) * 0.38; return `M${-hw + c},${-hh}L${hw - c},${-hh}L${hw},${-hh + c}L${hw},${hh - c}L${hw - c},${hh}L${-hw + c},${hh}L${-hw},${hh - c}L${-hw},${-hh + c}Z`; }
    case 'diamond': return `M0,${-hh}L${hw},0L0,${hh}L${-hw},0Z`;
    default: return `M${-hw + 6},${-hh}L${hw - 6},${-hh}Q${hw},${-hh} ${hw},${-hh + 6}L${hw},${hh - 6}Q${hw},${hh} ${hw - 6},${hh}L${-hw + 6},${hh}Q${-hw},${hh} ${-hw},${hh - 6}L${-hw},${-hh + 6}Q${-hw},${-hh} ${-hw + 6},${-hh}Z`;
  }
}

// ============================================================
// SWIMLANE LAYOUT
// ============================================================

function calculateTreeLayout() {
  const { assy, groups, steps, fasts } = state;
  if (!groups.length || !steps.length) return null;

  const sortedGroups = groups.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  const topPad = 80;
  const headerH = 40;
  const swimPadY = 30;
  const swimGap = 14;
  const stepGapY = VERTICAL_GAP;  // 80px from config (was 65)
  const partZone = 170;

  const stepColX = partZone + 50;
  const groupColX = stepColX + 300;
  const rootColX = groupColX + 280;

  const allNodes = [];
  const allLinks = [];
  const swimlanes = [];
  let curY = topPad + headerH;

  sortedGroups.forEach((grp, gi) => {
    const gSteps = steps.filter(s => s.group_id === grp.id)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    const numSteps = gSteps.length;
    const maxParts = gSteps.reduce((mx, s) => Math.max(mx, state.parts.filter(p => p.step_id === s.id).length), 0);
    const effectiveRows = Math.max(numSteps, Math.ceil(maxParts * 0.7));
    const contentH = Math.max(effectiveRows * stepGapY, stepGapY * 1.5);
    const swimH = contentH + swimPadY * 2;
    const swimStartY = curY;

    gSteps.forEach((step, si) => {
      const x = stepColX;
      const y = (step.y != null) ? step.y : (swimStartY + swimPadY + si * stepGapY);

      allNodes.push({
        id: 's_' + step.id, dbId: step.id,
        x, y, w: NODE_WIDTH, h: NODE_HEIGHT,
        label: step.label, type: step.type || 'step',
        level: gi, shape: getLevelShape(gi),
        color: grp.color || getLevelColor(gi),
        groupId: grp.id, groupLabel: grp.label,
        seq: si + 1, seqTag: step.seq_tag || null,
        isStep: true, isGroup: false, isRoot: false,
        ecn: state.ecnChanges[step.id] || null,
        isSelected: state.selectedStepId === step.id,
        partCount: state.parts.filter(p => p.step_id === step.id).length,
        fastCount: fasts.filter(f => f.step_id === step.id).length,
        swimIdx: gi
      });
    });

    const stepYs = gSteps.map((s, si) => {
      const sn = allNodes.find(n => n.id === 's_' + s.id);
      return sn ? sn.y : swimStartY + swimPadY + si * stepGapY;
    });
    const groupY = stepYs.length ? (Math.min(...stepYs) + Math.max(...stepYs)) / 2 : swimStartY + swimH / 2;

    allNodes.push({
      id: 'g_' + grp.id, dbId: null,
      x: groupColX, y: groupY,
      w: NODE_WIDTH + 20, h: NODE_HEIGHT + 8,
      label: grp.label, type: 'group', level: sortedGroups.length,
      shape: 'stadium', color: grp.color || getLevelColor(gi),
      groupId: grp.id, groupLabel: grp.label,
      seq: gi + 1, seqTag: null,
      isStep: false, isGroup: true, isRoot: false,
      ecn: null, isSelected: false,
      icon: grp.icon || '', stepCount: numSteps, swimIdx: gi
    });

    gSteps.forEach(step => {
      const sf = fasts.filter(f => f.step_id === step.id);
      const first = sf[0] || {};
      allLinks.push({
        sourceId: 's_' + step.id, targetId: 'g_' + grp.id,
        type: 'step-to-group',
        fastener_pn: first.pn || null, qty: first.qty || 0,
        loctite: first.loctite || null, torque: first.torque || null,
        totalFasteners: sf.length
      });
    });

    allLinks.push({
      sourceId: 'g_' + grp.id, targetId: 'root',
      type: 'group-to-root',
      fastener_pn: null, qty: 0, loctite: null, torque: null, totalFasteners: 0
    });

    swimlanes.push({
      grp, gi, startY: swimStartY, height: swimH,
      color: grp.color || getLevelColor(gi),
      label: grp.label, icon: grp.icon || '', stepCount: numSteps
    });

    curY = swimStartY + swimH + swimGap;
  });

  const groupYs = allNodes.filter(n => n.isGroup).map(n => n.y);
  const rootY = groupYs.length ? (Math.min(...groupYs) + Math.max(...groupYs)) / 2 : topPad + headerH;

  allNodes.push({
    id: 'root', dbId: null,
    x: rootColX, y: rootY,
    w: NODE_WIDTH + 40, h: NODE_HEIGHT + 16,
    label: assy.tag || 'HBD_assy', type: 'root', level: sortedGroups.length + 1,
    shape: 'stadium', color: '#f59e0b',
    groupId: null, groupLabel: '', seq: 0, seqTag: null,
    isStep: false, isGroup: false, isRoot: true,
    ecn: null, isSelected: false
  });

  return {
    nodes: allNodes, links: allLinks, swimlanes,
    sortedGroups, stepColX, groupColX, rootColX,
    dimensions: { width: rootColX + 250, height: curY + 50 },
    settings: { topPad, headerH, partZone }
  };
}

// ============================================================
// RENDER
// ============================================================

export function renderGraph() {
  const container = document.getElementById('treeContainer');
  const svg = d3.select('#treeSvg');
  svg.selectAll('*').remove();

  if (!state.steps.length) {
    svg.attr('width', container.clientWidth).attr('height', container.clientHeight)
      .append('text').attr('x', 300).attr('y', 200).attr('fill', '#999').attr('font-size', '16px').text('No steps loaded');
    return;
  }

  const W = container.clientWidth, H = container.clientHeight;
  svg.attr('width', W).attr('height', H);

  const layout = calculateTreeLayout();
  if (!layout) return;
  const { nodes, links, swimlanes, sortedGroups, stepColX, groupColX, rootColX, settings } = layout;

  // Defs
  const defs = svg.append('defs');
  ['#888','#3498db','#9b59b6','#27ae60','#e67e22','#e74c3c','#f59e0b','#555','#94a3b8','#475569'].forEach(c => {
    defs.append('marker').attr('id', 'a' + c.replace('#', '')).attr('viewBox', '0 0 10 10')
      .attr('refX', 9).attr('refY', 5).attr('orient', 'auto').attr('markerWidth', 5).attr('markerHeight', 5)
      .append('path').attr('d', 'M 0,1 L 8,5 L 0,9 z').attr('fill', c);
  });

  const g = svg.append('g').attr('class', 'zoom-group');
  zoomBehavior = d3.zoom().scaleExtent([0.05, 4]).on('zoom', e => {
    currentTransform = e.transform; g.attr('transform', e.transform);
  });
  svg.call(zoomBehavior);

  window._eagleEyePositions = {};
  window._eagleEyeBounds = { maxX: rootColX + 250, minY: Infinity, maxY: -Infinity };
  nodes.filter(n => n.isStep).forEach(n => {
    window._eagleEyePositions[n.dbId] = { x: n.x, y: n.y };
    window._eagleEyeBounds.minY = Math.min(window._eagleEyeBounds.minY, n.y - 40);
    window._eagleEyeBounds.maxY = Math.max(window._eagleEyeBounds.maxY, n.y + 40);
  });

  // ── SWIMLANE BACKGROUNDS ──
  const swimBg = g.append('g');
  swimlanes.forEach((sl, si) => {
    const bgColor = si % 2 === 0 ? '#f8f9fa' : '#f1f3f5';
    swimBg.append('rect').attr('x', 0).attr('y', sl.startY)
      .attr('width', rootColX + 250).attr('height', sl.height).attr('fill', bgColor);
    swimBg.append('rect').attr('x', 0).attr('y', sl.startY)
      .attr('width', 5).attr('height', sl.height).attr('fill', sl.color);
    swimBg.append('text').attr('x', 14).attr('y', sl.startY + 16)
      .attr('fill', darkenColor(sl.color, 15)).attr('font-size', '10px').attr('font-weight', '800')
      .text(`${sl.icon} L${sl.gi + 1} ${sl.label}  (${sl.stepCount})`);
  });

  // ── COLUMN HEADERS ──
  if (state.showLevelHeaders) {
    const h1 = g.append('g');
    h1.append('rect').attr('x', stepColX - 55).attr('y', settings.topPad - 6).attr('width', 110).attr('height', 28).attr('rx', 5).attr('fill', '#475569').attr('opacity', 0.85);
    h1.append('text').attr('x', stepColX).attr('y', settings.topPad + 14).attr('text-anchor', 'middle').attr('fill', 'white').attr('font-size', '10px').attr('font-weight', '700').text('Steps');

    const h2 = g.append('g');
    h2.append('rect').attr('x', groupColX - 45).attr('y', settings.topPad - 6).attr('width', 90).attr('height', 28).attr('rx', 5).attr('fill', '#475569').attr('opacity', 0.85);
    h2.append('text').attr('x', groupColX).attr('y', settings.topPad + 14).attr('text-anchor', 'middle').attr('fill', 'white').attr('font-size', '10px').attr('font-weight', '700').text('Groups');

    const h3 = g.append('g');
    h3.append('rect').attr('x', rootColX - 50).attr('y', settings.topPad - 6).attr('width', 100).attr('height', 28).attr('rx', 5).attr('fill', '#f59e0b').attr('opacity', 0.85);
    h3.append('text').attr('x', rootColX).attr('y', settings.topPad + 14).attr('text-anchor', 'middle').attr('fill', 'white').attr('font-size', '10px').attr('font-weight', '700').text('Assembly');
  }

  // ── LINKS ──
  const linkLayer = g.append('g').attr('class', 'links-layer');
  links.forEach(lk => {
    const src = nodes.find(n => n.id === lk.sourceId);
    const tgt = nodes.find(n => n.id === lk.targetId);
    if (!src || !tgt) return;

    const sx = src.x + src.w / 2, sy = src.y;
    const tx = tgt.x - tgt.w / 2, ty = tgt.y;
    const midX = (sx + tx) / 2;
    const linkColor = lk.fastener_pn ? getFastenerColor(lk.fastener_pn) : (lk.type === 'group-to-root' ? '#f59e0b' : '#94a3b8');

    const lg = linkLayer.append('g').attr('class', 'link-group')
      .attr('data-src', lk.sourceId).attr('data-tgt', lk.targetId);

    lg.append('path').attr('class', 'link-path')
      .attr('d', `M${sx},${sy} C${midX},${sy} ${midX},${ty} ${tx},${ty}`)
      .attr('stroke', linkColor)
      .attr('stroke-width', lk.type === 'group-to-root' ? 2.5 : 1.4)
      .attr('fill', 'none').attr('opacity', 0.75)
      .attr('marker-end', `url(#a${linkColor.replace('#', '')})`);

    // Fastener annotation
    if (state.showFastenerLabels && lk.type === 'step-to-group' && lk.totalFasteners > 0) {
      const lx = (sx + tx) / 2, ly = (sy + ty) / 2;
      const lines = [];
      if (lk.fastener_pn) lines.push({ text: lk.fastener_pn + (lk.qty > 1 ? ' ×' + lk.qty : ''), color: linkColor, bold: true });
      if (lk.loctite && lk.loctite !== '---') lines.push({ text: 'LT-' + lk.loctite, color: '#9b59b6' });
      if (lk.torque && lk.torque !== '---') lines.push({ text: lk.torque, color: '#e67e22' });
      if (lk.totalFasteners > 1) lines.push({ text: `+${lk.totalFasteners - 1} more`, color: '#94a3b8' });

      if (lines.length) {
        const lH = lines.length * 12 + 6, lW = Math.max(58, ...lines.map(l => l.text.length * 5.2 + 14));
        lg.append('rect').attr('x', lx - lW / 2).attr('y', ly - lH / 2)
          .attr('width', lW).attr('height', lH).attr('rx', 3)
          .attr('fill', 'white').attr('stroke', '#e5e7eb').attr('stroke-width', 0.5).attr('opacity', 0.94);
        lines.forEach((ln, i) => {
          lg.append('text').attr('x', lx).attr('y', ly - lH / 2 + 10 + i * 12)
            .attr('text-anchor', 'middle').attr('fill', ln.color)
            .attr('font-size', '8px').attr('font-weight', ln.bold ? '700' : '400')
            .attr('class', 'link-label').text(ln.text);
        });
      }
    }
  });

  // ── PART LEAF NODES ──
  const partLayer = g.append('g').attr('class', 'part-layer');
  if (state.showPartNodes) {
    nodes.filter(n => n.isStep).forEach(nd => {
      const sp = state.parts.filter(p => p.step_id === nd.dbId).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      if (!sp.length) return;
      const partColor = lightenColor(nd.color, 35);
      const totalH = (sp.length - 1) * 24;

      sp.forEach((p, pi) => {
        const px = nd.x - nd.w / 2 - PART_NODE_WIDTH / 2 - 30;
        const py = nd.y - totalH / 2 + pi * 24;
        const m = state.lookup(p.pn);
        const label = (m.name || p.pn);
        const trunc = label.length > 14 ? label.slice(0, 14) + '…' : label;

        partLayer.append('path').attr('class', 'part-link').attr('data-stepid', nd.dbId)
          .attr('d', `M${px + PART_NODE_WIDTH / 2},${py} C${px + PART_NODE_WIDTH / 2 + 15},${py} ${nd.x - nd.w / 2 - 15},${nd.y} ${nd.x - nd.w / 2},${nd.y}`)
          .attr('stroke', '#ccc').attr('stroke-width', 0.7).attr('fill', 'none');
        const pg = partLayer.append('g').attr('class', 'part-hex').attr('data-stepid', nd.dbId)
          .attr('data-offsety', py - nd.y)
          .attr('transform', `translate(${px},${py})`);
        pg.append('path').attr('d', shapePath('hexagon', PART_NODE_WIDTH, PART_NODE_HEIGHT))
          .attr('fill', partColor).attr('stroke', darkenColor(partColor, 25)).attr('stroke-width', 0.7);
        pg.append('text').attr('text-anchor', 'middle').attr('y', 3)
          .attr('font-size', '7px').attr('fill', '#374151').text(trunc);
        if (p.qty > 1)
          pg.append('text').attr('x', PART_NODE_WIDTH / 2 - 2).attr('y', -PART_NODE_HEIGHT / 2 + 3)
            .attr('text-anchor', 'end').attr('font-size', '6.5px').attr('fill', '#6b7280').attr('font-weight', '700').text('×' + p.qty);
      });
    });
  }

  // ── STEP NODES ──
  const nodeLayer = g.append('g');
  const stepNodes = nodes.filter(n => n.isStep);
  const stepGs = nodeLayer.selectAll('.step-node').data(stepNodes, d => d.id)
    .enter().append('g').attr('class', 'step-node')
    .attr('transform', d => `translate(${d.x},${d.y})`);

  stepGs.append('path').attr('class', 'node-shape')
    .attr('d', d => shapePath(d.shape, d.w, d.h))
    .attr('fill', d => d.ecn ? ({ remove: '#fdedec', replace: '#fef9e7', add: '#d5f5e3', modify: '#ebf5fb' }[d.ecn] || d.color) : d.color)
    .attr('stroke', d => d.ecn ? ECN_COLORS[d.ecn] : d.isSelected ? '#1d4ed8' : darkenColor(d.color, 30))
    .attr('stroke-width', d => (d.isSelected || d.ecn) ? 2.5 : 1.5);

  stepGs.append('circle')
    .attr('cx', d => -d.w / 2 + 10).attr('cy', d => -d.h / 2 + 10).attr('r', 4)
    .attr('fill', d => (STATUS_COLORS[d.type] || STATUS_COLORS.step).fill)
    .attr('stroke', 'white').attr('stroke-width', 1.5);

  stepGs.filter(d => d.ecn).append('text')
    .attr('x', d => d.w / 2 - 8).attr('y', 5).attr('text-anchor', 'end')
    .attr('font-size', '12px').attr('fill', d => ECN_COLORS[d.ecn]).attr('font-weight', '900')
    .text(d => ECN_ICONS[d.ecn]);

  stepGs.append('text').attr('text-anchor', 'middle').attr('y', 4)
    .attr('font-size', d => getLevelFontSize(d.level) + 'px')
    .attr('font-weight', d => getLevelFontWeight(d.level))
    .attr('fill', '#1f2937')
    .text(d => d.label.length > 18 ? d.label.slice(0, 18) + '…' : d.label);

  stepGs.filter(d => d.partCount > 0 || d.fastCount > 0).append('text')
    .attr('x', 0).attr('y', d => d.h / 2 + 11).attr('text-anchor', 'middle')
    .attr('font-size', '8px').attr('fill', '#9ca3af')
    .text(d => {
      const t = [];
      if (d.partCount) t.push(d.partCount + 'P');
      if (d.fastCount) t.push(d.fastCount + 'F');
      return t.join(' · ');
    });

  // Seq tag or number — purple bold for tags
  if (state.showSequenceNumbers) {
    stepGs.append('text')
      .attr('x', d => d.w / 2 + 6).attr('y', d => -d.h / 2 + 4)
      .attr('font-size', d => d.seqTag ? '12px' : '13px')
      .attr('font-weight', '900')
      .attr('fill', d => d.seqTag ? '#7c3aed' : '#374151')
      .text(d => d.seqTag || d.seq);
  }

  // ── GROUP NODES ──
  const groupNodes = nodes.filter(n => n.isGroup);
  const groupGs = nodeLayer.selectAll('.group-node').data(groupNodes, d => d.id)
    .enter().append('g').attr('class', 'group-node')
    .attr('transform', d => `translate(${d.x},${d.y})`);

  groupGs.append('path').attr('d', d => shapePath('stadium', d.w, d.h))
    .attr('fill', d => lightenColor(d.color, 20))
    .attr('stroke', d => d.color).attr('stroke-width', 2.5);
  groupGs.append('text').attr('text-anchor', 'middle').attr('y', -2)
    .attr('font-size', '10px').attr('font-weight', '800').attr('fill', '#1f2937')
    .text(d => { const l = (d.icon ? d.icon + ' ' : '') + d.label; return l.length > 20 ? l.slice(0, 20) + '…' : l; });
  groupGs.append('text').attr('text-anchor', 'middle').attr('y', 13)
    .attr('font-size', '8.5px').attr('fill', '#6b7280')
    .text(d => d.stepCount + ' steps');

  // ── ROOT NODE ──
  const rootNode = nodes.find(n => n.isRoot);
  if (rootNode) {
    const rg = nodeLayer.append('g').attr('transform', `translate(${rootNode.x},${rootNode.y})`);
    rg.append('path').attr('d', shapePath('stadium', rootNode.w, rootNode.h))
      .attr('fill', '#fef3c7').attr('stroke', '#f59e0b').attr('stroke-width', 3);
    rg.append('text').attr('text-anchor', 'middle').attr('y', 5)
      .attr('font-size', '13px').attr('font-weight', '900').attr('fill', '#92400e')
      .text(rootNode.label);
  }

  // ── DRAG (Y only) ──
  const drag = d3.drag()
    .on('start', function () { d3.select(this).raise(); })
    .on('drag', function (event, d) {
      d.y = event.y;
      d3.select(this).attr('transform', `translate(${d.x},${d.y})`);
      if (d.dbId) window._eagleEyePositions[d.dbId] = { x: d.x, y: d.y };
      state.setLayoutDirty(true); updateSaveButton();

      // Recenter group node based on its steps' new Y positions
      const grpNode = nodes.find(n => n.isGroup && n.groupId === d.groupId);
      if (grpNode) {
        const siblingYs = nodes.filter(n => n.isStep && n.groupId === d.groupId).map(n => n.y);
        if (siblingYs.length) {
          grpNode.y = (Math.min(...siblingYs) + Math.max(...siblingYs)) / 2;
          nodeLayer.selectAll('.group-node')
            .filter(gn => gn.id === grpNode.id)
            .attr('transform', `translate(${grpNode.x},${grpNode.y})`);
        }
        // Also recenter root node
        const rootNode = nodes.find(n => n.isRoot);
        if (rootNode) {
          const groupYs = nodes.filter(n => n.isGroup).map(n => n.y);
          if (groupYs.length) {
            rootNode.y = (Math.min(...groupYs) + Math.max(...groupYs)) / 2;
            nodeLayer.selectAll('g').filter(function() {
              const dd = d3.select(this).datum();
              return dd && dd.isRoot;
            }).attr('transform', `translate(${rootNode.x},${rootNode.y})`);
          }
        }
      }

      // Update ALL links (step→group and group→root may both change)
      updateAllLinks(linkLayer, nodes);

      // Move part hexagons connected to this step
      if (state.showPartNodes) {
        updatePartPositions(d, partLayer);
      }
    });
  stepGs.call(drag);

  // ── CLICK ──
  stepGs.style('cursor', 'pointer')
    .on('click', function (event, d) {
      event.stopPropagation();
      if (state.ecnMode) { state.toggleEcnStep(d.dbId); renderGraph(); }
      else { state.setSelectedStep(state.selectedStepId === d.dbId ? null : d.dbId); renderGraph(); window._eagleEyeUpdateDetail?.(); }
    })
    .on('contextmenu', function (event, d) {
      event.preventDefault(); event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, [
        { label: '📌 Select', action: () => { state.setSelectedStep(d.dbId); renderGraph(); window._eagleEyeUpdateDetail?.(); }},
        { label: '🏷 Set seq tag…', action: () => promptSeqTag(d.dbId, d.seqTag) },
        { sep: true },
        { label: '🏷 Clear seq tag', danger: true, action: () => clearSeqTag(d.dbId) }
      ]);
    });

  svg.on('click', () => { state.setSelectedStep(null); renderGraph(); window._eagleEyeUpdateDetail?.(); });

  fitToScreen(true);

  // Legend
  const legendEl = document.getElementById('legend');
  if (legendEl) {
    let h = '';
    sortedGroups.forEach((grp, gi) => {
      h += `<div class="legend-item"><div class="legend-swatch" style="background:${grp.color || getLevelColor(gi)}"></div>L${gi + 1}</div>`;
    });
    h += `<div class="legend-item" style="color:#374151;font-weight:700;">│ ${state.steps.length} steps · ${sortedGroups.length} groups</div>`;
    legendEl.innerHTML = h;
  }
}

// ── Update ALL links (recalculate every bezier) ──
function updateAllLinks(linkLayer, allNodes) {
  linkLayer.selectAll('.link-group').each(function () {
    const lg = d3.select(this);
    const src = allNodes.find(n => n.id === lg.attr('data-src'));
    const tgt = allNodes.find(n => n.id === lg.attr('data-tgt'));
    if (!src || !tgt) return;

    const sx = src.x + src.w / 2, sy = src.y;
    const tx = tgt.x - tgt.w / 2, ty = tgt.y;
    const midX = (sx + tx) / 2;

    lg.select('.link-path').attr('d', `M${sx},${sy} C${midX},${sy} ${midX},${ty} ${tx},${ty}`);

    // Reposition fastener label
    const lx = (sx + tx) / 2, ly = (sy + ty) / 2;
    lg.selectAll('rect').each(function () {
      const r = d3.select(this);
      const w = +r.attr('width'), h = +r.attr('height');
      r.attr('x', lx - w / 2).attr('y', ly - h / 2);
    });
    let idx = 0;
    lg.selectAll('.link-label').each(function () {
      const rects = lg.selectAll('rect');
      if (rects.size()) {
        d3.select(this).attr('x', lx).attr('y', +rects.attr('y') + 10 + idx * 12);
      }
      idx++;
    });
  });
}

// ── Move part hexagons when their parent step is dragged ──
function updatePartPositions(movedStep, partLayer) {
  if (!partLayer) return;
  const stepId = movedStep.dbId;
  const stepX = movedStep.x;
  const stepY = movedStep.y;

  // Move part hexagons (maintain their relative offset from step)
  partLayer.selectAll('.part-hex').each(function () {
    const el = d3.select(this);
    if (+el.attr('data-stepid') !== stepId) return;
    const offsetY = +el.attr('data-offsety');
    const px = stepX - movedStep.w / 2 - PART_NODE_WIDTH / 2 - 30;
    const newY = stepY + offsetY;
    el.attr('transform', `translate(${px},${newY})`);
  });

  // Update part connection lines
  partLayer.selectAll('.part-link').each(function () {
    const el = d3.select(this);
    if (+el.attr('data-stepid') !== stepId) return;
    // Find the corresponding hex for this link (same index approach)
    // Recalculate all part links for this step
  });

  // Simpler: recalculate all part-link paths for this step
  const sp = state.parts.filter(p => p.step_id === stepId)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const totalH = (sp.length - 1) * 24;
  let pi = 0;
  partLayer.selectAll('.part-link').each(function () {
    const el = d3.select(this);
    if (+el.attr('data-stepid') !== stepId) return;
    const px = stepX - movedStep.w / 2 - PART_NODE_WIDTH / 2 - 30;
    const py = stepY - totalH / 2 + pi * 24;
    el.attr('d', `M${px + PART_NODE_WIDTH / 2},${py} C${px + PART_NODE_WIDTH / 2 + 15},${py} ${stepX - movedStep.w / 2 - 15},${stepY} ${stepX - movedStep.w / 2},${stepY}`);
    pi++;
  });
}

function updateSaveButton() {
  const btn = document.getElementById('saveBtn');
  if (btn) {
    btn.style.background = state.layoutDirty ? '#ef4444' : '';
    btn.style.borderColor = state.layoutDirty ? '#ef4444' : '';
    btn.style.color = state.layoutDirty ? '#fff' : '';
    btn.textContent = state.layoutDirty ? '💾 Save*' : '💾 Save';
  }
}

// ── Seq tag ──
async function promptSeqTag(stepId, current) {
  const tag = prompt('Sequence tag (e.g. 1a, 2b, 3c):', current || '');
  if (tag === null) return;
  const ok = await updateSeqTag(stepId, tag.trim());
  if (ok) {
    const step = state.steps.find(s => s.id === stepId);
    if (step) step.seq_tag = tag.trim() || null;
    renderGraph(); showToast(tag.trim() ? `Tag set: ${tag.trim()}` : 'Tag cleared');
  }
}
async function clearSeqTag(stepId) {
  await updateSeqTag(stepId, null);
  const step = state.steps.find(s => s.id === stepId);
  if (step) step.seq_tag = null;
  renderGraph(); showToast('Tag cleared');
}

// ── Zoom ──
export function zoomIn() { d3.select('#treeSvg').transition().duration(200).call(zoomBehavior.scaleBy, 1.4); }
export function zoomOut() { d3.select('#treeSvg').transition().duration(200).call(zoomBehavior.scaleBy, 0.7); }

export function fitToScreen(instant = false) {
  if (!zoomBehavior || !state.steps.length) return;
  const container = document.getElementById('treeContainer');
  const svg = d3.select('#treeSvg');
  const W = container.clientWidth, H = container.clientHeight;
  const b = window._eagleEyeBounds || { maxX: 800, minY: 0, maxY: 600 };
  const cw = (b.maxX || 800) + 60, ch = (b.maxY - b.minY) + 120;
  const scale = Math.min(W / cw, H / ch, 1.5) * 0.88;
  const cx = cw / 2, cy = (b.minY + b.maxY) / 2;
  const t = d3.zoomIdentity.translate(W / 2 - cx * scale, H / 2 - cy * scale).scale(scale);
  if (instant) svg.call(zoomBehavior.transform, t);
  else svg.transition().duration(400).call(zoomBehavior.transform, t);
}

export async function handleSave() {
  const pos = window._eagleEyePositions;
  if (!pos) return;
  const count = await savePositions(pos);
  state.setLayoutDirty(false); updateSaveButton();
  showToast(`Saved ${count} positions`);
}

// ── Context menu ──
let ctxEl = null;
function showContextMenu(x, y, items) {
  hideContextMenu();
  ctxEl = document.createElement('div'); ctxEl.className = 'ctx-menu';
  ctxEl.style.left = x + 'px'; ctxEl.style.top = y + 'px';
  items.forEach(item => {
    if (item.sep) { const s = document.createElement('div'); s.className = 'ctx-sep'; ctxEl.appendChild(s); return; }
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    el.textContent = item.label;
    el.onclick = () => { item.action(); hideContextMenu(); };
    ctxEl.appendChild(el);
  });
  document.body.appendChild(ctxEl);
  setTimeout(() => document.addEventListener('click', hideContextMenu, { once: true }), 10);
}
export function hideContextMenu() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
