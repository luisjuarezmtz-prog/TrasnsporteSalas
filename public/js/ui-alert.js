/*
 * ui-alert.js — Reemplazo visual de window.alert() para todo el sitio.
 *
 * Uso:
 *   showAlert('Mensaje');                 // tipo "info" (gris/azul) por defecto
 *   showAlert('Guardado con éxito', 'success');
 *   showAlert('Error: algo falló', 'error');
 *
 * showAlert() devuelve una Promise que se resuelve cuando el aviso se cierra
 * (ya sea automáticamente o porque el usuario le dio click a la X o al fondo).
 * Esto permite, cuando hace falta esperar a que el usuario lo vea antes de
 * continuar (por ejemplo antes de redirigir o recargar la página), escribir:
 *
 *   showAlert('Registro guardado', 'success').then(() => {
 *     window.location.href = 'dashboard.html';
 *   });
 *
 * No requiere Bootstrap, Tailwind ni ninguna otra dependencia: se inyecta su
 * propio CSS una sola vez, así que basta con incluir:
 *   <script src="js/ui-alert.js"></script>
 * en cualquier página para tener showAlert() disponible.
 */
(function () {
  if (window.showAlert) return; // evita inyectar dos veces si el script se incluye por error más de una vez

  // Usa las variables de color de style.css (:root / :root[data-theme="light"])
  // con un valor de respaldo (el del tema oscuro) por si esta página no
  // cargó style.css. Así el toast y el modal de confirmación respetan el
  // interruptor de modo claro/oscuro (js/theme.js) igual que el resto del sitio.
  const ESTILOS = `
    .ui-toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 380px;
      pointer-events: none;
    }
    .ui-toast {
      pointer-events: auto;
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      background: var(--panel, #161d26);
      border: 1px solid var(--line, #2a3442);
      border-radius: 6px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.18);
      padding: 14px 16px;
      border-left: 4px solid var(--ink-dim, #8d99a8);
      opacity: 0;
      transform: translateX(30px);
      transition: opacity 0.25s ease, transform 0.25s ease;
      font-family: var(--sans, 'Inter', 'Segoe UI', Arial, sans-serif);
      overflow: hidden;
    }
    .ui-toast.ui-toast-visible {
      opacity: 1;
      transform: translateX(0);
    }
    .ui-toast.ui-toast-success { border-left-color: var(--ok, #3fa66b); }
    .ui-toast.ui-toast-error   { border-left-color: var(--bad, #d65c5c); }
    .ui-toast.ui-toast-info    { border-left-color: var(--amber, #e0a32e); }

    .ui-toast-icon {
      flex: 0 0 auto;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      font-weight: bold;
      color: #10141a;
    }
    .ui-toast-success .ui-toast-icon { background: var(--ok, #3fa66b); }
    .ui-toast-error   .ui-toast-icon { background: var(--bad, #d65c5c); }
    .ui-toast-info    .ui-toast-icon { background: var(--amber, #e0a32e); }

    .ui-toast-body {
      flex: 1 1 auto;
      font-size: 14px;
      line-height: 1.4;
      color: var(--ink, #e7ecf2);
      white-space: pre-line;
      word-break: break-word;
      padding-right: 10px;
    }
    .ui-toast-close {
      flex: 0 0 auto;
      background: transparent;
      border: none;
      color: var(--ink-dim, #8d99a8);
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      padding: 0;
      margin-left: 4px;
    }
    .ui-toast-close:hover { color: var(--ink, #e7ecf2); }

    .ui-toast-bar {
      position: absolute;
      left: 0; bottom: 0;
      height: 3px;
      background: rgba(141, 153, 168, 0.35);
      width: 100%;
      transform-origin: left;
      animation: ui-toast-shrink linear forwards;
    }
    .ui-toast-success .ui-toast-bar { background: rgba(63, 166, 107, 0.4); }
    .ui-toast-error   .ui-toast-bar { background: rgba(214, 92, 92, 0.4); }
    .ui-toast-info    .ui-toast-bar { background: rgba(224, 163, 46, 0.4); }

    @keyframes ui-toast-shrink {
      from { transform: scaleX(1); }
      to   { transform: scaleX(0); }
    }

    @media (max-width: 480px) {
      .ui-toast-container { left: 12px; right: 12px; max-width: none; }
    }

    .ui-confirm-overlay {
      position: fixed;
      inset: 0;
      background: rgba(9, 12, 16, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100000;
      opacity: 0;
      transition: opacity 0.18s ease;
      font-family: var(--sans, 'Inter', 'Segoe UI', Arial, sans-serif);
    }
    .ui-confirm-overlay.ui-confirm-visible { opacity: 1; }
    .ui-confirm-box {
      background: var(--panel, #161d26);
      border: 1px solid var(--line, #2a3442);
      border-radius: 8px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
      width: 90%;
      max-width: 400px;
      padding: 22px 24px;
      transform: scale(0.95) translateY(10px);
      transition: transform 0.18s ease;
    }
    .ui-confirm-overlay.ui-confirm-visible .ui-confirm-box {
      transform: scale(1) translateY(0);
    }
    .ui-confirm-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: var(--amber, #e0a32e);
      font-family: var(--mono, 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid var(--line, #2a3442);
      padding-bottom: 8px;
    }
    .ui-confirm-message {
      font-size: 14px;
      color: var(--ink, #e7ecf2);
      line-height: 1.5;
      white-space: pre-line;
      margin-bottom: 20px;
    }
    .ui-confirm-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    .ui-confirm-btn {
      border: 1px solid var(--line, #2a3442);
      border-radius: 5px;
      padding: 9px 16px;
      font-size: 12.5px;
      font-family: var(--mono, 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace);
      text-transform: uppercase;
      letter-spacing: .04em;
      font-weight: 600;
      cursor: pointer;
      transition: filter 0.15s ease;
    }
    .ui-confirm-btn:hover { filter: brightness(1.15); }
    .ui-confirm-cancel { background: transparent; color: var(--ink, #e7ecf2); }
    .ui-confirm-accept { background: var(--amber, #e0a32e); color: #10141a; border-color: var(--amber, #e0a32e); }
    .ui-confirm-accept.ui-confirm-danger { background: var(--bad, #d65c5c); border-color: var(--bad, #d65c5c); color: #10141a; }
    .ui-confirm-accept.ui-confirm-success { background: var(--ok, #3fa66b); border-color: var(--ok, #3fa66b); color: #10141a; }
  `;

  const styleTag = document.createElement('style');
  styleTag.setAttribute('data-ui-alert', 'true');
  styleTag.textContent = ESTILOS;
  document.head.appendChild(styleTag);

  let container = null;
  function getContainer() {
    if (!container || !document.body.contains(container)) {
      container = document.createElement('div');
      container.className = 'ui-toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  const ICONOS = { success: '✓', error: '✕', info: 'i' };
  const DURACION_MS = 4000;

  function escaparHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  /**
   * Muestra un aviso tipo "toast" en la esquina superior derecha.
   * @param {string} message  Texto a mostrar (se escapa automáticamente).
   * @param {'success'|'error'|'info'} type
   * @param {number} [duracionMs]  Tiempo antes de auto-cerrarse.
   * @returns {Promise<void>} se resuelve cuando el aviso se cierra.
   */
  window.showAlert = function showAlert(message, type, duracionMs) {
    type = (type === 'success' || type === 'error') ? type : 'info';
    duracionMs = duracionMs || DURACION_MS;

    return new Promise((resolve) => {
      const toast = document.createElement('div');
      toast.className = `ui-toast ui-toast-${type}`;
      toast.innerHTML = `
        <div class="ui-toast-icon">${ICONOS[type]}</div>
        <div class="ui-toast-body">${escaparHtml(message)}</div>
        <button type="button" class="ui-toast-close" aria-label="Cerrar">&times;</button>
        <div class="ui-toast-bar" style="animation-duration:${duracionMs}ms;"></div>
      `;

      let cerrado = false;
      function cerrar() {
        if (cerrado) return;
        cerrado = true;
        toast.classList.remove('ui-toast-visible');
        toast.style.opacity = '0';
        setTimeout(() => {
          toast.remove();
          resolve();
        }, 220);
      }

      toast.querySelector('.ui-toast-close').addEventListener('click', cerrar);
      const timer = setTimeout(cerrar, duracionMs);
      toast.addEventListener('mouseenter', () => clearTimeout(timer));

      getContainer().appendChild(toast);
      // Forzar reflow para que la transición de entrada se anime
      requestAnimationFrame(() => toast.classList.add('ui-toast-visible'));
    });
  };

  /**
   * Reemplazo visual de window.confirm(). Muestra un modal centrado con
   * botón Cancelar/Aceptar y devuelve una Promise<boolean> (true si el
   * usuario aceptó, false si canceló o cerró el modal).
   *
   * Uso:
   *   const ok = await showConfirm('¿Eliminar este registro?');
   *   if (!ok) return;
   *
   *   showConfirm('¿Autorizar 3 registros?', { type: 'success', confirmText: 'Autorizar' })
   *     .then(ok => { if (ok) hacerAlgo(); });
   *
   * @param {string} message
   * @param {{type?: 'primary'|'success'|'danger', title?: string, confirmText?: string, cancelText?: string}} [opts]
   * @returns {Promise<boolean>}
   */
  window.showConfirm = function showConfirm(message, opts) {
    opts = opts || {};
    const type = ['success', 'danger'].includes(opts.type) ? opts.type : 'primary';
    const title = opts.title || 'Confirmar acción';
    const confirmText = opts.confirmText || 'Aceptar';
    const cancelText = opts.cancelText || 'Cancelar';

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'ui-confirm-overlay';
      overlay.innerHTML = `
        <div class="ui-confirm-box">
          <div class="ui-confirm-title">${escaparHtml(title)}</div>
          <div class="ui-confirm-message">${escaparHtml(message)}</div>
          <div class="ui-confirm-actions">
            <button type="button" class="ui-confirm-btn ui-confirm-cancel">${escaparHtml(cancelText)}</button>
            <button type="button" class="ui-confirm-btn ui-confirm-accept ui-confirm-${type}">${escaparHtml(confirmText)}</button>
          </div>
        </div>
      `;

      let resuelto = false;
      function cerrar(valor) {
        if (resuelto) return;
        resuelto = true;
        overlay.classList.remove('ui-confirm-visible');
        setTimeout(() => {
          overlay.remove();
          resolve(valor);
        }, 160);
      }

      overlay.querySelector('.ui-confirm-cancel').addEventListener('click', () => cerrar(false));
      overlay.querySelector('.ui-confirm-accept').addEventListener('click', () => cerrar(true));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(false); });
      document.addEventListener('keydown', function escListener(e) {
        if (e.key === 'Escape') { cerrar(false); document.removeEventListener('keydown', escListener); }
      });

      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('ui-confirm-visible'));
    });
  };
})();
