// ============================================================
// Eagle Eye Tree - UI Utilities
// ============================================================

export function showToast(msg, type = 'ok') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'toast';
  el.style.background = type === 'error' ? '#ef4444' : '#10b981';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}
