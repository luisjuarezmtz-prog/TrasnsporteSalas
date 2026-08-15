// app.js — Check de Caja Seca
'use strict';

// ── Catálogos ────────────────────────────────────────────────
const POSICIONES_LLANTAS = [
  'DELANTERA IZQ.','DELANTERA DER.',
  '1ER EJE IZQ. (INT.)','1ER EJE IZQ. (EXT.)',
  '1ER EJE DER. (INT.)','1ER EJE DER. (EXT.)',
  '2DO EJE IZQ. (INT.)','2DO EJE IZQ. (EXT.)',
  '2DO EJE DER. (INT.)','2DO EJE DER. (EXT.)',
  'LLANTA DE REFACCIÓN'
];
const COMPONENTES = [
  'PISO','PAREDES','TECHO','PUERTAS TRASERAS','HERRAJES PUERTAS',
  'SELLOS / EMPAQUES','DEFENSAS LATERALES','DEFENSA TRASERA',
  'LUCES','REFLECTANTES','SOPORTES / PATAS','OTROS'
];
const TIPOS_DANO   = ['RASPONES','GOLPES','ABOLLADURAS','PERFORACIONES','OTROS'];
const TIPO_LABEL   = {RASPONES:'RA',GOLPES:'GO',ABOLLADURAS:'AB',PERFORACIONES:'PE',OTROS:'OT'};
const COLORES_DANO = {RASPONES:'#e0a32e',GOLPES:'#d65c5c',ABOLLADURAS:'#6f9fd6',PERFORACIONES:'#b85cd6',OTROS:'#8d99a8'};
const VISTA_LABEL  = {
  LATERAL_IZQUIERDA:'Vista lateral izquierda',LATERAL_DERECHA:'Vista lateral derecha',
  TRASERA:'Vista trasera',FRONTAL:'Vista frontal',TECHO:'Vista superior (techo)'
};

// ── Estado global ────────────────────────────────────────────
let marcas    = [];
let editingId = null;

// ── Acordeón ────────────────────────────────────────────────
function initAcordeon() {
  document.querySelectorAll('.panel').forEach(panel => {
    if (panel.dataset.collapsible === 'false') return;
    const h2 = panel.querySelector('h2');
    if (!h2) return;
    const body = document.createElement('div');
    body.className = 'panel-body';
    [...panel.children].forEach(c => { if (c !== h2) body.appendChild(c); });
    panel.appendChild(body);
    panel.classList.add('collapsible');
    if (panel.id !== 'panelDatosGenerales') panel.classList.add('collapsed');
    h2.addEventListener('click', () => panel.classList.toggle('collapsed'));
  });
}

// ── Tabla de llantas ─────────────────────────────────────────
function renderTablaLlantas() {
  const tbody = document.querySelector('#tablaLlantas tbody');
  tbody.innerHTML = '';
  POSICIONES_LLANTAS.forEach((pos, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${pos}</td>
      <td><input type="text" value="1" style="width:40px" data-cant-idx="${i}"></td>
      <td><div class="estado-group">
        <label class="radio"><input type="radio" name="llanta-estado-${i}" value="BUENO"> Bueno</label>
        <label class="radio"><input type="radio" name="llanta-estado-${i}" value="REGULAR"> Regular</label>
        <label class="radio"><input type="radio" name="llanta-estado-${i}" value="MALO"> Malo</label>
      </div></td>
      <td><input type="text" class="obs-input" data-obs-idx="${i}" placeholder="Observaciones"></td>`;
    tbody.appendChild(tr);
  });
}
function recolectarLlantas() {
  return POSICIONES_LLANTAS.map((pos, i) => {
    const estadoEl = document.querySelector(`input[name="llanta-estado-${i}"]:checked`);
    return {
      posicion: pos,
      cantidad: parseInt(document.querySelector(`input[data-cant-idx="${i}"]`).value)||1,
      estado:   estadoEl ? estadoEl.value : null,
      observaciones: document.querySelector(`input[data-obs-idx="${i}"]`).value||null
    };
  }).filter(l => l.estado);
}

// ── Tabla de componentes ─────────────────────────────────────
function renderTablaComponentes() {
  const tbody = document.querySelector('#tablaComponentes tbody');
  tbody.innerHTML = '';
  COMPONENTES.forEach((comp, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${comp}</td>
      <td><div class="estado-group">
        <label class="radio"><input type="radio" name="comp-estado-${i}" value="BUENO"> Bueno</label>
        <label class="radio"><input type="radio" name="comp-estado-${i}" value="REGULAR"> Regular</label>
        <label class="radio"><input type="radio" name="comp-estado-${i}" value="MALO"> Malo</label>
      </div></td>
      <td><input type="text" class="obs-input" data-comp-obs-idx="${i}" placeholder="Observaciones"></td>`;
    tbody.appendChild(tr);
  });
}
function recolectarComponentes() {
  return COMPONENTES.map((comp, i) => {
    const estadoEl = document.querySelector(`input[name="comp-estado-${i}"]:checked`);
    return {
      componente: comp, estado: estadoEl ? estadoEl.value : null,
      observaciones: document.querySelector(`input[data-comp-obs-idx="${i}"]`).value||null
    };
  }).filter(c => c.estado);
}

