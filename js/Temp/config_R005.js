// ============================================================
// Eagle Eye Tree - Configuration (v3.2)
// ============================================================

export const SUPABASE_URL = 'https://wylxvmkcrexwfpjpbhyy.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5bHh2bWtjcmV4d2ZwanBiaHl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2MzkxMDYsImV4cCI6MjA4NDIxNTEwNn0.6Bxo42hx4jwlJGWnfjiTpiDUsYfc1QLTN3YtrU1efak';

export const TABLES = {
  assy: 'eagle_eye_app_assemblies',
  grp: 'eagle_eye_app_groups',
  step: 'eagle_eye_app_steps',
  part: 'eagle_eye_app_parts',
  fast: 'eagle_eye_app_fasteners',
  slink: 'eagle_eye_app_step_links',
  master: 'master_parts_list_all'
};

// Level Colors
export const LEVEL_COLORS = [
  '#66bb6a', '#42a5f5', '#ab47bc', '#ef5350',
  '#ffa726', '#26c6da', '#ec407a', '#78909c'
];

export const LEVEL_SHAPES = [
  'stadium', 'hexagon', 'rounded_rectangle', 'diamond',
  'octagon', 'stadium', 'rounded_rectangle', 'rounded_rectangle'
];

export const LEVEL_FONT_SIZES = [13, 12, 12, 11, 11, 12, 10, 10];
export const LEVEL_FONT_WEIGHTS = [700, 600, 600, 500, 500, 700, 400, 400];
export const LEVEL_HORIZONTAL_GAPS = [280, 260, 240, 220, 200, 180, 160];

export function getLevelGap(index) {
  return index < LEVEL_HORIZONTAL_GAPS.length ? LEVEL_HORIZONTAL_GAPS[index] : 160;
}

// Status dot colors
export const STATUS_COLORS = {
  step: { fill: '#95a5a6' }, prep: { fill: '#f39c12' },
  kanryo: { fill: '#27ae60' }, note: { fill: '#3498db' }
};

// Fastener link colors
export const FASTENER_COLORS = {
  CBE: '#3498db', CBST: '#9b59b6', CSH: '#27ae60',
  MS: '#e67e22', BSB: '#e74c3c', default: '#888'
};

export function getFastenerColor(pn) {
  if (!pn) return FASTENER_COLORS.default;
  const p = pn.toUpperCase();
  for (const [prefix, color] of Object.entries(FASTENER_COLORS)) {
    if (prefix !== 'default' && p.startsWith(prefix)) return color;
  }
  return FASTENER_COLORS.default;
}

// ECN
export const ECN_COLORS = { remove: '#ef4444', replace: '#f59e0b', add: '#10b981', modify: '#3b82f6', affected: '#f97316' };
export const ECN_ICONS = { remove: '✕', replace: '↻', add: '+', modify: '~', affected: '⚠️' };

// Node dimensions
export const NODE_WIDTH = 150;
export const NODE_HEIGHT = 38;
export const PART_NODE_WIDTH = 120;
export const PART_NODE_HEIGHT = 32;
export const VERTICAL_GAP = 80;  // increased from 65 for better spacing
export const GROUP_GAP = 50;

// Helpers
export function getLevelColor(idx) { return LEVEL_COLORS[Math.min(idx, LEVEL_COLORS.length - 1)]; }
export function getLevelShape(idx) { return LEVEL_SHAPES[Math.min(idx, LEVEL_SHAPES.length - 1)]; }
export function getLevelFontSize(idx) { return LEVEL_FONT_SIZES[Math.min(idx, LEVEL_FONT_SIZES.length - 1)]; }
export function getLevelFontWeight(idx) { return LEVEL_FONT_WEIGHTS[Math.min(idx, LEVEL_FONT_WEIGHTS.length - 1)]; }

export function darkenColor(hex, pct) {
  let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  r = Math.floor(r * (1 - pct / 100)); g = Math.floor(g * (1 - pct / 100)); b = Math.floor(b * (1 - pct / 100));
  return '#' + [r, g, b].map(c => Math.max(0, c).toString(16).padStart(2, '0')).join('');
}

export function lightenColor(hex, pct) {
  let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  r = Math.min(255, Math.floor(r + (255 - r) * pct / 100));
  g = Math.min(255, Math.floor(g + (255 - g) * pct / 100));
  b = Math.min(255, Math.floor(b + (255 - b) * pct / 100));
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}
