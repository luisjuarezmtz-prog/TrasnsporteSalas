/*
 * theme.js — Interruptor de modo claro/oscuro para todo el sitio.
 *
 * Cómo funciona:
 * 1. En cuanto se ejecuta (debe incluirse lo antes posible en <head>,
 *    idealmente antes de los <link> de CSS) aplica el tema guardado en
 *    localStorage poniendo el atributo data-theme="light"|"dark" en <html>.
 *    Esto evita el "parpadeo" del tema incorrecto al cargar la página.
 * 2. Todas las variables de color viven en style.css (:root y
 *    :root[data-theme="light"]), así que con solo cambiar ese atributo
 *    toda la app (paneles, tablas, botones, toasts, modales) cambia de
 *    tema sin tocar el resto del CSS.
 * 3. Inyecta un botón flotante (🌙/☀️) en la esquina inferior derecha para
 *    que el usuario pueda alternar el tema en cualquier página. El botón
 *    se agrega solo con incluir este script; no requiere marcado en el HTML.
 *
 * Uso: <script src="js/theme.js"></script>  (en <head>, antes de los CSS)
 */
(function () {
  const CLAVE = 'ts_theme';

  function obtenerTemaGuardado() {
    try {
      return localStorage.getItem(CLAVE);
    } catch (e) {
      return null;
    }
  }

  function guardarTema(valor) {
    try {
      localStorage.setItem(CLAVE, valor);
    } catch (e) { /* localStorage no disponible: no pasa nada, solo no persiste */ }
  }

  // 1. Aplicar el tema guardado (o "light" por defecto) lo antes posible.
  const temaInicial = obtenerTemaGuardado() === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', temaInicial);

  function aplicarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema);
    guardarTema(tema);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) actualizarBoton(btn, tema);
  }

  function actualizarBoton(btn, tema) {
    const esClaro = tema === 'light';
    btn.textContent = esClaro ? '🌙' : '☀️';
    btn.setAttribute('aria-label', esClaro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
    btn.title = esClaro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
  }

  function inyectarEstilos() {
    if (document.getElementById('theme-toggle-style')) return;
    const style = document.createElement('style');
    style.id = 'theme-toggle-style';
    style.textContent = `
      #theme-toggle-btn {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 99998;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 1px solid var(--line, #2a3442);
        background: var(--panel, #161d26);
        color: var(--ink, #e7ecf2);
        font-size: 19px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 6px 18px rgba(0,0,0,.3);
        transition: transform .15s ease, background-color .15s ease, color .15s ease;
        padding: 0;
      }
      #theme-toggle-btn:hover { transform: scale(1.08); }
      @media (max-width: 480px) {
        #theme-toggle-btn { bottom: 14px; right: 14px; width: 40px; height: 40px; font-size: 17px; }
      }
    `;
    document.head.appendChild(style);
  }

  function crearBoton() {
    if (document.getElementById('theme-toggle-btn')) return;
    inyectarEstilos();

    const btn = document.createElement('button');
    btn.id = 'theme-toggle-btn';
    btn.type = 'button';
    actualizarBoton(btn, document.documentElement.getAttribute('data-theme') || 'dark');

    btn.addEventListener('click', () => {
      const actual = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      aplicarTema(actual);
    });

    document.body.appendChild(btn);
  }

  // 2. El botón flotante necesita <body>; si el script corre en <head>
  // (recomendado, para evitar el parpadeo), esperamos a que el DOM esté listo.
  if (document.body) {
    crearBoton();
  } else {
    document.addEventListener('DOMContentLoaded', crearBoton);
  }
})();
