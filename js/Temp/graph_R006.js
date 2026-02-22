// ============================================================
// Eagle Eye Tree - Graph Module (v3.4)
// Drag-proof: all links, labels, parts follow nodes
// Click-to-edit: parts + fasteners editable from graph
// ============================================================

import * as state from './state.js';
import {
  NODE_WIDTH, NODE_HEIGHT, VERTICAL_GAP,
  getLevelColor, getLevelShape, getLevelFontSize, getLevelFontWeight,
  getFastenerColor, darkenColor, lightenColor,
  ECN_COLORS, ECN_ICONS, STATUS_COLORS, PART_NODE_WIDTH, PART_NODE_HEIGHT
} from './config.js';
import { savePositions, updateSeqTag, updatePart, updateFastener, updateLabelPosition } from './database.js';
import { showToast } from './ui.js';

var zoomBehavior = null;
var currentTransform = d3.zoomIdentity;

// The single source of truth for node positions during drag
var _allNodes = [];

// ── SHAPES ──
function shapePath(type, w, h) {
  var hw = w / 2, hh = h / 2;
  switch (type) {
    case 'stadium': return 'M' + (-hw + hh) + ',' + (-hh) + 'L' + (hw - hh) + ',' + (-hh) + 'A' + hh + ',' + hh + ' 0 0,1 ' + (hw - hh) + ',' + hh + 'L' + (-hw + hh) + ',' + hh + 'A' + hh + ',' + hh + ' 0 0,1 ' + (-hw + hh) + ',' + (-hh) + 'Z';
    case 'hexagon': { var s = Math.min(14, hw * 0.22); return 'M' + (-hw + s) + ',' + (-hh) + 'L' + (hw - s) + ',' + (-hh) + 'L' + hw + ',0L' + (hw - s) + ',' + hh + 'L' + (-hw + s) + ',' + hh + 'L' + (-hw) + ',0Z'; }
    case 'octagon': { var c = Math.min(hw, hh) * 0.38; return 'M' + (-hw + c) + ',' + (-hh) + 'L' + (hw - c) + ',' + (-hh) + 'L' + hw + ',' + (-hh + c) + 'L' + hw + ',' + (hh - c) + 'L' + (hw - c) + ',' + hh + 'L' + (-hw + c) + ',' + hh + 'L' + (-hw) + ',' + (hh - c) + 'L' + (-hw) + ',' + (-hh + c) + 'Z'; }
    case 'diamond': return 'M0,' + (-hh) + 'L' + hw + ',0L0,' + hh + 'L' + (-hw) + ',0Z';
    default: return 'M' + (-hw + 6) + ',' + (-hh) + 'L' + (hw - 6) + ',' + (-hh) + 'Q' + hw + ',' + (-hh) + ' ' + hw + ',' + (-hh + 6) + 'L' + hw + ',' + (hh - 6) + 'Q' + hw + ',' + hh + ' ' + (hw - 6) + ',' + hh + 'L' + (-hw + 6) + ',' + hh + 'Q' + (-hw) + ',' + hh + ' ' + (-hw) + ',' + (hh - 6) + 'L' + (-hw) + ',' + (-hh + 6) + 'Q' + (-hw) + ',' + (-hh) + ' ' + (-hw + 6) + ',' + (-hh) + 'Z';
  }
}

function bezierPath(sx, sy, tx, ty) {
  var mx = (sx + tx) / 2;
  return 'M' + sx + ',' + sy + ' C' + mx + ',' + sy + ' ' + mx + ',' + ty + ' ' + tx + ',' + ty;
}

// Evaluate cubic bezier at parameter t (0..1)
// Control points: P0=(sx,sy) P1=(mx,sy) P2=(mx,ty) P3=(tx,ty) where mx=(sx+tx)/2
function bezierPoint(t, sx, sy, tx, ty) {
  var mx = (sx + tx) / 2;
  var u = 1 - t;
  var uu = u * u, uuu = uu * u;
  var tt = t * t, ttt = tt * t;
  return {
    x: uuu * sx + 3 * uu * t * mx + 3 * u * tt * mx + ttt * tx,
    y: uuu * sy + 3 * uu * t * sy + 3 * u * tt * ty + ttt * ty
  };
}

// Find nearest t on the bezier curve to a given point (x,y)
function nearestT(px, py, sx, sy, tx, ty) {
  var bestT = 0.5, bestDist = Infinity;
  for (var i = 0; i <= 40; i++) {
    var t = i / 40;
    var pt = bezierPoint(t, sx, sy, tx, ty);
    var dx = pt.x - px, dy = pt.y - py;
    var dist = dx * dx + dy * dy;
    if (dist < bestDist) { bestDist = dist; bestT = t; }
  }
  // Refine
  var lo = Math.max(0, bestT - 0.025), hi = Math.min(1, bestT + 0.025);
  for (var j = 0; j <= 20; j++) {
    var t2 = lo + (hi - lo) * j / 20;
    var pt2 = bezierPoint(t2, sx, sy, tx, ty);
    var dx2 = pt2.x - px, dy2 = pt2.y - py;
    var dist2 = dx2 * dx2 + dy2 * dy2;
    if (dist2 < bestDist) { bestDist = dist2; bestT = t2; }
  }
  return Math.round(bestT * 1000) / 1000;
}

