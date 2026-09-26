// utils/vencimientos.js — Control de vencimientos de la flotilla
//
// El panel NO tiene tabla propia: cruza las fechas que ya viven en los
// módulos existentes. Eso evita duplicar información que se tendría que
// mantener sincronizada a mano, y hace que un trámite capturado en
// Gestorías actualice el semáforo sin ningún paso extra.
//
// Fuentes:
//   1. Tarjeta de circulación  -> trailers.FECHA_LIMITE_SUSTITUCION
//   2. Verificación físico-mec -> trailer_verificaciones.FECHA_VIGENCIA
//   3. Póliza de seguro        -> trailer_seguros.FECHA_VENCIMIENTO
//   4. Pago de póliza          -> trailer_seguro_pagos (los no pagados)
//   5. Gestoría que renueva    -> mantenimientos.FECHA_VENCIMIENTO_NUEVA
//
// De las verificaciones y los seguros solo interesa el registro MÁS
// RECIENTE por unidad: si una unidad ya reverificó, la vigencia vieja
// dejó de importar y mostrarla sería una alarma falsa.
'use strict';

const { dbPromesa } = require('../config/db');

const DIAS_AVISO_DEFAULT = 30;

// mysql2 devuelve las columnas DATE como objetos Date, no como string,
// así que no se puede asumir el formato: se normaliza a YYYY-MM-DD
// antes de operar.
function aISO(valor) {
  if (valor instanceof Date) {
    const a = valor.getFullYear();
    const m = String(valor.getMonth() + 1).padStart(2, '0');
    const d = String(valor.getDate()).padStart(2, '0');
    return `${a}-${m}-${d}`;
  }
  return String(valor).slice(0, 10);
}

// Compara solo la fecha, sin hora: un documento que vence hoy debe
// contar como 0 días, no como -1 por unas horas de diferencia.
function diasEntre(fecha, hoy = new Date()) {
  const [a, m, d] = aISO(fecha).split('-').map(Number);
  const objetivo = Date.UTC(a, m - 1, d);
  const base = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  return Math.round((objetivo - base) / 86400000);
}

function clasificar(dias, diasAviso) {
  if (dias < 0) return 'VENCIDO';
  if (dias <= diasAviso) return 'POR_VENCER';
  return 'VIGENTE';
}