// ── Marcas sobre vistas SVG ──────────────────────────────────
function initVistas() {
  document.querySelectorAll('.view-wrap').forEach(wrap => {
    wrap.addEventListener('click', ev => {
      if (ev.target.closest('.popover') || ev.target.closest('.mark')) return;
      const rect = wrap.getBoundingClientRect();
      abrirPopover(wrap,
        ((ev.clientX - rect.left) / rect.width)  * 100,
        ((ev.clientY - rect.top)  / rect.height) * 100
      );
    });
  });
}
function abrirPopover(wrap, xPct, yPct) {
  cerrarPopovers();
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.style.visibility = 'hidden';
  pop.style.left = '0'; pop.style.top = '0';
  pop.innerHTML = `
    <label style="display:block;margin-bottom:4px;">Tipo de daño</label>
    <select class="pop-tipo">${TIPOS_DANO.map(t=>`<option value="${t}">${t}</option>`).join('')}</select>
    <input type="text" class="pop-desc" placeholder="Descripción breve">
    <div class="pop-actions">
      <button type="button" class="pop-cancel">Cancelar</button>
      <button type="button" class="primary pop-save">Marcar</button>
    </div>`;
  wrap.appendChild(pop);
  posicionarPopover(wrap, pop, xPct, yPct);
  pop.querySelector('.pop-cancel').addEventListener('click', () => pop.remove());
  pop.querySelector('.pop-save').addEventListener('click', () => {
    const tipoDano    = pop.querySelector('.pop-tipo').value;
    const descripcion = pop.querySelector('.pop-desc').value;
    const marca = { vista: wrap.dataset.vista, x: xPct, y: yPct, tipoDano, descripcion };
    marcas.push(marca);
    pintarMarca(wrap, marca, marcas.length - 1);
    pop.remove();
  });
}
function posicionarPopover(wrap, pop, xPct, yPct) {
  const wW = wrap.clientWidth, wH = wrap.clientHeight;
  const pW = pop.offsetWidth,  pH = pop.offsetHeight;
  const m  = 6;
  let left = (xPct/100)*wW - pW/2;
  let top  = (yPct/100)*wH + 10;
  left = Math.max(m, Math.min(left, wW - m - pW));
  if (top + pH > wH - m) top = (yPct/100)*wH - pH - 10;
  if (top < m) top = m;
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
  pop.style.visibility = 'visible';
}
function pintarMarca(wrap, marca, idx) {
  const el = document.createElement('div');
  el.className = `mark ${marca.tipoDano}`;
  el.style.left = marca.x + '%'; el.style.top = marca.y + '%';
  el.title = `${marca.tipoDano}: ${marca.descripcion||''}`;
  el.textContent = TIPO_LABEL[marca.tipoDano];
  el.addEventListener('click', ev => {
    ev.stopPropagation();
    if (confirm('¿Eliminar esta marca?')) { marcas[idx] = null; el.remove(); }
  });
  wrap.appendChild(el);
}
function cerrarPopovers() { document.querySelectorAll('.popover').forEach(p => p.remove()); }

