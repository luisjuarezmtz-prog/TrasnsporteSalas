// utils/correoVencimientos.js — Aviso por correo de los vencimientos.
//
// Lo usan dos entradas: el botón de envío manual de la pantalla
// (routes/vencimientos.js) y el script de cron
// (scripts/avisoVencimientos.js). El cuerpo se arma una sola vez aquí
// para que el correo diga lo mismo que el panel.
'use strict';

const { transporter, CORREO_ADMIN } = require('../config/mailer');
const { obtenerVencimientos } = require('./vencimientos');

const CORREO_NOTIFICACIONES = 'admintransportesalas@gmail.com';

const COLOR_ESTADO = { VENCIDO: '#c0392b', POR_VENCER: '#b8860b' };

function formatoFecha(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function textoDias(dias) {
  if (dias < 0) return `vencido hace ${Math.abs(dias)} día(s)`;
  if (dias === 0) return 'vence HOY';
  return `en ${dias} día(s)`;
}

function construirHtml(datos) {
  const filas = datos.items.map(i => `
      <tr>
        <td style="padding:8px;border:1px solid #ddd;">${i.tipo}</td>
        <td style="padding:8px;border:1px solid #ddd;">${i.unidad}</td>
        <td style="padding:8px;border:1px solid #ddd;">${i.descripcion}</td>
        <td style="padding:8px;border:1px solid #ddd;">${formatoFecha(i.fecha)}</td>
        <td style="padding:8px;border:1px solid #ddd;color:${COLOR_ESTADO[i.estado] || '#333'};font-weight:bold;">
          ${textoDias(i.diasRestantes)}
        </td>
      </tr>`).join('');

  return `
    <div style="font-family:Arial,sans-serif;max-width:760px;border:1px solid #eee;padding:20px;">
      <h2 style="color:#2c3e50;margin-top:0;">⏰ Vencimientos de la flotilla</h2>
      <p>
        <b style="color:#c0392b;">${datos.resumen.vencidos} vencido(s)</b> ·
        <b style="color:#b8860b;">${datos.resumen.porVencer} por vencer</b>
        en los próximos ${datos.diasAviso} días.
      </p>
      <table style="width:100%;border-collapse:collapse;margin-top:15px;font-size:13px;">
        <thead>
          <tr style="background-color:#f8f9fa;">
            <th style="padding:8px;border:1px solid #ddd;">Tipo</th>
            <th style="padding:8px;border:1px solid #ddd;">Unidad</th>
            <th style="padding:8px;border:1px solid #ddd;">Detalle</th>
            <th style="padding:8px;border:1px solid #ddd;">Fecha</th>
            <th style="padding:8px;border:1px solid #ddd;">Estado</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#777;">
        Generado el ${new Date().toLocaleString('es-MX')}.<br>
        Este es un aviso automático del Sistema de Transportes Salas.
      </p>
    </div>`;
}

// Devuelve { enviado: false, motivo } cuando no hay nada que avisar:
// mandar un correo diario diciendo "no hay pendientes" haría que dejen
// de leerlos.
async function enviarAvisoVencimientos({ diasAviso } = {}) {
  const datos = await obtenerVencimientos({ diasAviso, soloPendientes: true });

  if (datos.items.length === 0) {
    return { enviado: false, motivo: 'No hay vencimientos pendientes; no se envió correo.' };
  }

  await transporter.sendMail({
    from: `"Sistema Transportes Salas" <${CORREO_ADMIN}>`,
    to: CORREO_NOTIFICACIONES,
    subject: `⏰ Vencimientos: ${datos.resumen.vencidos} vencido(s) y ${datos.resumen.porVencer} por vencer`,
    html: construirHtml(datos),
  });

  return { enviado: true, total: datos.items.length, resumen: datos.resumen };
}

module.exports = { enviarAvisoVencimientos, construirHtml };