async function obtenerVencimientos({ diasAviso = DIAS_AVISO_DEFAULT, soloPendientes = false } = {}) {
  const [
    [tarjetas],
    [verificaciones],
    [polizas],
    [pagos],
    [gestorias],
  ] = await Promise.all([
    dbPromesa.query(
      `SELECT ID_TRAILER, TRIM(CONCAT(COALESCE(NO_ECONOMICO,''), ' ', PLACAS)) AS UNIDAD,
              FECHA_LIMITE_SUSTITUCION AS FECHA
         FROM trailers
        WHERE STATUS = 1 AND FECHA_LIMITE_SUSTITUCION IS NOT NULL`
    ),
    // Solo la verificación más reciente de cada unidad.
    dbPromesa.query(
      `SELECT v.ID_TRAILER, TRIM(CONCAT(COALESCE(t.NO_ECONOMICO,''), ' ', t.PLACAS)) AS UNIDAD,
              v.FECHA_VIGENCIA AS FECHA, v.FOLIO_DICTAMEN, v.RESULTADO
         FROM trailer_verificaciones v
         INNER JOIN trailers t ON t.ID_TRAILER = v.ID_TRAILER AND t.STATUS = 1
        WHERE v.FECHA_VIGENCIA IS NOT NULL
          AND v.ID_VERIFICACION = (
              SELECT MAX(x.ID_VERIFICACION) FROM trailer_verificaciones x
               WHERE x.ID_TRAILER = v.ID_TRAILER AND x.FECHA_VIGENCIA IS NOT NULL
          )`
    ),
    dbPromesa.query(
      `SELECT s.ID_SEGURO, s.ID_TRAILER,
              TRIM(CONCAT(COALESCE(t.NO_ECONOMICO,''), ' ', t.PLACAS)) AS UNIDAD,
              s.FECHA_VENCIMIENTO AS FECHA, s.NUMERO_POLIZA, p.NOMBRE_EMPRESARIAL AS PROVEEDOR
         FROM trailer_seguros s
         INNER JOIN trailers t ON t.ID_TRAILER = s.ID_TRAILER
         LEFT JOIN proveedores p ON p.ID_PROVEEDOR = s.ID_PROVEEDOR
        WHERE s.ESTATUS = 1 AND s.FECHA_VENCIMIENTO IS NOT NULL`
    ),
    dbPromesa.query(
      `SELECT g.ID_PAGO, s.ID_TRAILER,
              TRIM(CONCAT(COALESCE(t.NO_ECONOMICO,''), ' ', t.PLACAS)) AS UNIDAD,
              g.FECHA_PROGRAMADA AS FECHA, g.MONTO, g.NUMERO_PAGO, s.NUMERO_POLIZA
         FROM trailer_seguro_pagos g
         INNER JOIN trailer_seguros s ON s.ID_SEGURO = g.ID_SEGURO AND s.ESTATUS = 1
         INNER JOIN trailers t ON t.ID_TRAILER = s.ID_TRAILER
        WHERE g.PAGADO = 0`
    ),
    dbPromesa.query(
      `SELECT m.ID_MANTENIMIENTO, m.ID_TRAILER, m.UNIDAD_PLACAS AS UNIDAD,
              m.FECHA_VENCIMIENTO_NUEVA AS FECHA, c.NOMBRE AS CONCEPTO, m.FOLIO_OC
         FROM mantenimientos m
         INNER JOIN c_tipos_mantenimiento c ON c.ID_TIPO = m.ID_TIPO
        WHERE m.TIPO = 'GESTORIA' AND m.ESTATUS = 'CONCLUIDA'
          AND m.FECHA_VENCIMIENTO_NUEVA IS NOT NULL`
    ),
  ]);

  const items = [];

  const agregar = (tipo, fila, descripcion, extra = {}) => {
    const dias = diasEntre(fila.FECHA);
    items.push({
      tipo,
      unidad: (fila.UNIDAD || '').trim() || '—',
      idTrailer: fila.ID_TRAILER || null,
      descripcion,
      fecha: aISO(fila.FECHA),
      diasRestantes: dias,
      estado: clasificar(dias, diasAviso),
      ...extra,
    });
  };

  tarjetas.forEach(f => agregar('Tarjeta de circulación', f, 'Fecha límite de sustitución'));
  verificaciones.forEach(f =>
    agregar('Verificación físico-mecánica', f,
      `Dictamen ${f.FOLIO_DICTAMEN || 's/folio'}${f.RESULTADO ? ` · ${f.RESULTADO}` : ''}`));
  polizas.forEach(f =>
    agregar('Póliza de seguro', f,
      `Póliza ${f.NUMERO_POLIZA || 's/número'}${f.PROVEEDOR ? ` · ${f.PROVEEDOR}` : ''}`));
  pagos.forEach(f =>
    agregar('Pago de póliza', f,
      `Pago ${f.NUMERO_PAGO} de la póliza ${f.NUMERO_POLIZA || 's/número'}`, { monto: Number(f.MONTO) }));
  gestorias.forEach(f =>
    agregar('Documento de gestoría', f,
      `${f.CONCEPTO}${f.FOLIO_OC ? ` · ${f.FOLIO_OC}` : ''}`));

  const lista = soloPendientes ? items.filter(i => i.estado !== 'VIGENTE') : items;

  // Lo más urgente primero: vencidos arriba, y dentro de cada grupo por
  // la fecha más próxima.
  lista.sort((a, b) => a.diasRestantes - b.diasRestantes);

  return {
    diasAviso,
    resumen: {
      vencidos: items.filter(i => i.estado === 'VENCIDO').length,
      porVencer: items.filter(i => i.estado === 'POR_VENCER').length,
      vigentes: items.filter(i => i.estado === 'VIGENTE').length,
      total: items.length,
    },
    items: lista,
  };
}

module.exports = { obtenerVencimientos, diasEntre, clasificar, aISO, DIAS_AVISO_DEFAULT };