// ── Leer todos los campos fiscales/técnicos ──────────────────
function leerFiscal() {
  const v = id => document.getElementById(id)?.value || null;
  return {
    razonSocial: v('razonSocial'), rfc: v('rfc'),
    propietarioVehiculo: v('propietarioVehiculo'),
    calle: v('dCalle'), numero: v('dNumero'), colonia: v('dColonia'), cp: v('dCp'),
    domicilioFiscal: v('domicilioFiscal'),
    nivSerie: v('nivSerie'), modalidad: v('modalidad'), motor: v('motor'),
    marcaCaja: v('marcaCaja'), clase: v('clase'), combustible: v('combustible'),
    tipoCajaTransmision: v('tipoCajaTransmision'),
    pesoVehicular: v('pesoVehicular'), numEjes: v('numEjes'), numLlantas: v('numLlantas'),
    litros: v('litros'), toneladas: v('toneladas'), personas: v('personas'),
    altoM: v('altoM'), anchoM: v('anchoM'), largoM: v('largoM'),
    tipoSuspension: v('tipoSuspension'),
    ejeDireccional: v('ejeDireccional'), ejeMotriz: v('ejeMotriz'),
    ejeArrastre: v('ejeArrastre'), permisoRuta: v('permisoRuta'),
    folio: v('folioTramite'), folioSerie: v('folioSerie'),
    fechaLimiteSuspension: v('fechaLimiteSuspension'), tramite: v('tramite'),
    lugarExpedicion: v('lugarExpedicion'), fechaExpedicion: v('fechaExpedicion')
  };
}

// ── Guardar (POST o PUT) ──────────────────────────────────────
async function guardarCheck() {
  const fecha = document.getElementById('fecha').value;
  const hora  = document.getElementById('hora').value;
  if (!fecha || !hora) { toast('Fecha y hora son obligatorias', true); return; }

  const payload = {
    encabezado: {
      fecha, hora,
      noEconomico:   document.getElementById('noEconomico').value,
      placa:         document.getElementById('placa').value,
      marca:         document.getElementById('marcaCaja').value,
      modelo:        document.getElementById('modelo').value,
      tipoCaja:      document.getElementById('tipoCaja').value,
      numeroSerieVin:document.getElementById('nivSerie').value,
      clienteEmpresa:document.getElementById('clienteEmpresa').value,
      inspector:     document.getElementById('inspector').value
    },
    fiscal: leerFiscal(),
    piso: {
      tipoMaterial:    (document.querySelector('input[name="tipoMaterialPiso"]:checked')||{}).value||null,
      tipoMaterialOtro: document.getElementById('pisoMaterialOtro').value||null,
      condicion:       (document.querySelector('input[name="condicionPiso"]:checked')||{}).value||null,
      observaciones:   document.getElementById('pisoObservaciones').value||null
    },
    llantas:    recolectarLlantas(),
    componentes:recolectarComponentes(),
    marcas:     marcas.filter(Boolean),
    observacionesGenerales: document.getElementById('observacionesGenerales').value,
    notasAdicionales:       document.getElementById('notasAdicionales').value,
    dictamenGeneral: (document.querySelector('input[name="dictamenGeneral"]:checked')||{}).value||null,
    firmaInspector:  document.getElementById('firmaInspector').value
  };

  // FormData para poder adjuntar el archivo
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  const fileInput = document.getElementById('archivoTarjeta');
  if (fileInput.files[0]) fd.append('tarjetaCirculacion', fileInput.files[0]);

  try {
    const url    = editingId ? `/api/checks/${editingId}` : '/api/checks';
    const method = editingId ? 'PUT' : 'POST';
    const resp   = await fetch(url, { method, body: fd });
    const data   = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Error al guardar');
    if (!editingId) {
      editingId = data.id;
      document.getElementById('editId').value = data.id;
      document.getElementById('estadoEdicion').textContent =
        `Editando: check #${data.id} (al guardar se actualizará este registro).`;
    }
    toast(editingId ? `Check #${editingId} actualizado ✓` : `Check guardado (ID ${data.id}) ✓`, false);
    document.getElementById('btnExportarPdf').style.display = 'block';
  } catch (err) {
    console.error(err);
    toast('Error: ' + err.message, true);
  }
}

// ── Escapar texto antes de insertarlo como HTML (evita XSS almacenado) ───────
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

