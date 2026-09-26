// utils/correoChecks.js — Envío por correo de los checks de inspección.
//
// Los dos checks se mandan distinto, y a propósito:
//
//   * CAJA SECA: la pantalla ya arma un PDF con jsPDF que replica el
//     formato impreso. Ese PDF se adjunta tal cual y el cuerpo del
//     correo es solo una carátula. Reconstruir ese layout aquí en el
//     servidor sería duplicar código que ya existe y que además tendría
//     que mantenerse a la par.
//
//   * TRACTO: no genera PDF, así que el cuerpo del correo lleva el
//     detalle completo (puntos por vista, marcas de daño, estado
//     general) armado desde la base.
'use strict';

const { transporter, CORREO_ADMIN } = require('../config/mailer');
const { dbPromesa } = require('../config/db');
const { VISTA_LABEL } = require('./checkTracto');

const CORREO_NOTIFICACIONES = 'admintransportesalas@gmail.com';

const COLOR_ESTADO = { BUENO: '#198754', REGULAR: '#b8860b', MALO: '#c0392b' };
const ETIQUETA_GENERAL = {
  SIN_DANOS: 'Sin daños',
  CON_DANOS: 'Con daños (ver observaciones)',
  NO_APLICA: 'No aplica',
};

function formatoFecha(valor) {
  if (!valor) return '—';
  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return String(valor);
  return d.toLocaleDateString('es-MX', { timeZone: 'UTC' });
}