// ============================================================
// SWIMLANE LAYOUT
// ============================================================

function calculateTreeLayout() {
  var assy = state.assy, groups = state.groups, steps = state.steps, fasts = state.fasts;
  if (!groups.length || !steps.length) return null;

  var sortedGroups = groups.slice().sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
  var filteredGroups = state.visibleGroupIds
    ? sortedGroups.filter(function(g) { return state.visibleGroupIds.has(g.id); })
    : sortedGroups;
  if (!filteredGroups.length) return null;

  var topPad = 80, headerH = 40, swimPadY = 30, swimGap = 14;
  var stepGapY = VERTICAL_GAP;
  var partZone = 170;
  var stepColX = partZone + 50;
  var groupColX = stepColX + state.gap1;
  var rootColX = groupColX + state.gap2;

  var allNodes = [], allLinks = [], swimlanes = [];
  var curY = topPad + headerH;

  filteredGroups.forEach(function(grp, gi) {
    var gSteps = steps.filter(function(s) { return s.group_id === grp.id; })
      .sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
    var numSteps = gSteps.length;
    var maxParts = gSteps.reduce(function(mx, s) { return Math.max(mx, state.parts.filter(function(p) { return p.step_id === s.id; }).length); }, 0);
    var contentH = Math.max(Math.max(numSteps, Math.ceil(maxParts * 0.7)) * stepGapY, stepGapY * 1.5);
    var swimH = contentH + swimPadY * 2;
    var swimStartY = curY;

    gSteps.forEach(function(step, si) {
      var x = stepColX;
      var y = (step.y != null) ? step.y : (swimStartY + swimPadY + si * stepGapY);
      allNodes.push({
        id: 's_' + step.id, dbId: step.id, x: x, y: y, w: NODE_WIDTH, h: NODE_HEIGHT,
        label: step.label, type: step.type || 'step',
        level: gi, shape: getLevelShape(gi),
        color: grp.color || getLevelColor(gi),
        groupId: grp.id, groupLabel: grp.label,
        seq: si + 1, seqTag: step.seq_tag || null,
        isStep: true, isGroup: false, isRoot: false,
        ecn: state.ecnChanges[step.id] || null,
        isSelected: state.selectedStepId === step.id,
        partCount: state.parts.filter(function(p) { return p.step_id === step.id; }).length,
        fastCount: fasts.filter(function(f) { return f.step_id === step.id; }).length,
        swimIdx: gi
      });
    });

    var stepYs = gSteps.map(function(s) { var sn = allNodes.find(function(n) { return n.id === 's_' + s.id; }); return sn ? sn.y : 0; });
    var groupY = stepYs.length ? (Math.min.apply(null, stepYs) + Math.max.apply(null, stepYs)) / 2 : swimStartY + swimH / 2;

    allNodes.push({
      id: 'g_' + grp.id, dbId: null, x: groupColX, y: groupY,
      w: NODE_WIDTH + 20, h: NODE_HEIGHT + 8,
      label: grp.label, type: 'group', level: filteredGroups.length,
      shape: 'stadium', color: grp.color || getLevelColor(gi),
      groupId: grp.id, groupLabel: grp.label, seq: gi + 1, seqTag: null,
      isStep: false, isGroup: true, isRoot: false,
      ecn: null, isSelected: false, icon: grp.icon || '', stepCount: numSteps, swimIdx: gi
    });

    gSteps.forEach(function(step) {
      var sf = fasts.filter(function(f) { return f.step_id === step.id; });
      var first = sf[0] || {};
      allLinks.push({
        sourceId: 's_' + step.id, targetId: 'g_' + grp.id, type: 'step-to-group',
        stepDbId: step.id,
        labelPos: step.label_position != null ? step.label_position : 0.5,
        fastener_pn: first.pn || null, qty: first.qty || 0,
        loctite: first.loctite || null, torque: first.torque || null, totalFasteners: sf.length
      });
    });

    allLinks.push({ sourceId: 'g_' + grp.id, targetId: 'root', type: 'group-to-root',
      stepDbId: null, fastener_pn: null, qty: 0, loctite: null, torque: null, totalFasteners: 0 });

    swimlanes.push({ grp: grp, gi: gi, startY: swimStartY, height: swimH,
      color: grp.color || getLevelColor(gi), label: grp.label, icon: grp.icon || '', stepCount: numSteps });
    curY = swimStartY + swimH + swimGap;
  });

  var groupYs = allNodes.filter(function(n) { return n.isGroup; }).map(function(n) { return n.y; });
  var rootY = groupYs.length ? (Math.min.apply(null, groupYs) + Math.max.apply(null, groupYs)) / 2 : topPad + headerH;

  allNodes.push({
    id: 'root', dbId: null, x: rootColX, y: rootY,
    w: NODE_WIDTH + 40, h: NODE_HEIGHT + 16,
    label: assy.tag || 'HBD_assy', type: 'root', level: filteredGroups.length + 1,
    shape: 'stadium', color: '#f59e0b',
    groupId: null, groupLabel: '', seq: 0, seqTag: null,
    isStep: false, isGroup: false, isRoot: true, ecn: null, isSelected: false
  });

  return { nodes: allNodes, links: allLinks, swimlanes: swimlanes,
    sortedGroups: filteredGroups, stepColX: stepColX, groupColX: groupColX, rootColX: rootColX,
    dimensions: { width: rootColX + 250, height: curY + 50 },
    settings: { topPad: topPad, headerH: headerH, partZone: partZone } };
}