// ── Buscar checks ────────────────────────────────────────────
async function buscarChecks() {
  const q = document.getElementById('busqueda').value.trim();
  try {
    const url  = q ? `/api/checks?q=${encodeURIComponent(q)}` : '/api/checks';
    const resp = await fetch(url);
    const rows = await resp.json();
    const tbody = document.querySelector('#tablaBusqueda tbody');
    tbody.innerHTML = '';
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--ink-dim)">Sin resultados</td></tr>`;
    } else {
      rows.forEach(r => {
        const tr = document.createElement('tr');
        const dictClass = r.dictamen_general === 'APTO' ? 'dictamen-apto' : (r.dictamen_general === 'NO_APTO' ? 'dictamen-noapto' : '');
        tr.innerHTML = `
          <td>${escapeHtml(r.id)}</td>
          <td>${escapeHtml((r.fecha||'').substring(0,10))}</td>
          <td>${escapeHtml(r.placa||'—')}</td>
          <td>${escapeHtml(r.niv_serie||'—')}</td>
          <td>${escapeHtml(r.num_tarjeta_circulacion||'—')}</td>
          <td>${escapeHtml(r.inspector||'—')}</td>
          <td class="${dictClass}">${escapeHtml(r.dictamen_general||'—')}</td>
          <td><button class="btn-cargar-row" data-id="${escapeHtml(r.id)}">Cargar</button></td>`;
        tbody.appendChild(tr);
      });
      tbody.querySelectorAll('.btn-cargar-row').forEach(btn => {
        btn.addEventListener('click', () => cargarCheck(btn.dataset.id));
      });
    }
    document.getElementById('resultadosBusqueda').style.display = 'block';
  } catch (err) {
    toast('Error al buscar: ' + err.message, true);
  }
}

// ── Cargar check existente ───────────────────────────────────
async function cargarCheck(id) {
  try {
    const resp = await fetch(`/api/checks/${id}`);
    if (!resp.ok) throw new Error('No encontrado');
    const data = await resp.json();
    poblarFormulario(data);
    editingId = Number(id);
    document.getElementById('editId').value = id;
    document.getElementById('estadoEdicion').textContent =
      `Editando: check #${id} (al guardar se actualizará este registro).`;
    document.getElementById('resultadosBusqueda').style.display = 'none';
    // Abrir el panel de datos generales
    const panelDG = document.getElementById('panelDatosGenerales');
    if (panelDG.classList.contains('collapsed')) panelDG.classList.remove('collapsed');
    toast(`Check #${id} cargado para edición`, false);
  } catch (err) {
    toast('Error al cargar: ' + err.message, true);
  }
}

function setV(id, val) { const el = document.getElementById(id); if (el) el.value = val||''; }
function setR(name, val) {
  if (!val) return;
  const el = document.querySelector(`input[name="${name}"][value="${val}"]`);
  if (el) el.checked = true;
}

