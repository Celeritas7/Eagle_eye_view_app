// ============================================================
// Eagle Eye Tree - Graph Module (Logi Assembly style)
// ============================================================

import * as state from './state.js';
import {
  LEVEL_COLORS, LEVEL_SHAPES, NODE_WIDTH, NODE_HEIGHT,
  PART_NODE_WIDTH, PART_NODE_HEIGHT, VERTICAL_GAP, GROUP_GAP,
  getLevelColor, getLevelShape, getLevelFontSize, getLevelFontWeight,
  getLevelGap, getFastenerColor, darkenColor, lightenColor,
  ECN_COLORS, ECN_ICONS, STATUS_COLORS, SEQ_BADGES
} from './config.js';
import { savePositions } from './database.js';
import { showToast } from './ui.js';

let zoomBehavior = null;
let currentTransform = d3.zoomIdentity;

// ============================================================
// SVG SHAPE PATH GENERATORS
// ============================================================

function shapePath(type, w, h) {
  const hw = w / 2, hh = h / 2;
  switch (type) {
    case 'stadium':
      return `M${-hw + hh},${-hh}L${hw - hh},${-hh}A${hh},${hh} 0 0,1 ${hw - hh},${hh}L${-hw + hh},${hh}A${hh},${hh} 0 0,1 ${-hw + hh},${-hh}Z`;
    case 'hexagon': {
      const s = Math.min(14, hw * 0.2);
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
// TREE LAYOUT ALGORITHM (from Logi Assembly)
// ============================================================

function calculateTreeLayout() {
  const { groups, steps, stepLinks, parts, fasts } = state;
  if (!groups.length || !steps.length) return null;

  const sortedGroups = groups.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  // Map group_id → level index (0-based)
  const groupLevelMap = {};
  sortedGroups.forEach((g, i) => { groupLevelMap[g.id] = i; });

  // Build step → level mapping
  const stepLevel = {};
  steps.forEach(s => { stepLevel[s.id] = groupLevelMap[s.group_id] ?? 0; });

  // Group steps by level
  const levelGroups = {};
  let maxLevel = 0;
  steps.forEach(s => {
    const lv = stepLevel[s.id];
    if (!levelGroups[lv]) levelGroups[lv] = [];
    levelGroups[lv].push(s);
    maxLevel = Math.max(maxLevel, lv);
  });

  // Sort steps within each level by sort_order
  Object.values(levelGroups).forEach(arr => {
    arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  });

  // Levels sorted: highest (raw parts) on LEFT → L0 (final) on RIGHT
  // Actually for Eagle Eye: L1 (prep) on LEFT → L6 (final assembly) on RIGHT
  // So level 0 = leftmost, level maxLevel = rightmost
  const levels = [];
  for (let i = 0; i <= maxLevel; i++) {
    if (levelGroups[i]) levels.push(i);
  }

  // Layout settings
  const leftPadding = 160;
  const topPadding = 80;
  const headerHeight = 50;

  // Compute column X positions
  const columnXMap = {};
  let cumulativeX = leftPadding;
  levels.forEach((level, colIndex) => {
    columnXMap[level] = cumulativeX;
    if (colIndex < levels.length - 1) {
      cumulativeX += getLevelGap(level);
    }
  });

  // Build parent-child maps from stepLinks
  const childToParents = {};
  const parentToChildren = {};
  stepLinks.forEach(sl => {
    if (!childToParents[sl.child_step_id]) childToParents[sl.child_step_id] = [];
    childToParents[sl.child_step_id].push(sl.parent_step_id);
    if (!parentToChildren[sl.parent_step_id]) parentToChildren[sl.parent_step_id] = [];
    parentToChildren[sl.parent_step_id].push(sl.child_step_id);
  });

  // Detect groups (branches) for vertical separation
  const treeGroups = detectGroups(steps, stepLinks, childToParents, parentToChildren, sortedGroups);

  // ─── POSITION NODES ───
  const treePositions = {};
  const hasStoredPositions = steps.some(s => s.x != null && s.y != null);

  if (hasStoredPositions) {
    // Use stored positions
    steps.forEach(s => {
      const lv = stepLevel[s.id];
      treePositions[s.id] = {
        x: s.x ?? columnXMap[lv] ?? leftPadding,
        y: s.y ?? topPadding + headerHeight,
        level: lv
      };
    });
  } else {
    // Auto-layout: position from left (highest level index) to right
    const nodeToGroup = {};
    treeGroups.forEach((grp, gi) => {
      grp.nodeIds.forEach(nid => { nodeToGroup[nid] = gi; });
    });

    // Initialize all positions
    steps.forEach(s => {
      const lv = stepLevel[s.id];
      treePositions[s.id] = {
        x: columnXMap[lv] ?? leftPadding,
        y: 0,
        level: lv,
        group: nodeToGroup[s.id] ?? 0
      };
    });

    // Position each group separately
    let groupStartY = topPadding + headerHeight;

    treeGroups.forEach((grp) => {
      // Get nodes per level for this group
      const grpNodesByLevel = {};
      levels.forEach(lv => {
        grpNodesByLevel[lv] = (levelGroups[lv] || []).filter(s => grp.nodeIds.has(s.id));
      });

      // FIRST: position leaf nodes (rightmost levels first → leftward)
      // Rightmost = highest level index = final assembly
      // Leftmost = level 0 = raw parts prep
      // Children (parentToChildren) are to the RIGHT (higher index)
      // So iterate from RIGHT to LEFT to ensure children positioned before parents
      [...levels].reverse().forEach(lv => {
        const nodesInLevel = grpNodesByLevel[lv] || [];
        if (!nodesInLevel.length) return;

        nodesInLevel.forEach((node, idx) => {
          // Check if this node has children to the RIGHT that are already positioned
          const children = parentToChildren[node.id] || [];
          const childrenInGroup = children.filter(cid => grp.nodeIds.has(cid));
          const positionedChildren = childrenInGroup.filter(cid => treePositions[cid]?.y > 0);

          if (positionedChildren.length > 0) {
            // Center among positioned children
            const childYs = positionedChildren.map(cid => treePositions[cid].y);
            treePositions[node.id].y = (Math.min(...childYs) + Math.max(...childYs)) / 2;
          } else {
            treePositions[node.id].y = groupStartY + idx * VERTICAL_GAP;
          }
        });

        // Fix overlaps within this level
        nodesInLevel.sort((a, b) => treePositions[a.id].y - treePositions[b.id].y);
        let lastY = groupStartY - VERTICAL_GAP;
        nodesInLevel.forEach(node => {
          if (treePositions[node.id].y < lastY + VERTICAL_GAP) {
            treePositions[node.id].y = lastY + VERTICAL_GAP;
          }
          lastY = treePositions[node.id].y;
        });
      });

      // Calculate group bounds
      const grpNodes = steps.filter(s => grp.nodeIds.has(s.id));
      const grpYs = grpNodes.map(s => treePositions[s.id].y);
      const grpMaxY = grpYs.length ? Math.max(...grpYs) : groupStartY;
      groupStartY = grpMaxY + VERTICAL_GAP + GROUP_GAP;
    });

    // Centering passes: adjust parents to center of children (bidirectional)
    for (let pass = 0; pass < 3; pass++) {
      // Right-to-left: center parents among children
      [...levels].reverse().forEach(lv => {
        const nodesInLevel = levelGroups[lv] || [];
        nodesInLevel.forEach(node => {
          const children = parentToChildren[node.id] || [];
          if (children.length > 0) {
            const childYs = children.filter(cid => treePositions[cid]).map(cid => treePositions[cid].y);
            if (childYs.length > 0) {
              treePositions[node.id].y = (Math.min(...childYs) + Math.max(...childYs)) / 2;
            }
          }
        });

        // Fix overlaps
        nodesInLevel.sort((a, b) => treePositions[a.id].y - treePositions[b.id].y);
        let lastY = topPadding + headerHeight - VERTICAL_GAP;
        nodesInLevel.forEach(node => {
          if (treePositions[node.id].y < lastY + VERTICAL_GAP) {
            treePositions[node.id].y = lastY + VERTICAL_GAP;
          }
          lastY = treePositions[node.id].y;
        });
      });

      // Left-to-right: center children among parents
      levels.forEach(lv => {
        const nodesInLevel = levelGroups[lv] || [];
        nodesInLevel.forEach(node => {
          const parents = childToParents[node.id] || [];
          if (parents.length > 0) {
            const parentYs = parents.filter(pid => treePositions[pid]).map(pid => treePositions[pid].y);
            if (parentYs.length > 0) {
              const centerY = (Math.min(...parentYs) + Math.max(...parentYs)) / 2;
              // Only adjust if it doesn't create overlaps
              treePositions[node.id].y = centerY;
            }
          }
        });

        // Fix overlaps
        nodesInLevel.sort((a, b) => treePositions[a.id].y - treePositions[b.id].y);
        let lastY = topPadding + headerHeight - VERTICAL_GAP;
        nodesInLevel.forEach(node => {
          if (treePositions[node.id].y < lastY + VERTICAL_GAP) {
            treePositions[node.id].y = lastY + VERTICAL_GAP;
          }
          lastY = treePositions[node.id].y;
        });
      });
    }
  }

  // Calculate dimensions
  const maxColumnX = Math.max(...Object.values(columnXMap), leftPadding);
  const totalWidth = maxColumnX + leftPadding + NODE_WIDTH;
  const allYs = Object.values(treePositions).map(p => p.y);
  const maxY = allYs.length ? Math.max(...allYs) + 100 : 500;

  return {
    positions: treePositions,
    levels,
    levelGroups,
    columnXMap,
    sortedGroups,
    stepLevel,
    dimensions: { width: totalWidth, height: Math.max(maxY, 500) },
    settings: { leftPadding, topPadding, headerHeight }
  };
}

// Detect groups (branches) from link structure
function detectGroups(steps, stepLinks, childToParents, parentToChildren, sortedGroups) {
  const groups = [];
  const visited = new Set();

  // If we have links, use BFS from root-level steps
  if (stepLinks.length > 0) {
    // Find nodes with no parents (roots in each branch)
    const hasParent = new Set(stepLinks.map(l => l.child_step_id));
    const roots = steps.filter(s => !hasParent.has(s.id));

    roots.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    roots.forEach(root => {
      if (visited.has(root.id)) return;
      const group = { rootId: root.id, nodeIds: new Set() };

      // BFS through children
      const queue = [root.id];
      while (queue.length > 0) {
        const nid = queue.shift();
        if (group.nodeIds.has(nid)) continue;
        group.nodeIds.add(nid);
        visited.add(nid);
        (parentToChildren[nid] || []).forEach(cid => {
          if (!group.nodeIds.has(cid)) queue.push(cid);
        });
      }

      if (group.nodeIds.size > 0) groups.push(group);
    });
  }

  // Add unvisited nodes
  const unvisited = steps.filter(s => !visited.has(s.id));
  if (unvisited.length > 0) {
    // Group by their kanban group
    const byGroup = {};
    unvisited.forEach(s => {
      const gid = s.group_id;
      if (!byGroup[gid]) byGroup[gid] = [];
      byGroup[gid].push(s);
    });
    Object.values(byGroup).forEach(arr => {
      groups.push({ rootId: arr[0].id, nodeIds: new Set(arr.map(s => s.id)) });
    });
  }

  // Fallback: if no groups detected, one big group
  if (groups.length === 0) {
    groups.push({ rootId: null, nodeIds: new Set(steps.map(s => s.id)) });
  }

  return groups;
}

// ============================================================
// RENDER GRAPH
// ============================================================

export function renderGraph() {
  const container = document.getElementById('treeContainer');
  const svg = d3.select('#treeSvg');
  svg.selectAll('*').remove();

  if (!state.steps.length) {
    svg.append('text').attr('x', 300).attr('y', 200)
      .attr('fill', '#999').attr('font-size', '16px').text('No steps loaded');
    return;
  }

  const W = container.clientWidth;
  const H = container.clientHeight;
  svg.attr('width', W).attr('height', H);

  // Defs (arrow markers)
  const defs = svg.append('defs');
  ['#888', '#3498db', '#9b59b6', '#27ae60', '#e67e22', '#e74c3c', '#95a5a6', '#555'].forEach(c => {
    defs.append('marker').attr('id', 'arrow' + c.replace('#', '')).attr('viewBox', '0 0 10 10')
      .attr('refX', 9).attr('refY', 5).attr('orient', 'auto').attr('markerWidth', 6).attr('markerHeight', 6)
      .append('path').attr('d', 'M 0,1 L 8,5 L 0,9 z').attr('fill', c);
  });

  const g = svg.append('g').attr('class', 'zoom-group');

  // Zoom
  zoomBehavior = d3.zoom().scaleExtent([0.05, 4]).on('zoom', e => {
    currentTransform = e.transform;
    g.attr('transform', e.transform);
  });
  svg.call(zoomBehavior);

  // Calculate tree layout
  const layout = calculateTreeLayout();
  if (!layout) return;

  const { positions, levels, levelGroups, columnXMap, sortedGroups, stepLevel, settings } = layout;

  // Store positions for save
  window._eagleEyePositions = {};
  Object.entries(positions).forEach(([id, p]) => {
    window._eagleEyePositions[id] = { x: p.x, y: p.y };
  });

  // ─── LEVEL HEADERS ───
  if (state.showLevelHeaders) {
    sortedGroups.forEach((grp, gi) => {
      const x = columnXMap[gi];
      if (x == null) return;
      const color = grp.color || getLevelColor(gi);
      const label = `L${gi + 1} ${grp.label}`;
      const truncLabel = label.length > 18 ? label.slice(0, 18) + '…' : label;

      g.append('rect').attr('x', x - 70).attr('y', 12).attr('width', 140).attr('height', 32)
        .attr('rx', 6).attr('fill', color).attr('opacity', 0.92);
      g.append('text').attr('x', x).attr('y', 33).attr('text-anchor', 'middle')
        .attr('fill', 'white').attr('font-size', '12px').attr('font-weight', '700')
        .text(truncLabel);
    });
  }

  // ─── STEP-TO-STEP LINKS ───
  const linkGroup = g.append('g').attr('class', 'links-layer');

  state.stepLinks.forEach(sl => {
    const srcPos = positions[sl.parent_step_id];
    const tgtPos = positions[sl.child_step_id];
    if (!srcPos || !tgtPos) return;

    // Link goes from parent (left) → child (right)
    // parent's right edge → child's left edge
    const sx = srcPos.x + NODE_WIDTH / 2;
    const sy = srcPos.y;
    const tx = tgtPos.x - NODE_WIDTH / 2;
    const ty = tgtPos.y;
    const midX = (sx + tx) / 2;
    const linkColor = getFastenerColor(sl.fastener_pn);

    const linkG = linkGroup.append('g').attr('class', 'link-group').attr('data-link-id', sl.id);
    linkG.append('path').attr('class', 'link-path')
      .attr('d', `M${sx},${sy} C${midX},${sy} ${midX},${ty} ${tx},${ty}`)
      .attr('stroke', linkColor).attr('stroke-width', 1.8).attr('fill', 'none')
      .attr('marker-end', `url(#arrow${linkColor.replace('#', '')})`);

    // Link labels
    const hasLabel = sl.fastener_pn || sl.loctite || sl.torque;
    if (hasLabel) {
      const lx = (sx + tx) / 2, ly = (sy + ty) / 2;
      const lines = [];
      if (sl.fastener_pn) lines.push({ text: sl.fastener_pn + (sl.qty > 1 ? ' ×' + sl.qty : ''), color: linkColor, bold: true });
      if (sl.loctite) lines.push({ text: 'LT-' + sl.loctite, color: '#9b59b6', bold: false });
      if (sl.torque) lines.push({ text: sl.torque, color: '#e67e22', bold: false });

      const lH = lines.length * 13 + 8;
      const lW = Math.max(70, ...lines.map(l => l.text.length * 5.8 + 16));
      linkG.append('rect').attr('x', lx - lW / 2).attr('y', ly - lH / 2)
        .attr('width', lW).attr('height', lH).attr('rx', 4)
        .attr('fill', 'white').attr('stroke', '#e5e7eb').attr('stroke-width', 0.5).attr('opacity', 0.95);
      lines.forEach((ln, i) => {
        linkG.append('text').attr('x', lx).attr('y', ly - lH / 2 + 12 + i * 13)
          .attr('text-anchor', 'middle').attr('fill', ln.color)
          .attr('font-size', '9px').attr('font-weight', ln.bold ? '700' : '400')
          .attr('class', 'link-label').text(ln.text);
      });
    }

    // Right-click to delete link
    linkG.style('cursor', 'pointer').on('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      showContextMenu(ev.clientX, ev.clientY, [
        { label: '🗑 Delete link', danger: true, action: () => {
          import('./database.js').then(db => {
            db.deleteStepLink(sl.id).then(() => {
              state.stepLinks = state.stepLinks.filter(l => l.id !== sl.id);
              renderGraph();
              showToast('Link deleted');
            });
          });
        }}
      ]);
    });
  });

  // ─── PART LEAF NODES ───
  if (state.showPartNodes) {
    const partLayer = g.append('g').attr('class', 'parts-layer');

    state.steps.forEach(step => {
      const pos = positions[step.id];
      if (!pos) return;
      const sp = state.parts.filter(p => p.step_id === step.id).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      if (!sp.length) return;

      const lv = stepLevel[step.id];
      const stepColor = sortedGroups[lv]?.color || getLevelColor(lv);
      const partColor = lightenColor(stepColor, 35);
      const totalH = (sp.length - 1) * 28;

      sp.forEach((p, pi) => {
        const px = pos.x - NODE_WIDTH / 2 - PART_NODE_WIDTH / 2 - 40;
        const py = pos.y - totalH / 2 + pi * 28;
        const m = state.lookup(p.pn);
        const display = (m.name || p.pn);
        const truncDisplay = display.length > 16 ? display.slice(0, 16) + '…' : display;

        // Connection line
        const sx = px + PART_NODE_WIDTH / 2, sy = py;
        const tx = pos.x - NODE_WIDTH / 2, ty = pos.y;
        const mid = (sx + tx) / 2;
        partLayer.append('path')
          .attr('d', `M${sx},${sy} C${mid},${sy} ${mid},${ty} ${tx},${ty}`)
          .attr('stroke', '#bbb').attr('stroke-width', 1).attr('fill', 'none');

        // Part node
        const pg = partLayer.append('g').attr('transform', `translate(${px},${py})`);
        pg.append('path').attr('d', shapePath('hexagon', PART_NODE_WIDTH, PART_NODE_HEIGHT))
          .attr('fill', partColor).attr('stroke', darkenColor(partColor, 25)).attr('stroke-width', 1);
        pg.append('text').attr('text-anchor', 'middle').attr('y', 4)
          .attr('font-size', '8.5px').attr('fill', '#374151').text(truncDisplay);
        if (p.qty > 1) {
          pg.append('text').attr('x', PART_NODE_WIDTH / 2 - 4).attr('y', -PART_NODE_HEIGHT / 2 + 3)
            .attr('text-anchor', 'end').attr('font-size', '7px').attr('fill', '#6b7280').attr('font-weight', '700')
            .text('×' + p.qty);
        }
      });
    });
  }

  // ─── STEP NODES ───
  const nodeLayer = g.append('g').attr('class', 'nodes-layer');

  const nodeData = state.steps.map(step => {
    const pos = positions[step.id];
    if (!pos) return null;
    const lv = stepLevel[step.id];
    const grp = sortedGroups[lv];
    const color = grp?.color || getLevelColor(lv);
    const shape = getLevelShape(lv);
    const gSteps = (levelGroups[lv] || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const seqIdx = gSteps.findIndex(s => s.id === step.id) + 1;
    const ecn = state.ecnChanges[step.id] || null;

    return {
      id: step.id, x: pos.x, y: pos.y, w: NODE_WIDTH, h: NODE_HEIGHT,
      label: step.label, type: step.type, shape, color, level: lv,
      groupLabel: grp?.label || '', seq: seqIdx, ecn,
      isSelected: state.selectedStepId === step.id,
      partCount: state.parts.filter(p => p.step_id === step.id).length,
      fastCount: state.fasts.filter(f => f.step_id === step.id).length
    };
  }).filter(Boolean);

  const nodeGs = nodeLayer.selectAll('.step-node').data(nodeData, d => d.id)
    .enter().append('g').attr('class', 'step-node')
    .attr('transform', d => `translate(${d.x},${d.y})`);

  // Shape background
  nodeGs.append('path').attr('class', 'node-shape')
    .attr('d', d => shapePath(d.shape, d.w, d.h))
    .attr('fill', d => {
      if (d.ecn) return { remove: '#fdedec', replace: '#fef9e7', add: '#d5f5e3', modify: '#ebf5fb' }[d.ecn] || d.color;
      return d.color;
    })
    .attr('stroke', d => {
      if (d.ecn) return ECN_COLORS[d.ecn];
      if (d.isSelected) return '#1d4ed8';
      return darkenColor(d.color, 30);
    })
    .attr('stroke-width', d => (d.isSelected || d.ecn) ? 2.5 : 1.5);

  // Status dot
  nodeGs.append('circle')
    .attr('cx', d => -d.w / 2 + 10).attr('cy', d => -d.h / 2 + 10).attr('r', 4)
    .attr('fill', d => (STATUS_COLORS[d.type] || STATUS_COLORS.step).fill)
    .attr('stroke', 'white').attr('stroke-width', 1.5);

  // ECN icon
  nodeGs.filter(d => d.ecn).append('text')
    .attr('x', d => d.w / 2 - 8).attr('y', 5).attr('text-anchor', 'end')
    .attr('font-size', '13px').attr('fill', d => ECN_COLORS[d.ecn]).attr('font-weight', '900')
    .text(d => ECN_ICONS[d.ecn]);

  // Label
  nodeGs.append('text').attr('class', 'node-label').attr('text-anchor', 'middle').attr('y', 5)
    .attr('font-size', d => getLevelFontSize(d.level) + 'px')
    .attr('font-weight', d => getLevelFontWeight(d.level))
    .attr('fill', '#1f2937')
    .text(d => { const mx = 20; return d.label.length > mx ? d.label.slice(0, mx) + '…' : d.label; });

  // Sequence number
  if (state.showSequenceNumbers) {
    nodeGs.append('text')
      .attr('x', d => d.w / 2 + 8).attr('y', d => -d.h / 2 + 5)
      .attr('text-anchor', 'start').attr('font-size', '15px').attr('font-weight', '900').attr('fill', '#374151')
      .text(d => d.seq);
  }

  // Part/fast count badge
  nodeGs.filter(d => d.partCount > 0 || d.fastCount > 0).append('text')
    .attr('x', 0).attr('y', d => d.h / 2 + 13).attr('text-anchor', 'middle')
    .attr('font-size', '8px').attr('fill', '#9ca3af')
    .text(d => {
      const t = [];
      if (d.partCount) t.push(d.partCount + 'P');
      if (d.fastCount) t.push(d.fastCount + 'F');
      return t.join(' · ');
    });

  // ─── DRAG ───
  const drag = d3.drag()
    .on('start', function () { d3.select(this).raise(); })
    .on('drag', function (event, d) {
      d.x = event.x; d.y = event.y;
      d3.select(this).attr('transform', `translate(${d.x},${d.y})`);
      window._eagleEyePositions[d.id] = { x: d.x, y: d.y };
      state.setLayoutDirty(true);
      updateSaveButton();
      // Update links live
      updateLinksForNode(d.id, d.x, d.y, linkGroup, positions);
    })
    .on('end', function () {});
  nodeGs.call(drag);

  // ─── CLICK ───
  nodeGs.style('cursor', 'pointer')
    .on('click', function (event, d) {
      event.stopPropagation();
      if (state.ecnMode) {
        state.toggleEcnStep(d.id);
        renderGraph();
      } else {
        state.setSelectedStep(state.selectedStepId === d.id ? null : d.id);
        renderGraph();
        window._eagleEyeUpdateDetail?.();
      }
    })
    .on('contextmenu', function (event, d) {
      event.preventDefault();
      event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, [
        { label: '🔗 Connect to step…', action: () => showLinkModal(d.id) },
        { label: '📌 Select', action: () => { state.setSelectedStep(d.id); renderGraph(); window._eagleEyeUpdateDetail?.(); } },
        { sep: true },
        { label: '🗑 Delete all links', danger: true, action: () => deleteAllLinksForNode(d.id) }
      ]);
    });

  // Click empty space to deselect
  svg.on('click', () => {
    state.setSelectedStep(null);
    renderGraph();
    window._eagleEyeUpdateDetail?.();
  });

  // ─── FIT TO SCREEN ───
  fitToScreen(true);

  // ─── POPULATE LEGEND ───
  const legendEl = document.getElementById('legend');
  if (legendEl) {
    legendEl.innerHTML = '';
    sortedGroups.forEach((grp, gi) => {
      const color = grp.color || getLevelColor(gi);
      legendEl.innerHTML += `<div class="legend-item"><div class="legend-swatch" style="background:${color}"></div>L${gi + 1}</div>`;
    });
    legendEl.innerHTML += `<div class="legend-item" style="color:#374151;font-weight:700;">│ ${state.steps.length} steps · ${state.stepLinks.length} links</div>`;
  }
}