// ============================================================
// RENDER
// ============================================================

export function renderGraph() {
  var container = document.getElementById('treeContainer');
  var svg = d3.select('#treeSvg');
  svg.selectAll('*').remove();

  if (!state.steps.length) {
    svg.attr('width', container.clientWidth).attr('height', container.clientHeight)
      .append('text').attr('x', 300).attr('y', 200).attr('fill', '#999').attr('font-size', '16px').text('No steps loaded');
    return;
  }

  var W = container.clientWidth, H = container.clientHeight;
  svg.attr('width', W).attr('height', H);
  var layout = calculateTreeLayout();
  if (!layout) return;
  var nodes = layout.nodes, links = layout.links, swimlanes = layout.swimlanes;
  var sortedGroups = layout.sortedGroups;
  var stepColX = layout.stepColX, groupColX = layout.groupColX, rootColX = layout.rootColX;
  var settings = layout.settings;

  // Store as module-level for drag
  _allNodes = nodes;

  // Defs
  var defs = svg.append('defs');
  ['#888','#3498db','#9b59b6','#27ae60','#e67e22','#e74c3c','#f59e0b','#555','#94a3b8','#475569'].forEach(function(c) {
    defs.append('marker').attr('id', 'a' + c.replace('#', '')).attr('viewBox', '0 0 10 10')
      .attr('refX', 9).attr('refY', 5).attr('orient', 'auto').attr('markerWidth', 5).attr('markerHeight', 5)
      .append('path').attr('d', 'M 0,1 L 8,5 L 0,9 z').attr('fill', c);
  });

  var g = svg.append('g').attr('class', 'zoom-group');
  zoomBehavior = d3.zoom().scaleExtent([0.05, 4]).on('zoom', function(e) { currentTransform = e.transform; g.attr('transform', e.transform); });
  svg.call(zoomBehavior);

  window._eagleEyePositions = {};
  window._eagleEyeBounds = { maxX: rootColX + 250, minY: Infinity, maxY: -Infinity };
  nodes.filter(function(n) { return n.isStep; }).forEach(function(n) {
    window._eagleEyePositions[n.dbId] = { x: n.x, y: n.y };
    window._eagleEyeBounds.minY = Math.min(window._eagleEyeBounds.minY, n.y - 40);
    window._eagleEyeBounds.maxY = Math.max(window._eagleEyeBounds.maxY, n.y + 40);
  });

  // ── SWIMLANE BACKGROUNDS ──
  var swimBg = g.append('g');
  swimlanes.forEach(function(sl, si) {
    swimBg.append('rect').attr('x', 0).attr('y', sl.startY)
      .attr('width', rootColX + 250).attr('height', sl.height).attr('fill', si % 2 === 0 ? '#f8f9fa' : '#f1f3f5');
    swimBg.append('rect').attr('x', 0).attr('y', sl.startY)
      .attr('width', 5).attr('height', sl.height).attr('fill', sl.color);
    swimBg.append('text').attr('x', 14).attr('y', sl.startY + 16)
      .attr('fill', darkenColor(sl.color, 15)).attr('font-size', '10px').attr('font-weight', '800')
      .text((sl.icon || '') + ' L' + (sl.gi + 1) + ' ' + sl.label + '  (' + sl.stepCount + ')');
  });

  // ── COLUMN HEADERS ──
  if (state.showLevelHeaders) {
    [[stepColX,'Steps','#475569'],[groupColX,'Groups','#475569'],[rootColX,'Assembly','#f59e0b']].forEach(function(arr) {
      var cx = arr[0], txt = arr[1], bg = arr[2];
      var hg = g.append('g');
      hg.append('rect').attr('x', cx - 55).attr('y', settings.topPad - 6).attr('width', 110).attr('height', 28).attr('rx', 5).attr('fill', bg).attr('opacity', 0.85);
      hg.append('text').attr('x', cx).attr('y', settings.topPad + 14).attr('text-anchor', 'middle').attr('fill', 'white').attr('font-size', '10px').attr('font-weight', '700').text(txt);
    });
  }

  // ── LINKS + FASTENER LABELS ──
  var linkLayer = g.append('g').attr('class', 'link-layer');
  links.forEach(function(lk) {
    var src = nodes.find(function(n) { return n.id === lk.sourceId; });
    var tgt = nodes.find(function(n) { return n.id === lk.targetId; });
    if (!src || !tgt) return;

    var sx = src.x + src.w / 2, sy = src.y;
    var tx = tgt.x - tgt.w / 2, ty = tgt.y;
    var linkColor = lk.fastener_pn ? getFastenerColor(lk.fastener_pn) : (lk.type === 'group-to-root' ? '#f59e0b' : '#94a3b8');

    var lg = linkLayer.append('g').attr('class', 'link-group')
      .attr('data-src', lk.sourceId).attr('data-tgt', lk.targetId);

    lg.append('path').attr('class', 'link-path')
      .attr('d', bezierPath(sx, sy, tx, ty))
      .attr('stroke', linkColor).attr('stroke-width', lk.type === 'group-to-root' ? 2.5 : 1.4)
      .attr('fill', 'none').attr('opacity', 0.75)
      .attr('marker-end', 'url(#a' + linkColor.replace('#', '') + ')');

    // Fastener label — positioned at t along bezier, draggable
    if (state.showFastenerLabels && lk.type === 'step-to-group' && lk.totalFasteners > 0) {
      var t = lk.labelPos;
      var bp = bezierPoint(t, sx, sy, tx, ty);
      var lines = [];
      if (lk.fastener_pn) lines.push({ text: lk.fastener_pn + (lk.qty > 1 ? ' x' + lk.qty : ''), color: linkColor, bold: true });
      if (lk.loctite && lk.loctite !== '---') lines.push({ text: 'LT-' + lk.loctite, color: '#9b59b6' });
      if (lk.torque && lk.torque !== '---') lines.push({ text: lk.torque, color: '#e67e22' });
      if (lk.totalFasteners > 1) lines.push({ text: '+' + (lk.totalFasteners - 1) + ' more', color: '#94a3b8' });

      if (lines.length) {
        var lH = lines.length * 12 + 6;
        var lW = Math.max(58, Math.max.apply(null, lines.map(function(l) { return l.text.length * 5.2 + 14; })));
        var fg = lg.append('g').attr('class', 'fast-label')
          .attr('data-stepid', String(lk.stepDbId))
          .attr('data-labelpos', String(t))
          .attr('data-sx', sx).attr('data-sy', sy).attr('data-tx', tx).attr('data-ty', ty)
          .attr('transform', 'translate(' + bp.x + ',' + bp.y + ')')
          .style('cursor', 'grab');
        fg.append('rect').attr('x', -lW / 2).attr('y', -lH / 2)
          .attr('width', lW).attr('height', lH).attr('rx', 3)
          .attr('fill', 'white').attr('stroke', '#e5e7eb').attr('stroke-width', 0.5).attr('opacity', 0.94);
        lines.forEach(function(ln, i) {
          fg.append('text').attr('x', 0).attr('y', -lH / 2 + 10 + i * 12)
            .attr('text-anchor', 'middle').attr('fill', ln.color)
            .attr('font-size', '8px').attr('font-weight', ln.bold ? '700' : '400')
            .text(ln.text);
        });

        // Drag label along curve
        var labelDrag = d3.drag()
          .on('start', function(event) { event.sourceEvent.stopPropagation(); d3.select(this).style('cursor', 'grabbing'); })
          .on('drag', function(event) {
            // Get current bezier endpoints from data attrs
            var el = d3.select(this);
            var csx = parseFloat(el.attr('data-sx'));
            var csy = parseFloat(el.attr('data-sy'));
            var ctx2 = parseFloat(el.attr('data-tx'));
            var cty = parseFloat(el.attr('data-ty'));
            // Convert event coords (already in SVG group space)
            var newT = nearestT(event.x, event.y, csx, csy, ctx2, cty);
            newT = Math.max(0.05, Math.min(0.95, newT));
            var newPt = bezierPoint(newT, csx, csy, ctx2, cty);
            el.attr('transform', 'translate(' + newPt.x + ',' + newPt.y + ')');
            el.attr('data-labelpos', String(newT));
          })
          .on('end', function() {
            var el = d3.select(this);
            el.style('cursor', 'grab');
            var stepId = parseInt(el.attr('data-stepid'));
            var finalT = parseFloat(el.attr('data-labelpos'));
            // Save to Supabase + local state
            updateLabelPosition(stepId, finalT).then(function(ok) {
              if (ok) {
                var step = state.steps.find(function(s) { return s.id === stepId; });
                if (step) step.label_position = finalT;
              }
            });
          });
        fg.call(labelDrag);

        // Click to edit fastener (only if not dragged)
        fg.on('click', function(event) {
          event.stopPropagation();
          editFastenerFromGraph(lk.stepDbId);
        });
      }
    }
  });

  // ── PART LEAF NODES ──
  var partLayer = g.append('g').attr('class', 'part-layer');
  if (state.showPartNodes) {
    nodes.filter(function(n) { return n.isStep; }).forEach(function(nd) {
      var sp = state.parts.filter(function(p) { return p.step_id === nd.dbId; })
        .sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
      if (!sp.length) return;
      var partColor = lightenColor(nd.color, 35);
      var partSpacing = 34;
      var totalH = (sp.length - 1) * partSpacing;
      sp.forEach(function(p, pi) {
        var px = nd.x - nd.w / 2 - PART_NODE_WIDTH / 2 - 30;
        var py = nd.y - totalH / 2 + pi * partSpacing;
        var m = state.lookup(p.pn);
        var nameLabel = m.name || p.pn;
        var truncName = nameLabel.length > 16 ? nameLabel.slice(0, 16) + '..' : nameLabel;
        var truncPN = p.pn.length > 18 ? p.pn.slice(0, 18) + '..' : p.pn;

        partLayer.append('path').attr('class', 'part-link').attr('data-stepid', String(nd.dbId))
          .attr('d', 'M' + (px + PART_NODE_WIDTH / 2) + ',' + py + ' C' + (px + PART_NODE_WIDTH / 2 + 15) + ',' + py + ' ' + (nd.x - nd.w / 2 - 15) + ',' + nd.y + ' ' + (nd.x - nd.w / 2) + ',' + nd.y)
          .attr('stroke', '#ccc').attr('stroke-width', 0.7).attr('fill', 'none');

        var pg = partLayer.append('g').attr('class', 'part-hex')
          .attr('data-stepid', String(nd.dbId))
          .attr('data-partid', String(p.id))
          .attr('data-offsety', String(py - nd.y))
          .attr('transform', 'translate(' + px + ',' + py + ')')
          .style('cursor', 'pointer');
        pg.append('path').attr('d', shapePath('hexagon', PART_NODE_WIDTH, PART_NODE_HEIGHT))
          .attr('fill', partColor).attr('stroke', darkenColor(partColor, 25)).attr('stroke-width', 0.7);
        // Line 1: Name
        pg.append('text').attr('text-anchor', 'middle').attr('y', -2)
          .attr('font-size', '7px').attr('font-weight', '600').attr('fill', '#1f2937').text(truncName);
        // Line 2: P/N
        pg.append('text').attr('text-anchor', 'middle').attr('y', 8)
          .attr('font-size', '5.5px').attr('fill', '#6b7280').attr('font-family', 'monospace').text(truncPN);
        if (p.qty > 1)
          pg.append('text').attr('x', PART_NODE_WIDTH / 2 - 2).attr('y', -PART_NODE_HEIGHT / 2 + 3)
            .attr('text-anchor', 'end').attr('font-size', '6.5px').attr('fill', '#6b7280').attr('font-weight', '700').text('x' + p.qty);

        // Click to edit part
        pg.on('click', function(event) {
          event.stopPropagation();
          editPartFromGraph(parseInt(pg.attr('data-partid')));
        });
      });
    });
  }

  // ── STEP NODES ──
  var nodeLayer = g.append('g').attr('class', 'node-layer');
  var stepNodes = nodes.filter(function(n) { return n.isStep; });
  var stepGs = nodeLayer.selectAll('.step-node').data(stepNodes, function(d) { return d.id; })
    .enter().append('g').attr('class', 'step-node')
    .attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });

  stepGs.append('path').attr('class', 'node-shape')
    .attr('d', function(d) { return shapePath(d.shape, d.w, d.h); })
    .attr('fill', function(d) { return d.ecn ? ({ remove: '#fdedec', replace: '#fef9e7', add: '#d5f5e3', modify: '#ebf5fb' }[d.ecn] || d.color) : d.color; })
    .attr('stroke', function(d) { return d.ecn ? ECN_COLORS[d.ecn] : d.isSelected ? '#1d4ed8' : darkenColor(d.color, 30); })
    .attr('stroke-width', function(d) { return (d.isSelected || d.ecn) ? 2.5 : 1.5; });

  stepGs.append('circle')
    .attr('cx', function(d) { return -d.w / 2 + 10; }).attr('cy', function(d) { return -d.h / 2 + 10; }).attr('r', 4)
    .attr('fill', function(d) { return (STATUS_COLORS[d.type] || STATUS_COLORS.step).fill; })
    .attr('stroke', 'white').attr('stroke-width', 1.5);

  stepGs.filter(function(d) { return d.ecn; }).append('text')
    .attr('x', function(d) { return d.w / 2 - 8; }).attr('y', 5).attr('text-anchor', 'end')
    .attr('font-size', '12px').attr('fill', function(d) { return ECN_COLORS[d.ecn]; }).attr('font-weight', '900')
    .text(function(d) { return ECN_ICONS[d.ecn]; });

  stepGs.append('text').attr('text-anchor', 'middle').attr('y', 4)
    .attr('font-size', function(d) { return getLevelFontSize(d.level) + 'px'; })
    .attr('font-weight', function(d) { return getLevelFontWeight(d.level); })
    .attr('fill', '#1f2937')
    .text(function(d) { return d.label.length > 18 ? d.label.slice(0, 18) + '..' : d.label; });

  stepGs.filter(function(d) { return d.partCount > 0 || d.fastCount > 0; }).append('text')
    .attr('x', 0).attr('y', function(d) { return d.h / 2 + 11; }).attr('text-anchor', 'middle')
    .attr('font-size', '8px').attr('fill', '#9ca3af')
    .text(function(d) { var t = []; if (d.partCount) t.push(d.partCount + 'P'); if (d.fastCount) t.push(d.fastCount + 'F'); return t.join(' . '); });

  if (state.showSequenceNumbers) {
    stepGs.append('text')
      .attr('x', function(d) { return d.w / 2 + 6; }).attr('y', function(d) { return -d.h / 2 + 4; })
      .attr('font-size', function(d) { return d.seqTag ? '12px' : '13px'; }).attr('font-weight', '900')
      .attr('fill', function(d) { return d.seqTag ? '#7c3aed' : '#374151'; })
      .text(function(d) { return d.seqTag || d.seq; });
  }

  // ── GROUP NODES ──
  var groupNodes = nodes.filter(function(n) { return n.isGroup; });
  var groupGs = nodeLayer.selectAll('.group-node').data(groupNodes, function(d) { return d.id; })
    .enter().append('g').attr('class', 'group-node')
    .attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
  groupGs.append('path').attr('d', function(d) { return shapePath('stadium', d.w, d.h); })
    .attr('fill', function(d) { return lightenColor(d.color, 20); }).attr('stroke', function(d) { return d.color; }).attr('stroke-width', 2.5);
  groupGs.append('text').attr('text-anchor', 'middle').attr('y', -2)
    .attr('font-size', '10px').attr('font-weight', '800').attr('fill', '#1f2937')
    .text(function(d) { var l = (d.icon ? d.icon + ' ' : '') + d.label; return l.length > 20 ? l.slice(0, 20) + '..' : l; });
  groupGs.append('text').attr('text-anchor', 'middle').attr('y', 13)
    .attr('font-size', '8.5px').attr('fill', '#6b7280').text(function(d) { return d.stepCount + ' steps'; });

  // ── ROOT NODE ──
  var rootNode = nodes.find(function(n) { return n.isRoot; });
  if (rootNode) {
    var rg = nodeLayer.append('g').attr('class', 'root-node').datum(rootNode)
      .attr('transform', 'translate(' + rootNode.x + ',' + rootNode.y + ')');
    rg.append('path').attr('d', shapePath('stadium', rootNode.w, rootNode.h))
      .attr('fill', '#fef3c7').attr('stroke', '#f59e0b').attr('stroke-width', 3);
    rg.append('text').attr('text-anchor', 'middle').attr('y', 5)
      .attr('font-size', '13px').attr('font-weight', '900').attr('fill', '#92400e').text(rootNode.label);
  }

  // ── DRAG (Y only) ──
  var drag = d3.drag()
    .on('start', function() { d3.select(this).raise(); })
    .on('drag', function(event, d) {
      d.y = event.y;
      d3.select(this).attr('transform', 'translate(' + d.x + ',' + d.y + ')');
      if (d.dbId) window._eagleEyePositions[d.dbId] = { x: d.x, y: d.y };
      state.setLayoutDirty(true);
      updateSaveButton();

      // === RECENTER GROUP ===
      var grpNode = _allNodes.find(function(n) { return n.isGroup && n.groupId === d.groupId; });
      if (grpNode) {
        var sibYs = _allNodes.filter(function(n) { return n.isStep && n.groupId === d.groupId; }).map(function(n) { return n.y; });
        if (sibYs.length) {
          grpNode.y = (Math.min.apply(null, sibYs) + Math.max.apply(null, sibYs)) / 2;
          d3.select('.zoom-group').selectAll('.group-node').filter(function(gn) { return gn.id === grpNode.id; })
            .attr('transform', 'translate(' + grpNode.x + ',' + grpNode.y + ')');
        }
      }

      // === RECENTER ROOT ===
      var rn = _allNodes.find(function(n) { return n.isRoot; });
      if (rn) {
        var gYs = _allNodes.filter(function(n) { return n.isGroup; }).map(function(n) { return n.y; });
        if (gYs.length) {
          rn.y = (Math.min.apply(null, gYs) + Math.max.apply(null, gYs)) / 2;
          d3.select('.zoom-group').selectAll('.root-node')
            .attr('transform', 'translate(' + rn.x + ',' + rn.y + ')');
        }
      }

      // === UPDATE ALL BEZIER PATHS + FASTENER LABELS ===
      d3.select('.zoom-group').select('.link-layer').selectAll('.link-group').each(function() {
        var lg = d3.select(this);
        var srcId = lg.attr('data-src');
        var tgtId = lg.attr('data-tgt');
        var src = null, tgt = null;
        for (var i = 0; i < _allNodes.length; i++) {
          if (_allNodes[i].id === srcId) src = _allNodes[i];
          if (_allNodes[i].id === tgtId) tgt = _allNodes[i];
        }
        if (!src || !tgt) return;

        var sx2 = src.x + src.w / 2, sy2 = src.y;
        var tx2 = tgt.x - tgt.w / 2, ty2 = tgt.y;
        lg.select('.link-path').attr('d', bezierPath(sx2, sy2, tx2, ty2));

        // Move fastener label along curve at stored t
        var fl = lg.select('.fast-label');
        if (fl.node()) {
          var t = parseFloat(fl.attr('data-labelpos')) || 0.5;
          var pt = bezierPoint(t, sx2, sy2, tx2, ty2);
          fl.attr('transform', 'translate(' + pt.x + ',' + pt.y + ')');
          // Update stored endpoints for label's own drag
          fl.attr('data-sx', sx2).attr('data-sy', sy2).attr('data-tx', tx2).attr('data-ty', ty2);
        }
      });

      // === MOVE PART HEXAGONS ===
      if (state.showPartNodes) {
        var sid = String(d.dbId);
        var sp = state.parts.filter(function(p) { return p.step_id === d.dbId; })
          .sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
        var totalH = (sp.length - 1) * 34;

        d3.select('.zoom-group').select('.part-layer').selectAll('.part-hex').each(function() {
          var el = d3.select(this);
          if (el.attr('data-stepid') !== sid) return;
          var offsetY = parseFloat(el.attr('data-offsety'));
          var px = d.x - d.w / 2 - PART_NODE_WIDTH / 2 - 30;
          el.attr('transform', 'translate(' + px + ',' + (d.y + offsetY) + ')');
        });

        var pi2 = 0;
        d3.select('.zoom-group').select('.part-layer').selectAll('.part-link').each(function() {
          var el = d3.select(this);
          if (el.attr('data-stepid') !== sid) return;
          var px = d.x - d.w / 2 - PART_NODE_WIDTH / 2 - 30;
          var py = d.y - totalH / 2 + pi2 * 34;
          var ex = d.x - d.w / 2;
          el.attr('d', 'M' + (px + PART_NODE_WIDTH / 2) + ',' + py + ' C' + (px + PART_NODE_WIDTH / 2 + 15) + ',' + py + ' ' + (ex - 15) + ',' + d.y + ' ' + ex + ',' + d.y);
          pi2++;
        });
      }
    });
  stepGs.call(drag);

  // ── CLICK + CONTEXT MENU ──
  stepGs.style('cursor', 'pointer')
    .on('click', function(event, d) {
      event.stopPropagation();
      if (state.ecnMode) { state.toggleEcnStep(d.dbId); renderGraph(); }
      else { state.setSelectedStep(state.selectedStepId === d.dbId ? null : d.dbId); renderGraph(); window._eagleEyeUpdateDetail?.(); }
    })
    .on('contextmenu', function(event, d) {
      event.preventDefault(); event.stopPropagation();
      showContextMenu(event.clientX, event.clientY, [
        { label: '📌 Select', action: function() { state.setSelectedStep(d.dbId); renderGraph(); window._eagleEyeUpdateDetail?.(); }},
        { label: '🏷 Set seq tag...', action: function() { promptSeqTag(d.dbId, d.seqTag); } },
        { sep: true },
        { label: '🏷 Clear seq tag', danger: true, action: function() { clearSeqTag(d.dbId); } }
      ]);
    });

  svg.on('click', function() { state.setSelectedStep(null); renderGraph(); window._eagleEyeUpdateDetail?.(); });
  fitToScreen(true);

  // Legend
  var legendEl = document.getElementById('legend');
  if (legendEl) {
    var h = '';
    sortedGroups.forEach(function(grp, gi) { h += '<div class="legend-item"><div class="legend-swatch" style="background:' + (grp.color || getLevelColor(gi)) + '"></div>L' + (gi + 1) + '</div>'; });
    h += '<div class="legend-item" style="color:#374151;font-weight:700;">| ' + state.steps.length + ' steps . ' + sortedGroups.length + ' groups</div>';
    legendEl.innerHTML = h;
  }
}