function poblarFormulario(data) {
  const c = data.check;
  setV('fecha',          (c.fecha||'').substring(0,10));
  setV('hora',           (c.hora ||'').substring(0,5));
  setV('noEconomico',    c.no_economico);
  setV('placa',          c.placa);
  setV('marcaCaja',      c.marca);          // el combo Marca de Caja guarda el campo marca
  setV('modelo',         c.modelo);
  setV('tipoCaja',       c.tipo_caja||'SECA');
  // numero_serie_vin queda unificado en el campo nivSerie
  setV('clienteEmpresa', c.cliente_empresa);
  setV('inspector',      c.inspector);
  // Fiscales
  setV('razonSocial',        c.razon_social);
  setV('rfc',                c.rfc);
  setV('propietarioVehiculo',c.propietario_vehiculo);
  setV('dCalle',             c.domicilio_calle);
  setV('dNumero',            c.domicilio_numero);
  setV('dColonia',           c.domicilio_colonia);
  setV('dCp',                c.domicilio_cp);
  setV('domicilioFiscal',    c.domicilio_fiscal);
  // Especificaciones (ya no hay eplacas ni modeloAnio — usan placa y modelo directamente)
  setV('nivSerie',        c.niv_serie);
  setV('modalidad',       c.modalidad);
  setV('motor',           c.motor);
  setV('marcaCaja',       c.marca_caja);
  setV('clase',           c.clase);
  setV('combustible',     c.combustible);
  setV('tipoCajaTransmision', c.tipo_caja_transmision);
  // Capacidades
  setV('pesoVehicular',  c.peso_vehicular);
  setV('numEjes',        c.num_ejes);
  setV('numLlantas',     c.num_llantas);
  setV('litros',         c.litros);
  setV('toneladas',      c.toneladas);
  setV('personas',       c.personas);
  setV('altoM',          c.alto_m);
  setV('anchoM',         c.ancho_m);
  setV('largoM',         c.largo_m);
  setV('tipoSuspension', c.tipo_suspension);
  // Ejes y trámite
  setV('ejeDireccional',       c.eje_direccional);
  setV('ejeMotriz',            c.eje_motriz);
  setV('ejeArrastre',          c.eje_arrastre);
  setV('permisoRuta',          c.permiso_ruta);
  setV('folioTramite',         c.folio);
  setV('folioSerie',           c.folio_serie);
  setV('fechaLimiteSuspension',(c.fecha_limite_suspension||'').substring(0,10));
  setV('tramite',              c.tramite);
  setV('lugarExpedicion',      c.lugar_expedicion);
  setV('fechaExpedicion',      (c.fecha_expedicion||'').substring(0,10));
  // Piso
  setR('tipoMaterialPiso', c.tipo_material_piso);
  setV('pisoMaterialOtro', c.tipo_material_piso_otro);
  setR('condicionPiso',    c.condicion_piso);
  setV('pisoObservaciones',c.condicion_piso_observaciones);
  // Obs / dictamen
  setV('observacionesGenerales', c.observaciones_generales);
  setV('notasAdicionales',       c.notas_adicionales);
  setR('dictamenGeneral',        c.dictamen_general);
  setV('firmaInspector',         c.firma_inspector_nombre);

  // Archivo de tarjeta de circulación
  const aDiv  = document.getElementById('archivoActual');
  const aLink = document.getElementById('archivoActualLink');
  const aNom  = document.getElementById('archivoActualNombre');
  if (c.tarjeta_circulacion_archivo) {
    aNom.textContent  = c.tarjeta_circulacion_nombre_original || c.tarjeta_circulacion_archivo;
    aLink.href        = c.tarjeta_circulacion_archivo;
    aDiv.style.display = 'flex';
  } else {
    aDiv.style.display = 'none';
  }

  // Llantas
  renderTablaLlantas();
  (data.llantas||[]).forEach(l => {
    const i = POSICIONES_LLANTAS.indexOf(l.posicion);
    if (i === -1) return;
    setR(`llanta-estado-${i}`, l.estado);
    document.querySelector(`input[data-cant-idx="${i}"]`).value = l.cantidad||1;
    document.querySelector(`input[data-obs-idx="${i}"]`).value  = l.observaciones||'';
  });

  // Componentes
  renderTablaComponentes();
  (data.componentes||[]).forEach(comp => {
    const i = COMPONENTES.indexOf(comp.componente);
    if (i === -1) return;
    setR(`comp-estado-${i}`, comp.estado);
    document.querySelector(`input[data-comp-obs-idx="${i}"]`).value = comp.observaciones||'';
  });

  // Marcas de daño
  document.querySelectorAll('.mark').forEach(m => m.remove());
  marcas = (data.marcas||[]).map(m => ({
    vista: m.vista, x: Number(m.pos_x), y: Number(m.pos_y),
    tipoDano: m.tipo_dano, descripcion: m.descripcion
  }));
  marcas.forEach((m, idx) => {
    const wrap = document.querySelector(`.view-wrap[data-vista="${m.vista}"]`);
    if (wrap) pintarMarca(wrap, m, idx);
  });
}

function nuevoCheck() {
  editingId = null;
  document.getElementById('editId').value = '';
  document.getElementById('busqueda').value = '';
  document.getElementById('estadoEdicion').textContent = 'Modo: nuevo check.';
  document.getElementById('resultadosBusqueda').style.display = 'none';
  document.getElementById('archivoActual').style.display = 'none';
  document.getElementById('archivoNombre').textContent = 'Sin archivo seleccionado';
  document.querySelectorAll('.mark').forEach(m => m.remove());
  marcas = [];
  document.querySelectorAll('input[type=text],input[type=date],input[type=time],textarea')
    .forEach(el => el.value = '');
  document.querySelectorAll('input[type=radio]').forEach(el => el.checked = false);
  document.getElementById('archivoTarjeta').value = '';
  renderTablaLlantas();
  renderTablaComponentes();
  document.getElementById('btnExportarPdf').style.display = 'none';
  toast('Formulario listo para un nuevo check', false);
  
}

