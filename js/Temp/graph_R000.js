// ============================================================
// Eagle Eye Tree - Graph Module (Swimlane Layout)
// Each group gets its own horizontal swimlane band.
// Steps → Group node → Root node (HBD_assy)
// Column-locked: drag Y only within swimlane.
// ============================================================

import * as state from './state.js';
import {
  NODE_WIDTH, NODE_HEIGHT, VERTICAL_GAP, GROUP_GAP,
  getLevelColor, getLevelShape, getLevelFontSize, getLevelFontWeight,
  getLevelGap, getFastenerColor, darkenColor, lightenColor,
  ECN_COLORS, ECN_ICONS, STATUS_COLORS, PART_NODE_WIDTH, PART_NODE_HEIGHT
} from './config.js';
import { savePositions } from './database.js';
import { showToast } from './ui.js';

let zoomBehavior = null;
let currentTransform = d3.zoomIdentity;

// ============================================================
// SHAPE PATHS
// ============================================================

function shapePath(type, w, h) {
  const hw = w / 2, hh = h / 2;
  switch (type) {
    case 'stadium':
      return `M${-hw + hh},${-hh}L${hw - hh},${-hh}A${hh},${hh} 0 0,1 ${hw - hh},${hh}L${-hw + hh},${hh}A${hh},${hh} 0 0,1 ${-hw + hh},${-hh}Z`;
    case 'hexagon': {
      const s = Math.min(14, hw * 0.22);
      return `M${-hw + s},${-hh}L${hw - s},${-hh}L${hw},0L${hw - s},${hh}L${-hw + s},${hh}L${-hw},0Z`;
    }
    case 'octagon': {
      const c = Math.min(hw, hh) * 0.38;
      return `M${-hw + c},${-hh}L${hw - c},${-hh}L${hw},${-hh + c}L${hw},${hh - c}L${hw - c},${hh}L${-hw + c},${hh}L${-hw},${hh - c}L${-hw},${-hh + c}Z`;
    }
    case 'diamond':
      return `M0,${-hh}L${hw},0L0,${hh}L${-hw},0Z`;
    case 'pentagon': {
      const a = Math.PI * 2 / 5;
      const pts = [];
      for (let i = 0; i < 5; i++) {
        const angle = -Math.PI / 2 + i * a;
        pts.push(`${hw * Math.cos(angle)},${hh * Math.sin(angle)}`);
      }
      return 'M' + pts.join('L') + 'Z';
    }
    default: // rounded_rectangle
      return `M${-hw + 6},${-hh}L${hw - 6},${-hh}Q${hw},${-hh} ${hw},${-hh + 6}L${hw},${hh - 6}Q${hw},${hh} ${hw - 6},${hh}L${-hw + 6},${hh}Q${-hw},${hh} ${-hw},${hh - 6}L${-hw},${-hh + 6}Q${-hw},${-hh} ${-hw + 6},${-hh}Z`;
  }
}

// ============================================================
// SWIMLANE TREE LAYOUT
//
// Each group = one horizontal swimlane band
// Within each swimlane:
//   - Steps in the group's own column (X fixed by group index)
//   - Group node in a shared "Groups" column
//   - All group nodes connect to a single root "HBD_assy"
//
// Swimlanes are stacked vertically with gaps between them.
// ============================================================