// ============================================================
// GRAPH EDIT — Part (click hexagon)
// ============================================================

function editPartFromGraph(partId) {
  var part = state.parts.find(function(p) { return p.id === partId; });
  if (!part) return;
  var m = state.lookup(part.pn);

  var newPN = prompt('Part Number (P/N):', part.pn);
  if (newPN === null) return;
  newPN = newPN.trim();
  if (!newPN) { showToast('P/N cannot be empty'); return; }

  var newQty = prompt('Quantity:', String(part.qty));
  if (newQty === null) return;
  newQty = parseInt(newQty) || 1;

  updatePart(partId, { pn: newPN, qty: newQty }).then(function(ok) {
    if (ok) {
      part.pn = newPN;
      part.qty = newQty;
      showToast('Part updated: ' + newPN);
      renderGraph();
      window._eagleEyeUpdateDetail?.();
    } else {
      showToast('Failed to update part');
    }
  });
}

// ============================================================
// GRAPH EDIT — Fastener (click label on link)
// ============================================================

function editFastenerFromGraph(stepId) {
  var sf = state.fasts.filter(function(f) { return f.step_id === stepId; });
  if (!sf.length) return;

  // If multiple fasteners, edit the first one (user can edit rest from detail panel)
  var f = sf[0];
  var m = state.lookup(f.pn);

  var newPN = prompt('Fastener P/N:', f.pn);
  if (newPN === null) return;
  newPN = newPN.trim();
  if (!newPN) { showToast('P/N cannot be empty'); return; }

  var newQty = prompt('Quantity:', String(f.qty));
  if (newQty === null) return;
  newQty = parseInt(newQty) || 1;

  var newLT = prompt('Loctite (222/243/262/271/290/333/425/648 or empty):', f.loctite || '');
  if (newLT === null) return;

  var newTQ = prompt('Torque (e.g. 25Nm or empty):', (f.torque && f.torque !== '---') ? f.torque : '');
  if (newTQ === null) return;

  updateFastener(f.id, {
    pn: newPN,
    qty: newQty,
    loctite: newLT.trim() || null,
    torque: newTQ.trim() || null
  }).then(function(ok) {
    if (ok) {
      f.pn = newPN;
      f.qty = newQty;
      f.loctite = newLT.trim() || null;
      f.torque = newTQ.trim() || null;
      showToast('Fastener updated');
      renderGraph();
      window._eagleEyeUpdateDetail?.();
    } else {
      showToast('Failed to update fastener');
    }
  });
}