// ============================================================
// HELPERS
// ============================================================

function updateLinksForNode(nodeId, nx, ny, linkGroup, positions) {
  // Update positions cache
  positions[nodeId] = { ...positions[nodeId], x: nx, y: ny };

  // Re-render affected links
  linkGroup.selectAll('.link-group').each(function () {
    const linkG = d3.select(this);
    const lid = linkG.attr('data-link-id');
    const sl = state.stepLinks.find(l => l.id === lid);
    if (!sl) return;

    const srcPos = window._eagleEyePositions[sl.parent_step_id] || positions[sl.parent_step_id];
    const tgtPos = window._eagleEyePositions[sl.child_step_id] || positions[sl.child_step_id];
    if (!srcPos || !tgtPos) return;

    const sx = srcPos.x + NODE_WIDTH / 2, sy = srcPos.y;
    const tx = tgtPos.x - NODE_WIDTH / 2, ty = tgtPos.y;
    const midX = (sx + tx) / 2;
    linkG.select('.link-path').attr('d', `M${sx},${sy} C${midX},${sy} ${midX},${ty} ${tx},${ty}`);

    // Update label positions
    const lx = (sx + tx) / 2, ly = (sy + ty) / 2;
    linkG.selectAll('rect').each(function () {
      const r = d3.select(this);
      const w = parseFloat(r.attr('width'));
      const h = parseFloat(r.attr('height'));
      r.attr('x', lx - w / 2).attr('y', ly - h / 2);
    });
    let idx = 0;
    linkG.selectAll('.link-label').each(function () {
      const t = d3.select(this);
      const rects = linkG.selectAll('rect');
      if (rects.size() > 0) {
        const ry = parseFloat(rects.attr('y'));
        t.attr('x', lx).attr('y', ry + 12 + idx * 13);
      }
      idx++;
    });
  });
}

