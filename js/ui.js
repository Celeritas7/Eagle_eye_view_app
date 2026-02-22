// ============================================================
// Eagle Eye Tree - UI Utilities (v3.2)
// ============================================================

export function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.background = type === 'error' ? '#ef4444' : '#10b981';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}