// ============================================================
// UTILITIES
// ============================================================

function updateSaveButton() {
  var btn = document.getElementById('saveBtn');
  if (btn) {
    btn.style.background = state.layoutDirty ? '#ef4444' : '';
    btn.style.borderColor = state.layoutDirty ? '#ef4444' : '';
    btn.style.color = state.layoutDirty ? '#fff' : '';
    btn.textContent = state.layoutDirty ? '💾 Save*' : '💾 Save';
  }
}

async function promptSeqTag(stepId, current) {
  var tag = prompt('Sequence tag (e.g. 1a, 2b, 3c):', current || '');
  if (tag === null) return;
  var ok = await updateSeqTag(stepId, tag.trim());
  if (ok) {
    var step = state.steps.find(function(s) { return s.id === stepId; });
    if (step) step.seq_tag = tag.trim() || null;
    renderGraph(); showToast(tag.trim() ? 'Tag set: ' + tag.trim() : 'Tag cleared');
  }
}

async function clearSeqTag(stepId) {
  await updateSeqTag(stepId, null);
  var step = state.steps.find(function(s) { return s.id === stepId; });
  if (step) step.seq_tag = null;
  renderGraph(); showToast('Tag cleared');
}

export function zoomIn() { d3.select('#treeSvg').transition().duration(200).call(zoomBehavior.scaleBy, 1.4); }
export function zoomOut() { d3.select('#treeSvg').transition().duration(200).call(zoomBehavior.scaleBy, 0.7); }