function updateSaveButton() {
  const btn = document.getElementById('saveBtn');
  if (btn) {
    btn.style.background = state.layoutDirty ? '#ef4444' : '';
    btn.textContent = state.layoutDirty ? '💾 Save*' : '💾 Save';
  }
}

async function deleteAllLinksForNode(nodeId) {
  const toDelete = state.stepLinks.filter(l => l.child_step_id === nodeId || l.parent_step_id === nodeId);
  if (!confirm(`Delete ${toDelete.length} link(s)?`)) return;
  const { deleteStepLink } = await import('./database.js');
  for (const l of toDelete) {
    await deleteStepLink(l.id);
  }
  state.stepLinks = state.stepLinks.filter(l => !toDelete.some(d => d.id === l.id));
  renderGraph();
  showToast(`Deleted ${toDelete.length} links`);
}

// ============================================================
// ZOOM / FIT
// ============================================================

export function zoomIn() {
  d3.select('#treeSvg').transition().duration(200).call(zoomBehavior.scaleBy, 1.4);
}

export function zoomOut() {
  d3.select('#treeSvg').transition().duration(200).call(zoomBehavior.scaleBy, 0.7);
}

export function fitToScreen(instant = false) {
  if (!zoomBehavior || !state.steps.length) return;
  const container = document.getElementById('treeContainer');
  const svg = d3.select('#treeSvg');
  const W = container.clientWidth, H = container.clientHeight;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const pos = window._eagleEyePositions || {};
  Object.values(pos).forEach(p => {
    minX = Math.min(minX, p.x - 120); maxX = Math.max(maxX, p.x + 120);
    minY = Math.min(minY, p.y - 50); maxY = Math.max(maxY, p.y + 50);
  });
  if (minX === Infinity) return;

  const cw = maxX - minX + 100, ch = maxY - minY + 100;
  const scale = Math.min(W / cw, H / ch, 1.5) * 0.85;
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
// CONTEXT MENU (simple)
// ============================================================

let ctxMenuEl = null;

function showContextMenu(x, y, items) {
  hideContextMenu();
  ctxMenuEl = document.createElement('div');
  ctxMenuEl.className = 'ctx-menu';
  ctxMenuEl.style.left = x + 'px';
  ctxMenuEl.style.top = y + 'px';

  items.forEach(item => {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'ctx-sep';
      ctxMenuEl.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    el.textContent = item.label;
    el.onclick = () => { item.action(); hideContextMenu(); };
    ctxMenuEl.appendChild(el);
  });

  document.body.appendChild(ctxMenuEl);
  setTimeout(() => document.addEventListener('click', hideContextMenu, { once: true }), 10);
}

export function hideContextMenu() {
  if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; }
}