function calculateTreeLayout() {
  const { assy, groups, steps, fasts } = state;
  if (!groups.length || !steps.length) return null;

  const sortedGroups = groups.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const numGroups = sortedGroups.length;

  // Layout constants
  const leftPad = 160;
  const topPad = 80;
  const headerH = 45;
  const swimlanePadY = 25;  // padding inside swimlane top/bottom
  const swimlaneGap = 16;   // gap between swimlanes

  // ── Column X positions ──
  // Each group gets its OWN X column for its steps
  // Then a shared "Groups" column, then "Root" column
  // But since each swimlane only uses ONE step column, we place
  // the step column at a FIXED left position for ALL swimlanes,
  // and add the group column + root to the right.
  //
  // Actually, to match the Logi Assembly look where different levels
  // have different X positions, let's put each group's steps at their
  // own column X based on group index:
  const stepColX = leftPad;  // All steps at same X (left side)
  
  // Groups column and root column
  const groupColX = stepColX + 300;
  const rootColX = groupColX + 300;

  // ── Build swimlanes ──
  const swimlanes = [];
  let currentY = topPad + headerH;

  const allNodes = [];
  const allLinks = [];

  sortedGroups.forEach((grp, gi) => {
    const gSteps = steps.filter(s => s.group_id === grp.id)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    const numSteps = gSteps.length;
    const swimlaneStartY = currentY;
    const contentH = Math.max(numSteps * VERTICAL_GAP, VERTICAL_GAP * 2);
    const swimlaneH = contentH + swimlanePadY * 2;

    // Step nodes
    gSteps.forEach((step, si) => {
      const x = stepColX;
      const y = (step.y != null) ? step.y : (swimlaneStartY + swimlanePadY + si * VERTICAL_GAP);

      allNodes.push({
        id: 's_' + step.id,
        dbId: step.id,
        x, y,
        w: NODE_WIDTH, h: NODE_HEIGHT,
        label: step.label,
        type: step.type || 'step',
        level: gi,
        shape: getLevelShape(gi),
        color: grp.color || getLevelColor(gi),
        groupId: grp.id,
        groupLabel: grp.label,
        seq: si + 1,
        isStep: true, isGroup: false, isRoot: false,
        ecn: state.ecnChanges[step.id] || null,
        isSelected: state.selectedStepId === step.id,
        partCount: state.parts.filter(p => p.step_id === step.id).length,
        fastCount: fasts.filter(f => f.step_id === step.id).length,
        swimlaneIdx: gi
      });
    });

    // Group node — centered in swimlane
    const stepYs = gSteps.map((s, si) => {
      const sNode = allNodes.find(n => n.id === 's_' + s.id);
      return sNode ? sNode.y : swimlaneStartY + swimlanePadY + si * VERTICAL_GAP;
    });
    const groupY = stepYs.length
      ? (Math.min(...stepYs) + Math.max(...stepYs)) / 2
      : swimlaneStartY + swimlaneH / 2;

    allNodes.push({
      id: 'g_' + grp.id,
      dbId: null,
      x: groupColX, y: groupY,
      w: NODE_WIDTH + 20, h: NODE_HEIGHT + 8,
      label: grp.label,
      type: 'group', level: numGroups,
      shape: 'stadium',
      color: grp.color || getLevelColor(gi),
      groupId: grp.id, groupLabel: grp.label,
      seq: gi + 1,
      isStep: false, isGroup: true, isRoot: false,
      ecn: null, isSelected: false,
      icon: grp.icon || '',
      stepCount: numSteps,
      swimlaneIdx: gi
    });

    // Step → Group links
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

    // Group → Root link
    allLinks.push({
      sourceId: 'g_' + grp.id, targetId: 'root',
      type: 'group-to-root',
      fastener_pn: null, qty: 0, loctite: null, torque: null, totalFasteners: 0
    });

    swimlanes.push({
      grp, gi,
      startY: swimlaneStartY,
      height: swimlaneH,
      endY: swimlaneStartY + swimlaneH,
      color: grp.color || getLevelColor(gi),
      label: grp.label,
      icon: grp.icon || '',
      stepCount: numSteps
    });

    currentY = swimlaneStartY + swimlaneH + swimlaneGap;
  });

  // ── Root node ──
  const allGroupNodes = allNodes.filter(n => n.isGroup);
  const groupYs = allGroupNodes.map(n => n.y);
  const rootY = groupYs.length ? (Math.min(...groupYs) + Math.max(...groupYs)) / 2 : topPad + headerH;

  allNodes.push({
    id: 'root', dbId: null,
    x: rootColX, y: rootY,
    w: NODE_WIDTH + 40, h: NODE_HEIGHT + 16,
    label: assy.tag || 'HBD_assy',
    type: 'root', level: numGroups + 1,
    shape: 'stadium', color: '#f59e0b',
    groupId: null, groupLabel: '',
    seq: 0, isStep: false, isGroup: false, isRoot: true,
    ecn: null, isSelected: false
  });

  // Dimensions
  const totalWidth = rootColX + 250;
  const totalHeight = currentY + 50;

  return {
    nodes: allNodes, links: allLinks, swimlanes,
    sortedGroups, stepColX, groupColX, rootColX,
    dimensions: { width: totalWidth, height: totalHeight },
    settings: { leftPad, topPad, headerH, numGroups }
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
  const { leftPad, topPad, headerH, numGroups } = settings;

  // Defs
  const defs = svg.append('defs');
  ['#888','#3498db','#9b59b6','#27ae60','#e67e22','#e74c3c','#f59e0b','#555','#94a3b8'].forEach(c => {
    defs.append('marker').attr('id', 'a' + c.replace('#', '')).attr('viewBox', '0 0 10 10')
      .attr('refX', 9).attr('refY', 5).attr('orient', 'auto').attr('markerWidth', 5).attr('markerHeight', 5)
      .append('path').attr('d', 'M 0,1 L 8,5 L 0,9 z').attr('fill', c);
  });

  const g = svg.append('g').attr('class', 'zoom-group');

  // Zoom
  zoomBehavior = d3.zoom().scaleExtent([0.05, 4]).on('zoom', e => {
    currentTransform = e.transform;
    g.attr('transform', e.transform);
  });
  svg.call(zoomBehavior);

  // Positions for save
  window._eagleEyePositions = {};
  window._eagleEyeRootX = rootColX;
  nodes.filter(n => n.isStep).forEach(n => {
    window._eagleEyePositions[n.dbId] = { x: n.x, y: n.y };
  });

  // ── SWIMLANE BACKGROUNDS ──
  const swimBg = g.append('g').attr('class', 'swimlane-bg');
  swimlanes.forEach((sl, si) => {
    const bgColor = si % 2 === 0 ? '#f8f9fa' : '#f0f1f3';
    // Full-width band
    swimBg.append('rect')
      .attr('x', 0).attr('y', sl.startY)
      .attr('width', rootColX + 250).attr('height', sl.height)
      .attr('fill', bgColor).attr('rx', 0);

    // Left color stripe
    swimBg.append('rect')
      .attr('x', 0).attr('y', sl.startY)
      .attr('width', 5).attr('height', sl.height)
      .attr('fill', sl.color).attr('rx', 0);

    // Swimlane label (vertical, left side)
    swimBg.append('text')
      .attr('x', 14).attr('y', sl.startY + sl.height / 2)
      .attr('fill', sl.color).attr('font-size', '11px').attr('font-weight', '800')
      .attr('dominant-baseline', 'middle')
      .text(`${sl.icon} L${sl.gi + 1} ${sl.label}`);
  });

  // ── COLUMN HEADERS ──
  if (state.showLevelHeaders) {
    // Step column
    const shg = g.append('g');
    shg.append('rect').attr('x', stepColX - 55).attr('y', topPad - 8).attr('width', 110).attr('height', 30)
      .attr('rx', 6).attr('fill', '#475569').attr('opacity', 0.85);
    shg.append('text').attr('x', stepColX).attr('y', topPad + 12).attr('text-anchor', 'middle')
      .attr('fill', 'white').attr('font-size', '11px').attr('font-weight', '700').text('Steps');

    // Group column
    const ghg = g.append('g');
    ghg.append('rect').attr('x', groupColX - 45).attr('y', topPad - 8).attr('width', 90).attr('height', 30)
      .attr('rx', 6).attr('fill', '#475569').attr('opacity', 0.85);
    ghg.append('text').attr('x', groupColX).attr('y', topPad + 12).attr('text-anchor', 'middle')
      .attr('fill', 'white').attr('font-size', '11px').attr('font-weight', '700').text('Groups');

    // Root column
    const rhg = g.append('g');
    rhg.append('rect').attr('x', rootColX - 50).attr('y', topPad - 8).attr('width', 100).attr('height', 30)
      .attr('rx', 6).attr('fill', '#f59e0b').attr('opacity', 0.85);
    rhg.append('text').attr('x', rootColX).attr('y', topPad + 12).attr('text-anchor', 'middle')
      .attr('fill', 'white').attr('font-size', '11px').attr('font-weight', '700').text('Assembly');
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
      .attr('fill', 'none')
      .attr('opacity', lk.type === 'group-to-root' ? 0.7 : 0.8)
      .attr('marker-end', `url(#a${linkColor.replace('#', '')})`);

    // Fastener annotation (step-to-group only)
    if (lk.type === 'step-to-group' && (lk.fastener_pn || lk.totalFasteners > 0)) {
      const lx = (sx + tx) / 2, ly = (sy + ty) / 2;
      const lines = [];
      if (lk.fastener_pn) lines.push({ text: lk.fastener_pn + (lk.qty > 1 ? ' ×' + lk.qty : ''), color: linkColor, bold: true });
      if (lk.loctite && lk.loctite !== '---') lines.push({ text: 'LT-' + lk.loctite, color: '#9b59b6', bold: false });
      if (lk.torque && lk.torque !== '---') lines.push({ text: lk.torque, color: '#e67e22', bold: false });
      if (lk.totalFasteners > 1) lines.push({ text: `+${lk.totalFasteners - 1} more`, color: '#94a3b8', bold: false });

      if (lines.length) {
        const lH = lines.length * 12 + 8;
        const lW = Math.max(60, ...lines.map(l => l.text.length * 5.5 + 16));
        lg.append('rect').attr('x', lx - lW / 2).attr('y', ly - lH / 2)
          .attr('width', lW).attr('height', lH).attr('rx', 3)
          .attr('fill', 'white').attr('stroke', '#e5e7eb').attr('stroke-width', 0.5).attr('opacity', 0.95);
        lines.forEach((ln, i) => {
          lg.append('text').attr('x', lx).attr('y', ly - lH / 2 + 11 + i * 12)
            .attr('text-anchor', 'middle').attr('fill', ln.color)
            .attr('font-size', '8.5px').attr('font-weight', ln.bold ? '700' : '400')
            .attr('class', 'link-label').text(ln.text);
        });
      }
    }
  });

  // ── PART LEAF NODES ──
  if (state.showPartNodes) {
    const partLayer = g.append('g').attr('class', 'parts-layer');
    nodes.filter(n => n.isStep).forEach(nd => {
      const sp = state.parts.filter(p => p.step_id === nd.dbId)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      if (!sp.length) return;

      const partColor = lightenColor(nd.color, 35);
      const totalH = (sp.length - 1) * 26;

      sp.forEach((p, pi) => {
        const px = nd.x - nd.w / 2 - PART_NODE_WIDTH / 2 - 35;
        const py = nd.y - totalH / 2 + pi * 26;
        const m = state.lookup(p.pn);
        const display = (m.name || p.pn);
        const trunc = display.length > 14 ? display.slice(0, 14) + '…' : display;

        // Connection line
        partLayer.append('path')
          .attr('d', `M${px + PART_NODE_WIDTH / 2},${py} C${px + PART_NODE_WIDTH / 2 + 18},${py} ${nd.x - nd.w / 2 - 18},${nd.y} ${nd.x - nd.w / 2},${nd.y}`)
          .attr('stroke', '#ccc').attr('stroke-width', 0.8).attr('fill', 'none');

        const pg = partLayer.append('g').attr('transform', `translate(${px},${py})`);
        pg.append('path').attr('d', shapePath('hexagon', PART_NODE_WIDTH, PART_NODE_HEIGHT))
          .attr('fill', partColor).attr('stroke', darkenColor(partColor, 25)).attr('stroke-width', 0.8);
        pg.append('text').attr('text-anchor', 'middle').attr('y', 3.5)
          .attr('font-size', '7.5px').attr('fill', '#374151').text(trunc);
        if (p.qty > 1) {
          pg.append('text').attr('x', PART_NODE_WIDTH / 2 - 2).attr('y', -PART_NODE_HEIGHT / 2 + 3)
            .attr('text-anchor', 'end').attr('font-size', '7px').attr('fill', '#6b7280').attr('font-weight', '700')
            .text('×' + p.qty);
        }
      });
    });
  }

  // ── STEP NODES ──
  const nodeLayer = g.append('g').attr('class', 'nodes-layer');
  const stepNodes = nodes.filter(n => n.isStep);

  const stepGs = nodeLayer.selectAll('.step-node').data(stepNodes, d => d.id)
    .enter().append('g').attr('class', 'step-node')
    .attr('transform', d => `translate(${d.x},${d.y})`);

  stepGs.append('path').attr('class', 'node-shape')
    .attr('d', d => shapePath(d.shape, d.w, d.h))
    .attr('fill', d => d.ecn ? ({ remove: '#fdedec', replace: '#fef9e7', add: '#d5f5e3', modify: '#ebf5fb' }[d.ecn] || d.color) : d.color)
    .attr('stroke', d => d.ecn ? ECN_COLORS[d.ecn] : d.isSelected ? '#1d4ed8' : darkenColor(d.color, 30))
    .attr('stroke-width', d => (d.isSelected || d.ecn) ? 2.5 : 1.5);

  // Status dot
  stepGs.append('circle')
    .attr('cx', d => -d.w / 2 + 10).attr('cy', d => -d.h / 2 + 10).attr('r', 4)
    .attr('fill', d => (STATUS_COLORS[d.type] || STATUS_COLORS.step).fill)
    .attr('stroke', 'white').attr('stroke-width', 1.5);

  // ECN icon
  stepGs.filter(d => d.ecn).append('text')
    .attr('x', d => d.w / 2 - 8).attr('y', 5).attr('text-anchor', 'end')
    .attr('font-size', '12px').attr('fill', d => ECN_COLORS[d.ecn]).attr('font-weight', '900')
    .text(d => ECN_ICONS[d.ecn]);

  // Label
  stepGs.append('text').attr('text-anchor', 'middle').attr('y', 4)
    .attr('font-size', d => getLevelFontSize(d.level) + 'px')
    .attr('font-weight', d => getLevelFontWeight(d.level))
    .attr('fill', '#1f2937')
    .text(d => d.label.length > 18 ? d.label.slice(0, 18) + '…' : d.label);

  // Sequence number
  if (state.showSequenceNumbers) {
    stepGs.append('text')
      .attr('x', d => d.w / 2 + 6).attr('y', d => -d.h / 2 + 4)
      .attr('font-size', '14px').attr('font-weight', '900').attr('fill', '#374151')
      .text(d => d.seq);
  }

  // Part/fast count
  stepGs.filter(d => d.partCount > 0 || d.fastCount > 0).append('text')
    .attr('x', 0).attr('y', d => d.h / 2 + 12).attr('text-anchor', 'middle')
    .attr('font-size', '8px').attr('fill', '#9ca3af')
    .text(d => {
      const t = [];
      if (d.partCount) t.push(d.partCount + 'P');
      if (d.fastCount) t.push(d.fastCount + 'F');
      return t.join(' · ');
    });

  // ── GROUP NODES ──
  const groupNodes = nodes.filter(n => n.isGroup);
  const groupGs = nodeLayer.selectAll('.group-node').data(groupNodes, d => d.id)
    .enter().append('g').attr('class', 'group-node')
    .attr('transform', d => `translate(${d.x},${d.y})`);

  groupGs.append('path')
    .attr('d', d => shapePath('stadium', d.w, d.h))
    .attr('fill', d => lightenColor(d.color, 20))
    .attr('stroke', d => d.color).attr('stroke-width', 2.5);
  groupGs.append('text').attr('text-anchor', 'middle').attr('y', -2)
    .attr('font-size', '11px').attr('font-weight', '800').attr('fill', '#1f2937')
    .text(d => { const l = (d.icon ? d.icon + ' ' : '') + d.label; return l.length > 20 ? l.slice(0, 20) + '…' : l; });
  groupGs.append('text').attr('text-anchor', 'middle').attr('y', 14)
    .attr('font-size', '9px').attr('fill', '#6b7280')
    .text(d => d.stepCount + ' steps');

  // ── ROOT NODE ──
  const rootNode = nodes.find(n => n.isRoot);
  if (rootNode) {
    const rg = nodeLayer.append('g').attr('class', 'root-node')
      .attr('transform', `translate(${rootNode.x},${rootNode.y})`);
    rg.append('path').attr('d', shapePath('stadium', rootNode.w, rootNode.h))
      .attr('fill', '#fef3c7').attr('stroke', '#f59e0b').attr('stroke-width', 3);
    rg.append('text').attr('text-anchor', 'middle').attr('y', 5)
      .attr('font-size', '14px').attr('font-weight', '900').attr('fill', '#92400e')
      .text(rootNode.label);
  }

  // ── DRAG (Y only — column locked!) ──
  const drag = d3.drag()
    .on('start', function () { d3.select(this).raise(); })
    .on('drag', function (event, d) {
      d.y = event.y;
      d3.select(this).attr('transform', `translate(${d.x},${d.y})`);
      if (d.dbId) window._eagleEyePositions[d.dbId] = { x: d.x, y: d.y };
      state.setLayoutDirty(true);
      updateSaveButton();
      updateLinksForMovedNode(d, linkLayer, nodes);
    });
  stepGs.call(drag);

  // ── CLICK / CONTEXT ──
  stepGs.style('cursor', 'pointer')
    .on('click', function (event, d) {
      event.stopPropagation();
      if (state.ecnMode) { state.toggleEcnStep(d.dbId); renderGraph(); }
      else { state.setSelectedStep(state.selectedStepId === d.dbId ? null : d.dbId); renderGraph(); window._eagleEyeUpdateDetail?.(); }
    })
    .on('contextmenu', function (event, d) {
      event.preventDefault(); event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, [
        { label: '📌 Select', action: () => { state.setSelectedStep(d.dbId); renderGraph(); window._eagleEyeUpdateDetail?.(); } }
      ]);
    });

  svg.on('click', () => { state.setSelectedStep(null); renderGraph(); window._eagleEyeUpdateDetail?.(); });

  // ── FIT ──
  fitToScreen(true);

  // ── LEGEND ──
  const legendEl = document.getElementById('legend');
  if (legendEl) {
    let html = '';
    sortedGroups.forEach((grp, gi) => {
      html += `<div class="legend-item"><div class="legend-swatch" style="background:${grp.color || getLevelColor(gi)}"></div>L${gi + 1}</div>`;
    });
    html += `<div class="legend-item" style="color:#374151;font-weight:700;">│ ${state.steps.length} steps · ${sortedGroups.length} groups</div>`;
    legendEl.innerHTML = html;
  }
}