export function fitToScreen(instant) {
  if (!zoomBehavior || !state.steps.length) return;
  var cont = document.getElementById('treeContainer');
  var svg = d3.select('#treeSvg');
  var W = cont.clientWidth, H = cont.clientHeight;
  var b = window._eagleEyeBounds || { maxX: 800, minY: 0, maxY: 600 };
  var cw = (b.maxX || 800) + 60, ch = (b.maxY - b.minY) + 120;
  var scale = Math.min(W / cw, H / ch, 1.5) * 0.88;
  var cx = cw / 2, cy = (b.minY + b.maxY) / 2;
  var t = d3.zoomIdentity.translate(W / 2 - cx * scale, H / 2 - cy * scale).scale(scale);
  if (instant) svg.call(zoomBehavior.transform, t);
  else svg.transition().duration(400).call(zoomBehavior.transform, t);
}

export async function handleSave() {
  var pos = window._eagleEyePositions;
  if (!pos) return;
  var count = await savePositions(pos);
  state.setLayoutDirty(false); updateSaveButton();
  showToast('Saved ' + count + ' positions');
}

// Context menu
var ctxEl = null;
function showContextMenu(x, y, items) {
  hideContextMenu();
  ctxEl = document.createElement('div'); ctxEl.className = 'ctx-menu';
  ctxEl.style.left = x + 'px'; ctxEl.style.top = y + 'px';
  items.forEach(function(item) {
    if (item.sep) { var s = document.createElement('div'); s.className = 'ctx-sep'; ctxEl.appendChild(s); return; }
    var el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    el.textContent = item.label;
    el.onclick = function() { item.action(); hideContextMenu(); };
    ctxEl.appendChild(el);
  });
  document.body.appendChild(ctxEl);
  setTimeout(function() { document.addEventListener('click', hideContextMenu, { once: true }); }, 10);
}
export function hideContextMenu() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