// ============================================================
// LINK MODAL (simple DOM)
// ============================================================

function showLinkModal(sourceId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.onclick = e => e.stopPropagation();

  const sortedGroups = state.groups.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const existing = new Set(state.stepLinks.filter(l => l.child_step_id === sourceId).map(l => l.parent_step_id));
  const available = state.steps.filter(s => s.id !== sourceId && !existing.has(s.id));

  let options = '<option value="">Select target step…</option>';
  sortedGroups.forEach(g => {
    const gSteps = available.filter(s => s.group_id === g.id);
    if (!gSteps.length) return;
    options += `<optgroup label="${g.icon || ''} ${g.label}">`;
    gSteps.forEach(s => { options += `<option value="${s.id}">${s.label}</option>`; });
    options += '</optgroup>';
  });

  modal.innerHTML = `
    <h3 style="color:#60a5fa;font-size:14px;margin-bottom:14px;">Connect to Parent Step</h3>
    <div class="form-row"><label>Target (parent)</label><select id="linkTarget">${options}</select></div>
    <div class="form-row"><label>Fastener P/N</label><input id="linkFpn" placeholder="Optional"/></div>
    <div style="display:flex;gap:8px;">
      <div class="form-row" style="flex:1"><label>Qty</label><input id="linkQty" type="number" value="1" min="1"/></div>
      <div class="form-row" style="flex:1"><label>Loctite</label><input id="linkLt" placeholder="222"/></div>
      <div class="form-row" style="flex:1"><label>Torque</label><input id="linkTq" placeholder="1.5Nm"/></div>
    </div>
    <div class="form-actions">
      <button class="btn-primary" id="linkSaveBtn">Connect</button>
      <button class="btn-ghost" id="linkCancelBtn">Cancel</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  document.getElementById('linkCancelBtn').onclick = () => overlay.remove();
  document.getElementById('linkSaveBtn').onclick = async () => {
    const targetId = document.getElementById('linkTarget').value;
    if (!targetId) return;
    const { createStepLink } = await import('./database.js');
    try {
      const link = await createStepLink(
        state.assy.id, parseInt(targetId), sourceId,
        document.getElementById('linkFpn').value,
        parseInt(document.getElementById('linkQty').value) || 1,
        document.getElementById('linkLt').value,
        document.getElementById('linkTq').value
      );
      state.stepLinks.push(link);
      overlay.remove();
      renderGraph();
      showToast('Link created');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };
}