// ============================================================
// LIVE LINK UPDATE ON DRAG
// ============================================================

function updateLinksForMovedNode(movedNode, linkLayer, allNodes) {
  linkLayer.selectAll('.link-group').each(function () {
    const lg = d3.select(this);
    const srcId = lg.attr('data-src'), tgtId = lg.attr('data-tgt');
    const src = allNodes.find(n => n.id === srcId);
    const tgt = allNodes.find(n => n.id === tgtId);
    if (!src || !tgt) return;
    if (src.id !== movedNode.id && tgt.id !== movedNode.id) return;

    const sx = src.x + src.w / 2, sy = src.y;
    const tx = tgt.x - tgt.w / 2, ty = tgt.y;
    const midX = (sx + tx) / 2;
    lg.select('.link-path').attr('d', `M${sx},${sy} C${midX},${sy} ${midX},${ty} ${tx},${ty}`);

    const lx = (sx + tx) / 2, ly = (sy + ty) / 2;
    lg.selectAll('rect').each(function () {
      const r = d3.select(this);
      const w = parseFloat(r.attr('width')), h = parseFloat(r.attr('height'));
      r.attr('x', lx - w / 2).attr('y', ly - h / 2);
    });
    let idx = 0;
    lg.selectAll('.link-label').each(function () {
      const rects = lg.selectAll('rect');
      if (rects.size() > 0) {
        const ry = parseFloat(rects.attr('y'));
        d3.select(this).attr('x', lx).attr('y', ry + 11 + idx * 12);
      }
      idx++;
    });
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

// ============================================================
// ZOOM
// ============================================================

export function zoomIn() { d3.select('#treeSvg').transition().duration(200).call(zoomBehavior.scaleBy, 1.4); }
export function zoomOut() { d3.select('#treeSvg').transition().duration(200).call(zoomBehavior.scaleBy, 0.7); }

export function fitToScreen(instant = false) {
  if (!zoomBehavior || !state.steps.length) return;
  const container = document.getElementById('treeContainer');
  const svg = d3.select('#treeSvg');
  const W = container.clientWidth, H = container.clientHeight;

  let minX = 0, maxX = (window._eagleEyeRootX || 800) + 250;
  let minY = Infinity, maxY = -Infinity;
  const pos = window._eagleEyePositions || {};
  Object.values(pos).forEach(p => {
    minY = Math.min(minY, p.y - 50); maxY = Math.max(maxY, p.y + 50);
  });
  if (minY === Infinity) { minY = 0; maxY = 600; }

  const cw = maxX - minX + 60, ch = maxY - minY + 80;
  const scale = Math.min(W / cw, H / ch, 1.5) * 0.88;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const transform = d3.zoomIdentity.translate(W / 2 - cx * scale, H / 2 - cy * scale).scale(scale);

  if (instant) svg.call(zoomBehavior.transform, transform);
  else svg.transition().duration(400).call(zoomBehavior.transform, transform);
}

export async function handleSave() {
  const pos = window._eagleEyePositions;
  if (!pos) return;
  const count = await savePositions(pos);
  state.setLayoutDirty(false);
  updateSaveButton();
  showToast(`Saved ${count} positions`);
}

// ============================================================
// CONTEXT MENU
// ============================================================

let ctxMenuEl = null;
function showContextMenu(x, y, items) {
  hideContextMenu();
  ctxMenuEl = document.createElement('div');
  ctxMenuEl.className = 'ctx-menu';
  ctxMenuEl.style.left = x + 'px'; ctxMenuEl.style.top = y + 'px';
  items.forEach(item => {
    if (item.sep) { const s = document.createElement('div'); s.className = 'ctx-sep'; ctxMenuEl.appendChild(s); return; }
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    el.textContent = item.label;
    el.onclick = () => { item.action(); hideContextMenu(); };
    ctxMenuEl.appendChild(el);
  });
  document.body.appendChild(ctxMenuEl);
  setTimeout(() => document.addEventListener('click', hideContextMenu, { once: true }), 10);
}
export function hideContextMenu() { if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; } }