function escapar(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function pie() {
  return `<p style="margin-top:20px;font-size:12px;color:#777;">
      Enviado el ${new Date().toLocaleString('es-MX')}.<br>
      Este es un mensaje automático del Sistema de Transportes Salas.
    </p>`;
}

// ── CHECK DE CAJA SECA ─────────────────────────────────────────────────
async function enviarCheckCaja(idCheck, adjunto) {
  const [[check]] = await dbPromesa.query(
    `SELECT id, fecha, hora, no_economico, placa, marca, tipo_caja,
            cliente_empresa, inspector, dictamen_general
       FROM checks WHERE id = ?`,
    [idCheck]
  );
  if (!check) throw new Error('Check no encontrado.');

  const [[{ danos }]] = await dbPromesa.query(
    'SELECT COUNT(*) AS danos FROM marcas_dano WHERE check_id = ?',
    [idCheck]
  );

  const identificacion = check.no_economico || check.placa || `#${check.id}`;

  const mail = {
    from: `"Sistema Transportes Salas" <${CORREO_ADMIN}>`,
    to: CORREO_NOTIFICACIONES,
    subject: `📦 Check de Caja Seca — ${identificacion} — ${formatoFecha(check.fecha)}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;border:1px solid #eee;padding:20px;">
        <h2 style="color:#2c3e50;margin-top:0;">📦 Check de Caja Seca</h2>
        <p>Se adjunta el check de inspección en PDF con el formato completo.</p>
        <hr>
        <p><b>No. económico:</b> ${escapar(check.no_economico || '—')}</p>
        <p><b>Placas:</b> ${escapar(check.placa || '—')}</p>
        <p><b>Marca / tipo:</b> ${escapar(check.marca || '—')} ${escapar(check.tipo_caja || '')}</p>
        <p><b>Fecha / hora:</b> ${formatoFecha(check.fecha)} ${escapar(check.hora || '')}</p>
        <p><b>Cliente:</b> ${escapar(check.cliente_empresa || '—')}</p>
        <p><b>Inspector:</b> ${escapar(check.inspector || '—')}</p>
        <p><b>Marcas de daño registradas:</b> ${danos}</p>
        ${check.dictamen_general ? `<p><b>Dictamen:</b> ${escapar(check.dictamen_general)}</p>` : ''}
        ${pie()}
      </div>`,
  };

  if (adjunto) {
    mail.attachments = [{
      filename: `check-caja-${identificacion}.pdf`,
      content: adjunto,
      contentType: 'application/pdf',
    }];
  }

  await transporter.sendMail(mail);
  return { identificacion, conAdjunto: Boolean(adjunto) };
}

// ── CHECK DE TRACTO ────────────────────────────────────────────────────
async function enviarCheckTracto(idCheck) {
  const [[check]] = await dbPromesa.query(
    'SELECT * FROM trailer_checks WHERE ID_CHECK = ?',
    [idCheck]
  );
  if (!check) throw new Error('Check no encontrado.');

  const [componentes] = await dbPromesa.query(
    'SELECT VISTA, COMPONENTE, ESTADO, OBSERVACIONES FROM trailer_check_componentes WHERE ID_CHECK = ? ORDER BY ID_COMPONENTE',
    [idCheck]
  );
  const [marcas] = await dbPromesa.query(
    'SELECT VISTA, TIPO_DANO, DESCRIPCION FROM trailer_check_marcas_dano WHERE ID_CHECK = ? ORDER BY ID_MARCA',
    [idCheck]
  );

  // Los puntos se agrupan por vista para que el correo se lea igual que
  // el formato en papel.
  const porVista = new Map();
  componentes.forEach(c => {
    if (!porVista.has(c.VISTA)) porVista.set(c.VISTA, []);
    porVista.get(c.VISTA).push(c);
  });

  const bloques = [...porVista.entries()].map(([vista, puntos]) => `
      <h3 style="font-size:13px;color:#2c3e50;border-bottom:1px solid #ddd;padding-bottom:4px;margin:18px 0 8px;">
        ${escapar(VISTA_LABEL[vista] || vista)}
      </h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        ${puntos.map(p => `
          <tr>
            <td style="padding:6px;border:1px solid #ddd;">${escapar(p.COMPONENTE)}</td>
            <td style="padding:6px;border:1px solid #ddd;color:${COLOR_ESTADO[p.ESTADO] || '#333'};font-weight:bold;width:90px;">
              ${escapar(p.ESTADO)}
            </td>
            <td style="padding:6px;border:1px solid #ddd;">${escapar(p.OBSERVACIONES || '')}</td>
          </tr>`).join('')}
      </table>`).join('');

  const bloqueMarcas = marcas.length ? `
      <h3 style="font-size:13px;color:#c0392b;border-bottom:1px solid #ddd;padding-bottom:4px;margin:18px 0 8px;">
        Marcas de daño (${marcas.length})
      </h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        ${marcas.map(m => `
          <tr>
            <td style="padding:6px;border:1px solid #ddd;">${escapar(VISTA_LABEL[m.VISTA] || m.VISTA)}</td>
            <td style="padding:6px;border:1px solid #ddd;font-weight:bold;">${escapar(m.TIPO_DANO)}</td>
            <td style="padding:6px;border:1px solid #ddd;">${escapar(m.DESCRIPCION || '')}</td>
          </tr>`).join('')}
      </table>` : '';

  await transporter.sendMail({
    from: `"Sistema Transportes Salas" <${CORREO_ADMIN}>`,
    to: CORREO_NOTIFICACIONES,
    subject: `🚛 Check de Tracto — ${check.UNIDAD_PLACAS || `#${check.ID_CHECK}`} — ${formatoFecha(check.FECHA)}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:700px;border:1px solid #eee;padding:20px;">
        <h2 style="color:#2c3e50;margin-top:0;">🚛 Check de Unidad (Tracto Camión)</h2>
        <p><b>Unidad / placas:</b> ${escapar(check.UNIDAD_PLACAS || '—')}</p>
        <p><b>Fecha:</b> ${formatoFecha(check.FECHA)}</p>
        <p><b>Operador:</b> ${escapar(check.OPERADOR || '—')}</p>
        <p><b>Origen / destino:</b> ${escapar(check.ORIGEN_DESTINO || '—')}</p>
        <p><b>Estado general:</b> ${escapar(ETIQUETA_GENERAL[check.ESTADO_GENERAL] || '—')}</p>
        ${check.OBSERVACIONES ? `<p><b>Observaciones:</b> ${escapar(check.OBSERVACIONES)}</p>` : ''}
        ${bloques || '<p style="color:#777;">No se calificó ningún punto.</p>'}
        ${bloqueMarcas}
        ${pie()}
      </div>`,
  });

  return { unidad: check.UNIDAD_PLACAS, puntos: componentes.length, marcas: marcas.length };
}

module.exports = { enviarCheckCaja, enviarCheckTracto };
