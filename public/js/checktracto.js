// js/checktracto.js — Check de Unidad (Tracto Camión), FORM-CTC-01
//
// Mismo comportamiento que app.js (el check de la caja seca): marcas
// georreferenciadas sobre diagramas SVG y tabla de estados. La
// diferencia es que aquí los puntos a revisar van agrupados por vista,
// y esa lista NO se copia aquí: se pide a /api/trailer-checks/catalogo
// para que exista en un solo lugar (utils/checkTracto.js).
'use strict';

const TIPO_LABEL = { RASPONES: 'RA', GOLPES: 'GO', ABOLLADURAS: 'AB', PERFORACIONES: 'PE', OTROS: 'OT' };

let catalogo = null;
let marcas = [];
let editingId = null;

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// Las fechas llegan como ISO; sin corregir la zona se recorren un día.
function aValorDeInput(valor) {
  if (!valor) return '';
  const d = new Date(valor);
  if (isNaN(d.getTime())) return '';
  d.setMinutes(d.getMinutes() + d.getTimezoneOffset());
  return d.toISOString().split('T')[0];
}

function formatoFecha(valor) {
  const iso = aValorDeInput(valor);
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

const ETIQUETA_ESTADO_GENERAL = {
  SIN_DANOS: 'Sin daños',
  CON_DANOS: 'Con daños',
  NO_APLICA: 'No aplica',
};

// ── Puntos a revisar ─────────────────────────────────────────
// Se pinta una tabla por vista, con los puntos que el formato define
// para esa vista. El id de cada control lleva vista + índice, que es
// como se vuelven a leer al guardar.
function renderPuntos() {
  const cont = document.getElementById('contenedorPuntos');
  cont.innerHTML = '';

  catalogo.vistas.forEach(vista => {
    const puntos = catalogo.componentesPorVista[vista] || [];

    const bloque = document.createElement('div');
    bloque.style.marginBottom = '22px';
    bloque.innerHTML = `
      <h3 style="font-family:var(--mono);font-size:11.5px;text-transform:uppercase;color:var(--amber);
                 border-bottom:1px solid var(--line);padding-bottom:6px;margin:0 0 10px;">
        ${escapeHtml(catalogo.vistaLabel[vista])}
      </h3>
      <table>
        <thead><tr><th>Punto</th><th style="width:280px;">Estado</th><th>Observaciones</th></tr></thead>
        <tbody>
          ${puntos.map((punto, i) => `
            <tr>
              <td>${escapeHtml(punto)}</td>
              <td><div class="estado-group">
                ${catalogo.estados.map(estado => `
                  <label class="radio">
                    <input type="radio" name="pt-${vista}-${i}" value="${estado}">
                    ${estado.charAt(0) + estado.slice(1).toLowerCase()}
                  </label>`).join('')}
              </div></td>
              <td><input type="text" class="obs-input" data-obs="${vista}-${i}" placeholder="Observaciones"></td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    cont.appendChild(bloque);
  });
}

function recolectarPuntos() {
  const resultado = [];
  catalogo.vistas.forEach(vista => {
    (catalogo.componentesPorVista[vista] || []).forEach((punto, i) => {
      const estadoEl = document.querySelector(`input[name="pt-${vista}-${i}"]:checked`);
      if (!estadoEl) return; // punto no revisado: no se guarda
      resultado.push({
        vista,
        componente: punto,
        estado: estadoEl.value,
        observaciones: document.querySelector(`input[data-obs="${vista}-${i}"]`).value || null,
      });
    });
  });
  return resultado;
}

// ── Marcas sobre los diagramas ───────────────────────────────
function initVistas() {
  document.querySelectorAll('.view-wrap').forEach(wrap => {
    wrap.addEventListener('click', ev => {
      if (ev.target.closest('.popover') || ev.target.closest('.mark')) return;
      const rect = wrap.getBoundingClientRect();
      abrirPopover(wrap,
        ((ev.clientX - rect.left) / rect.width) * 100,
        ((ev.clientY - rect.top) / rect.height) * 100
      );
    });
  });
}

function abrirPopover(wrap, xPct, yPct) {
  cerrarPopovers();
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.style.visibility = 'hidden';
  pop.style.left = '0';
  pop.style.top = '0';
  pop.innerHTML = `
    <label style="display:block;margin-bottom:4px;">Tipo de daño</label>
    <select class="pop-tipo">${catalogo.tiposDano.map(t => `<option value="${t}">${t}</option>`).join('')}</select>
    <input type="text" class="pop-desc" placeholder="Descripción breve">
    <div class="pop-actions">
      <button type="button" class="pop-cancel">Cancelar</button>
      <button type="button" class="primary pop-save">Marcar</button>
    </div>`;
  wrap.appendChild(pop);
  posicionarPopover(wrap, pop, xPct, yPct);

  pop.querySelector('.pop-cancel').addEventListener('click', () => pop.remove());
  pop.querySelector('.pop-save').addEventListener('click', () => {
    const marca = {
      vista: wrap.dataset.vista,
      x: xPct,
      y: yPct,
      tipoDano: pop.querySelector('.pop-tipo').value,
      descripcion: pop.querySelector('.pop-desc').value,
    };
    marcas.push(marca);
    pintarMarca(wrap, marca, marcas.length - 1);
    pop.remove();
  });
}

function posicionarPopover(wrap, pop, xPct, yPct) {
  const wW = wrap.clientWidth, wH = wrap.clientHeight;
  const pW = pop.offsetWidth, pH = pop.offsetHeight;
  const m = 6;
  let left = (xPct / 100) * wW - pW / 2;
  let top = (yPct / 100) * wH + 10;
  left = Math.max(m, Math.min(left, wW - m - pW));
  if (top + pH > wH - m) top = (yPct / 100) * wH - pH - 10;
  if (top < m) top = m;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  pop.style.visibility = 'visible';
}

async function pintarMarca(wrap, marca, idx) {
  const el = document.createElement('div');
  el.className = `mark ${marca.tipoDano}`;
  el.style.left = marca.x + '%';
  el.style.top = marca.y + '%';
  el.title = `${marca.tipoDano}: ${marca.descripcion || ''}`;
  el.textContent = TIPO_LABEL[marca.tipoDano];
  el.addEventListener('click', async ev => {
    ev.stopPropagation();
    if (await showConfirm('¿Eliminar esta marca?', { type: 'danger', title: 'Eliminar marca' })) {
      marcas[idx] = null;
      el.remove();
    }
  });
  wrap.appendChild(el);
}

function cerrarPopovers() {
  document.querySelectorAll('.popover').forEach(p => p.remove());
}

function repintarMarcas() {
  document.querySelectorAll('.mark').forEach(m => m.remove());
  marcas.forEach((m, idx) => {
    if (!m) return;
    const wrap = document.querySelector(`.view-wrap[data-vista="${m.vista}"]`);
    if (wrap) pintarMarca(wrap, m, idx);
  });
}

// ── Catálogo de unidades ─────────────────────────────────────
async function cargarUnidades() {
  try {
    const res = await fetch('/api/trailers');
    const lista = await res.json();
    const select = document.getElementById('idTrailer');
    lista.forEach(t => {
      const option = document.createElement('option');
      option.value = t.ID_TRAILER;
      option.dataset.placas = t.PLACAS;
      option.textContent = t.NAME;
      select.appendChild(option);
    });
  } catch (error) {
    console.error('Error al cargar unidades:', error);
  }
}

// Al elegir una unidad del catálogo, las placas se toman de ahí y el
// campo manual se bloquea para que no queden dos valores distintos.
function sincronizarPlacas() {
  const select = document.getElementById('idTrailer');
  const input = document.getElementById('unidadPlacas');
  const opcion = select.selectedOptions[0];

  if (select.value) {
    input.value = opcion.dataset.placas || '';
    input.readOnly = true;
  } else {
    input.readOnly = false;
  }
}

// ── Guardar / cargar ─────────────────────────────────────────
function leerFormulario() {
  const estadoEl = document.querySelector('input[name="estadoGeneral"]:checked');
  return {
    idTrailer: document.getElementById('idTrailer').value || null,
    fecha: document.getElementById('fecha').value,
    unidadPlacas: document.getElementById('unidadPlacas').value.trim(),
    operador: document.getElementById('operador').value.trim(),
    origenDestino: document.getElementById('origenDestino').value.trim(),
    estadoGeneral: estadoEl ? estadoEl.value : null,
    observaciones: document.getElementById('observaciones').value.trim(),
    usuario: localStorage.getItem('username') || 'Sistema',
    componentes: recolectarPuntos(),
    marcas: marcas.filter(Boolean),
  };
}

async function guardarCheck() {
  const datos = leerFormulario();

  if (!datos.fecha) return showAlert('Captura la fecha del check.', 'info');
  if (!datos.unidadPlacas) return showAlert('Selecciona una unidad o captura las placas.', 'info');

  try {
    const res = await fetch(editingId ? `/api/trailer-checks/${editingId}` : '/api/trailer-checks', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    const json = await res.json();

    if (!json.success) return showAlert(json.message || 'No se pudo guardar el check.', 'error');

    showAlert(json.message, 'success');
    if (!editingId) editingId = json.id_check;
    buscarChecks();
  } catch (error) {
    console.error('Error al guardar el check:', error);
    showAlert('Error de conexión al guardar el check.', 'error');
  }
}

function limpiarFormulario() {
  editingId = null;
  marcas = [];
  document.getElementById('editId').value = '';
  ['fecha', 'unidadPlacas', 'operador', 'origenDestino', 'observaciones'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('idTrailer').value = '';
  document.getElementById('unidadPlacas').readOnly = false;
  document.querySelectorAll('input[name="estadoGeneral"]').forEach(r => { r.checked = false; });
  document.querySelectorAll('#contenedorPuntos input[type="radio"]').forEach(r => { r.checked = false; });
  document.querySelectorAll('#contenedorPuntos .obs-input').forEach(i => { i.value = ''; });
  document.querySelectorAll('.mark').forEach(m => m.remove());
  document.getElementById('fecha').value = new Date().toISOString().split('T')[0];
}

async function cargarCheck(id) {
  try {
    const res = await fetch(`/api/trailer-checks/${id}`);
    const json = await res.json();
    if (!json.success) return showAlert(json.message || 'No se pudo cargar el check.', 'error');

    limpiarFormulario();
    const d = json.data;
    editingId = id;

    document.getElementById('editId').value = id;
    document.getElementById('fecha').value = aValorDeInput(d.FECHA);
    document.getElementById('idTrailer').value = d.ID_TRAILER || '';
    document.getElementById('unidadPlacas').value = d.UNIDAD_PLACAS || '';
    document.getElementById('operador').value = d.OPERADOR || '';
    document.getElementById('origenDestino').value = d.ORIGEN_DESTINO || '';
    document.getElementById('observaciones').value = d.OBSERVACIONES || '';
    sincronizarPlacas();

    if (d.ESTADO_GENERAL) {
      const radio = document.querySelector(`input[name="estadoGeneral"][value="${d.ESTADO_GENERAL}"]`);
      if (radio) radio.checked = true;
    }

    (d.componentes || []).forEach(c => {
      const puntos = catalogo.componentesPorVista[c.VISTA] || [];
      const i = puntos.indexOf(c.COMPONENTE);
      if (i === -1) return;
      const radio = document.querySelector(`input[name="pt-${c.VISTA}-${i}"][value="${c.ESTADO}"]`);
      if (radio) radio.checked = true;
      const obs = document.querySelector(`input[data-obs="${c.VISTA}-${i}"]`);
      if (obs) obs.value = c.OBSERVACIONES || '';
    });

    marcas = (d.marcas || []).map(m => ({
      vista: m.VISTA,
      x: Number(m.POS_X),
      y: Number(m.POS_Y),
      tipoDano: m.TIPO_DANO,
      descripcion: m.DESCRIPCION || '',
    }));
    repintarMarcas();

    showAlert('Check cargado para edición.', 'success');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    console.error('Error al cargar el check:', error);
    showAlert('Error de conexión al cargar el check.', 'error');
  }
}

async function eliminarCheck(id) {
  const ok = await showConfirm('¿Eliminar este check y todo su detalle?', { type: 'danger', title: 'Eliminar check' });
  if (!ok) return;

  try {
    const res = await fetch(`/api/trailer-checks/${id}`, { method: 'DELETE' });
    const json = await res.json();
    showAlert(json.message, json.success ? 'success' : 'error');
    if (json.success) {
      if (String(editingId) === String(id)) limpiarFormulario();
      buscarChecks();
    }
  } catch (error) {
    console.error('Error al eliminar el check:', error);
    showAlert('Error de conexión al eliminar el check.', 'error');
  }
}

// ── Listado ──────────────────────────────────────────────────
async function buscarChecks() {
  const tbody = document.getElementById('tablaChecks');
  tbody.innerHTML = '<tr><td colspan="7" class="text-center hint">Buscando...</td></tr>';

  const params = new URLSearchParams();
  const desde = document.getElementById('filtroFechaInicio').value;
  const hasta = document.getElementById('filtroFechaFin').value;
  const unidad = document.getElementById('filtroUnidad').value.trim();
  if (desde && hasta) { params.set('fechaInicio', desde); params.set('fechaFin', hasta); }
  if (unidad) params.set('unidad', unidad);

  try {
    const res = await fetch(`/api/trailer-checks?${params.toString()}`);
    const json = await res.json();

    if (!json.success || json.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center hint">No se encontraron checks.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    json.data.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatoFecha(c.FECHA)}</td>
        <td style="font-family:var(--mono);">${escapeHtml(c.UNIDAD_PLACAS || '—')}${c.NO_ECONOMICO ? `<span class="hint" style="display:block;">${escapeHtml(c.NO_ECONOMICO)}</span>` : ''}</td>
        <td>${escapeHtml(c.OPERADOR || '—')}</td>
        <td>${escapeHtml(c.ORIGEN_DESTINO || '—')}</td>
        <td>${c.ESTADO_GENERAL ? `<span class="badge ${c.ESTADO_GENERAL === 'CON_DANOS' ? 'badge-warn' : 'badge-muted'}">${ETIQUETA_ESTADO_GENERAL[c.ESTADO_GENERAL]}</span>` : '—'}</td>
        <td class="text-center">${c.TOTAL_DANOS || 0}</td>
        <td class="text-center">
          <button class="ghost" title="Editar" onclick="cargarCheck(${c.ID_CHECK})">✏️</button>
          <button class="ghost" title="Eliminar" onclick="eliminarCheck(${c.ID_CHECK})">🗑️</button>
        </td>`;
      tbody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error al buscar checks:', error);
    tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:var(--bad);">Error al conectar con el servidor.</td></tr>';
  }
}

// ── Arranque ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/trailer-checks/catalogo');
    catalogo = await res.json();
    if (!catalogo.success) throw new Error('Catálogo no disponible');
  } catch (error) {
    console.error('Error al cargar el catálogo del check:', error);
    document.getElementById('contenedorPuntos').innerHTML =
      '<p class="hint" style="color:var(--bad);">No se pudo cargar el catálogo de puntos a revisar.</p>';
    return;
  }

  renderPuntos();
  initVistas();
  await cargarUnidades();
  limpiarFormulario();

  document.getElementById('idTrailer').addEventListener('change', sincronizarPlacas);
  document.getElementById('btnGuardar').addEventListener('click', guardarCheck);
  document.getElementById('btnLimpiar').addEventListener('click', limpiarFormulario);
  document.getElementById('btnNuevo').addEventListener('click', limpiarFormulario);
  document.getElementById('btnBuscar').addEventListener('click', buscarChecks);

  buscarChecks();
});