// ── Export PDF ───────────────────────────────────────────────
function svgParaPDF(vista) {
  const el = document.querySelector(`.view-wrap[data-vista="${vista}"] svg`);
  if (!el) return '';
  return el.outerHTML.replace(/#5b6776/g,'#333').replace(/#3a444f/g,'#888');
}
function construirHtmlPdf() {
  const v = id => document.getElementById(id)?.value||'—';
  const chk = name => { const el = document.querySelector(`input[name="${name}"]:checked`); return el?el.value:null; };
  const box = c => `<span class="box">${c?'✕':''}</span>`;

  const llantasHtml = POSICIONES_LLANTAS.map((pos,i) => {
    const est = (document.querySelector(`input[name="llanta-estado-${i}"]:checked`)||{}).value||'';
    const obs = (document.querySelector(`input[data-obs-idx="${i}"]`)||{}).value||'';
    return `<tr><td>${pos}</td><td>${document.querySelector(`input[data-cant-idx="${i}"]`)?.value||1}</td>
      <td>${box(est==='BUENO')}</td><td>${box(est==='REGULAR')}</td><td>${box(est==='MALO')}</td>
      <td>${obs}</td></tr>`;
  }).join('');

  const compHtml = COMPONENTES.map((comp,i) => {
    const est = (document.querySelector(`input[name="comp-estado-${i}"]:checked`)||{}).value||'';
    const obs = (document.querySelector(`input[data-comp-obs-idx="${i}"]`)||{}).value||'';
    return `<tr><td>${comp}</td><td>${box(est==='BUENO')}</td><td>${box(est==='REGULAR')}</td>
      <td>${box(est==='MALO')}</td><td>${obs}</td></tr>`;
  }).join('');

  const vistasHtml = Object.keys(VISTA_LABEL).map(vista => {
    const svg  = svgParaPDF(vista);
    const mrks = marcas.filter(m=>m&&m.vista===vista).map(m =>
      `<div class="pdf-mark" style="left:${m.x}%;top:${m.y}%;background:${COLORES_DANO[m.tipoDano]};">${TIPO_LABEL[m.tipoDano]}</div>`
    ).join('');
    return `<div class="pdf-view"><h4>${VISTA_LABEL[vista]}</h4>
      <div class="pdf-view-canvas">${svg}${mrks}</div></div>`;
  }).join('');

  const tm = chk('tipoMaterialPiso'), cp = chk('condicionPiso'), dic = chk('dictamenGeneral');
  return `
  <div class="pdf-h1">Check de Caja Seca para Tráiler</div>
  <div class="pdf-box"><h3>Datos generales</h3>
    <div class="pdf-grid pdf-grid-4">
      <div class="pdf-field"><b>Fecha</b>${v('fecha')}</div>
      <div class="pdf-field"><b>Hora</b>${v('hora')}</div>
      <div class="pdf-field"><b>No. Económico</b>${v('noEconomico')}</div>
      <div class="pdf-field"><b>Inspector</b>${v('inspector')}</div>
      <div class="pdf-field"><b>Placa</b>${v('placa')}</div>
      <div class="pdf-field"><b>NIV / Serie (VIN)</b>${v('nivSerie')}</div>
      <div class="pdf-field"><b>Modalidad</b>${v('modalidad')}</div>
      <div class="pdf-field"><b>Motor</b>${v('motor')}</div>
      <div class="pdf-field"><b>Clase</b>${v('clase')}</div>
      <div class="pdf-field"><b>Marca de Caja</b>${v('marcaCaja')}</div>
      <div class="pdf-field"><b>Tipo de Caja</b>${v('tipoCaja')}</div>
      <div class="pdf-field"><b>Combustible</b>${v('combustible')}</div>
      <div class="pdf-field"><b>Tipo Caja (transm.)</b>${v('tipoCajaTransmision')}</div>
      <div class="pdf-field" style="grid-column:1/-1;"><b>Cliente / Empresa</b>${v('clienteEmpresa')}</div>
    </div>
  </div>
  <div class="pdf-box"><h3>Datos Fiscales y Propietario</h3>
    <div class="pdf-grid pdf-grid-3">
      <div class="pdf-field" style="grid-column:1/3;"><b>Razón Social</b>${v('razonSocial')}</div>
      <div class="pdf-field"><b>RFC</b>${v('rfc')}</div>
      <div class="pdf-field" style="grid-column:1/-1;"><b>Propietario Vehículo</b>${v('propietarioVehiculo')}</div>
      <div class="pdf-field"><b>Calle</b>${v('dCalle')}</div>
      <div class="pdf-field"><b>Número</b>${v('dNumero')}</div>
      <div class="pdf-field"><b>Colonia</b>${v('dColonia')}</div>
      <div class="pdf-field"><b>C.P.</b>${v('dCp')}</div>
      <div class="pdf-field" style="grid-column:1/-1;"><b>Domicilio Fiscal</b>${v('domicilioFiscal')}</div>
    </div>
  </div>
  <div class="pdf-box"><h3>Capacidades y Dimensiones</h3>
    <div class="pdf-grid" style="grid-template-columns:repeat(6,1fr);gap:6px;">
      <div class="pdf-field"><b>Peso Veh.</b>${v('pesoVehicular')}</div>
      <div class="pdf-field"><b>Ejes</b>${v('numEjes')}</div>
      <div class="pdf-field"><b>Llantas</b>${v('numLlantas')}</div>
      <div class="pdf-field"><b>Litros</b>${v('litros')}</div>
      <div class="pdf-field"><b>Toneladas</b>${v('toneladas')}</div>
      <div class="pdf-field"><b>Personas</b>${v('personas')}</div>
      <div class="pdf-field"><b>Alto (m)</b>${v('altoM')}</div>
      <div class="pdf-field"><b>Ancho (m)</b>${v('anchoM')}</div>
      <div class="pdf-field"><b>Largo (m)</b>${v('largoM')}</div>
      <div class="pdf-field"><b>Tipo Suspensión</b>${v('tipoSuspension')}</div>
    </div>
  </div>
  <div class="pdf-box"><h3>Ejes y Trámite</h3>
    <div class="pdf-grid pdf-grid-4">
      <div class="pdf-field"><b>Eje Direccional</b>${v('ejeDireccional')}</div>
      <div class="pdf-field"><b>Eje Motriz</b>${v('ejeMotriz')}</div>
      <div class="pdf-field"><b>Eje Arrastre</b>${v('ejeArrastre')}</div>
      <div class="pdf-field"><b>Permiso Ruta</b>${v('permisoRuta')}</div>
      <div class="pdf-field"><b>Folio</b>${v('folioTramite')}</div>
      <div class="pdf-field"><b>Folio Serie / No. Tarjeta</b>${v('folioSerie')}</div>
      <div class="pdf-field"><b>F. Límite Suspensión</b>${v('fechaLimiteSuspension')}</div>
      <div class="pdf-field"><b>Trámite</b>${v('tramite')}</div>
      <div class="pdf-field"><b>Lugar Expedición</b>${v('lugarExpedicion')}</div>
      <div class="pdf-field"><b>Fecha Expedición</b>${v('fechaExpedicion')}</div>
    </div>
  </div>
  <div class="pdf-box"><h3>Diagramas del tráiler</h3>
    <div class="pdf-views">${vistasHtml}</div>
    <div class="pdf-legend">
      <span><i style="background:#e0a32e"></i>Raspones</span>
      <span><i style="background:#d65c5c"></i>Golpes</span>
      <span><i style="background:#6f9fd6"></i>Abolladuras</span>
      <span><i style="background:#b85cd6"></i>Perforaciones</span>
      <span><i style="background:#8d99a8"></i>Otros</span>
    </div>
  </div>
  <div class="pdf-box"><h3>Llantas</h3>
    <table><thead><tr><th>Posición</th><th>Cant.</th><th>Bueno</th><th>Regular</th><th>Malo</th><th>Observaciones</th></tr></thead>
    <tbody>${llantasHtml}</tbody></table>
  </div>
  <div class="pdf-box"><h3>Estructura y Componentes</h3>
    <table><thead><tr><th>Componente</th><th>Bueno</th><th>Regular</th><th>Malo</th><th>Observaciones</th></tr></thead>
    <tbody>${compHtml}</tbody></table>
  </div>
  <div class="pdf-box"><h3>Piso · Observaciones · Dictamen</h3>
    <div class="pdf-grid pdf-grid-2">
      <div class="pdf-field"><b>Tipo de material</b>
        ${['MADERA','ALUMINIO','ACERO','OTRO'].map(o=>`<span class="pdf-checkbox">${box(tm===o)} ${o}</span>`).join('')}
      </div>
      <div class="pdf-field"><b>Condición</b>
        ${['BUENO','REGULAR','MALO'].map(o=>`<span class="pdf-checkbox">${box(cp===o)} ${o}</span>`).join('')}
        <div>${v('pisoObservaciones')}</div>
      </div>
      <div class="pdf-field"><b>Observaciones generales</b>${v('observacionesGenerales')}</div>
      <div class="pdf-field"><b>Notas adicionales</b>${v('notasAdicionales')}</div>
    </div>
    <div style="margin-top:8px;">
      <span class="pdf-checkbox">${box(dic==='APTO')} APTO PARA SERVICIO</span>
      <span class="pdf-checkbox">${box(dic==='NO_APTO')} NO APTO PARA SERVICIO</span>
      &nbsp;&nbsp;&nbsp;<b>Firma:</b> ${v('firmaInspector')}
    </div>
  </div>`;
}

async function exportarPDF() {
  if (typeof html2canvas==='undefined' || typeof window.jspdf==='undefined') {
    toast('Librerías de PDF no cargadas (requiere internet)', true); return;
  }
  toast('Generando PDF…', false);
  const sheet = document.getElementById('pdfSheet');
  sheet.innerHTML = construirHtmlPdf();

  // Pequeña espera para que el DOM renderice imágenes/SVG antes de capturar
  await new Promise(r => setTimeout(r, 120));

  try {
    const { jsPDF } = window.jspdf;
    const pdf     = new jsPDF('p', 'mm', 'a4');
    const PW      = 210;   // ancho página A4 en mm
    const PH      = 297;   // alto  página A4 en mm
    const MARGIN  = 8;     // margen lateral y vertical en mm
    const USABLE_W = PW - MARGIN * 2;
    const USABLE_H = PH - MARGIN * 2;
    const SCALE    = 2;    // resolución del canvas (2× = buena calidad)
    const GAP_MM   = 3;    // espacio entre secciones en mm

    // Seleccionamos: título h1 + cada pdf-box como unidades independientes
    const elementos = sheet.querySelectorAll('.pdf-h1, .pdf-box');
    let currentY = MARGIN;
    let primeraPagina = true;

    for (const el of elementos) {
      // Capturar este elemento individual
      const canvas = await html2canvas(el, {
        scale: SCALE,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false
      });

      // Alto en mm que ocuparía este bloque dentro del ancho útil
      const bloqueH = (canvas.height * USABLE_W) / canvas.width;

      // Si el bloque no cabe en lo que queda de página → nueva página
      // (excepto si es el primer elemento)
      if (!primeraPagina && currentY + bloqueH > PH - MARGIN) {
        pdf.addPage();
        currentY = MARGIN;
      }

      // Si el bloque en sí es más alto que una página completa,
      // lo escalamos para que quepa (caso extremo: tabla muy larga)
      let renderW = USABLE_W;
      let renderH = bloqueH;
      if (renderH > USABLE_H) {
        const ratio = USABLE_H / renderH;
        renderW *= ratio;
        renderH  = USABLE_H;
      }

      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', MARGIN, currentY, renderW, renderH);
      currentY   += renderH + GAP_MM;
      primeraPagina = false;
    }

    pdf.save(`check-caja-seca${editingId ? '-' + editingId : ''}.pdf`);
    toast('PDF generado ✓', false);
  } catch (err) {
    console.error(err);
    toast('Error PDF: ' + err.message, true);
  } finally {
    sheet.innerHTML = '';
  }
}

// ── Toast ────────────────────────────────────────────────────
function toast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  setTimeout(() => { t.className = ''; }, 3500);
}

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderTablaLlantas();
  renderTablaComponentes();
  initVistas();
  initAcordeon();

  document.getElementById('btnGuardar').addEventListener('click', guardarCheck);
  document.getElementById('btnLimpiar').addEventListener('click', () => {
    if (confirm('¿Limpiar todo el formulario?')) nuevoCheck();
  });
  document.getElementById('btnNuevo').addEventListener('click', nuevoCheck);
  document.getElementById('btnBuscar').addEventListener('click', buscarChecks);
  document.getElementById('btnCargar').addEventListener('click', () => {
    const id = document.getElementById('editId').value.trim();
    if (!id) { toast('Escribe el ID del check', true); return; }
    cargarCheck(id);
  });
  document.getElementById('btnExportarPdf').addEventListener('click', exportarPDF);
  document.getElementById('busqueda').addEventListener('keydown', e => {
    if (e.key === 'Enter') buscarChecks();
  });

  // Nombre del archivo seleccionado
  document.getElementById('archivoTarjeta').addEventListener('change', function() {
    const nombre = this.files[0]?.name || 'Sin archivo seleccionado';
    document.getElementById('archivoNombre').textContent = nombre;
  });

  document.addEventListener('click', ev => {
    if (!ev.target.closest('.popover') && !ev.target.closest('.view-wrap')) cerrarPopovers();
  });
});
