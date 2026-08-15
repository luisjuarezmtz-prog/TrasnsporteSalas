// routes/cxc.js — Cuentas por Cobrar: cálculo y generación de factura
//
// Combina 3 categorías de costo para armar una factura hacia el cliente:
//   - MOVIMIENTOS: travels_movements en un rango de fechas (fecha inicio/fin
//     del movimiento).
//   - LOCALES: purchases_orders con ID_TYPE_TRIP = 1 (viaje local), filtradas
//     por una fecha de pago general (PAYMENT_DATE).
//   - FORÁNEOS: purchases_orders con ID_TYPE_TRIP = 2 (viaje foráneo), misma
//     fecha de pago general, desglosados por CEDI porque puede haber varios.
//
// El total de la factura aplica IVA (16%) e IVA retenido (4%), igual que
// los queries originales que se usaron como base para este módulo:
//   TOTAL_FACTURA = SUBTOTAL + SUBTOTAL*0.16 - SUBTOTAL*0.04
'use strict';

const express = require('express');
const router = express.Router();
const { dbPromesa } = require('../config/db');

const TASA_IVA = 0.16;
const TASA_IVA_RETENIDO = 0.04;

// --- Sub-consultas reutilizables --------------------------------------

async function consultarMovimientos(fechaInicio, fechaFin) {
  const [rows] = await dbPromesa.query(
    `SELECT COUNT(TM.AMOUNT) AS NUMERO, COALESCE(SUM(TM.AMOUNT), 0) AS COSTO
     FROM travels_movements TM
     WHERE TM.MOVEMENT_DATE BETWEEN ? AND ?`,
    [fechaInicio, fechaFin]
  );
  return { numero: rows[0].NUMERO, costo: parseFloat(rows[0].COSTO) };
}

async function consultarLocales(fechaPago) {
  const [rows] = await dbPromesa.query(
    `SELECT COUNT(PO.TRAVEL_COST) AS NUMERO, COALESCE(SUM(PO.TRAVEL_COST), 0) AS COSTO
     FROM purchases_orders PO
     INNER JOIN c_cedis CC ON CC.ID_CEDI = PO.ID_CEDI
     INNER JOIN c_type_of_trip CT ON CT.ID_TYPE_TRIP = CC.ID_TYPE_TRIP
     WHERE PO.PAYMENT_DATE = ? AND PO.ID_STATUS_ORDER IN (1,2,3,5) AND CT.ID_TYPE_TRIP = 1`,
    [fechaPago]
  );
  return { numero: rows[0].NUMERO, costo: parseFloat(rows[0].COSTO) };
}

async function consultarForaneos(fechaPago) {
  const [rows] = await dbPromesa.query(
    `SELECT CC.CEDI_NAME AS CEDI_NAME, COUNT(CC.CEDI_NAME) AS NUMERO, COALESCE(SUM(PO.TRAVEL_COST), 0) AS COSTO
     FROM purchases_orders PO
     INNER JOIN c_cedis CC ON CC.ID_CEDI = PO.ID_CEDI
     INNER JOIN c_type_of_trip CT ON CT.ID_TYPE_TRIP = CC.ID_TYPE_TRIP
     WHERE PO.PAYMENT_DATE = ? AND PO.ID_STATUS_ORDER IN (1,2,3,5) AND CT.ID_TYPE_TRIP = 2
     GROUP BY CC.CEDI_NAME`,
    [fechaPago]
  );

  const detalle = rows.map(r => ({
    cedi_name: r.CEDI_NAME,
    numero: r.NUMERO,
    costo: parseFloat(r.COSTO)
  }));

  const totales = detalle.reduce(
    (acc, d) => ({ numero: acc.numero + d.numero, costo: acc.costo + d.costo }),
    { numero: 0, costo: 0 }
  );

  return { detalle, totales };
}

// Arma el desglose completo + totales de la factura (sin guardar nada).
async function calcularFactura(fechaInicioMov, fechaFinMov, fechaPago) {
  const [movimientos, locales, foraneos] = await Promise.all([
    consultarMovimientos(fechaInicioMov, fechaFinMov),
    consultarLocales(fechaPago),
    consultarForaneos(fechaPago)
  ]);

  const subtotal = movimientos.costo + locales.costo + foraneos.totales.costo;
  const iva = subtotal * TASA_IVA;
  const ivaRetenido = subtotal * TASA_IVA_RETENIDO;
  const totalFactura = subtotal + iva - ivaRetenido;

  return {
    movimientos,
    locales,
    foraneos,
    subtotal,
    iva,
    iva_retenido: ivaRetenido,
    total_factura: totalFactura
  };
}

// --- RUTA: consulta de movimientos por rango de fechas (submódulo 1) ---
router.get('/cxc/movimientos', async (req, res) => {
  const { fecha_inicio, fecha_fin } = req.query;
  if (!fecha_inicio || !fecha_fin) {
    return res.status(400).json({ success: false, message: 'Faltan fecha_inicio y/o fecha_fin.' });
  }

  try {
    const data = await consultarMovimientos(fecha_inicio, fecha_fin);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error al consultar movimientos CXC:', error);
    res.status(500).json({ success: false, message: 'Error al consultar movimientos.' });
  }
});

// --- RUTA: consulta de locales/foráneos por fecha de pago general -------
router.get('/cxc/pago-general', async (req, res) => {
  const { fecha_pago } = req.query;
  if (!fecha_pago) {
    return res.status(400).json({ success: false, message: 'Falta fecha_pago.' });
  }

  try {
    const [locales, foraneos] = await Promise.all([
      consultarLocales(fecha_pago),
      consultarForaneos(fecha_pago)
    ]);
    res.json({ success: true, data: { locales, foraneos: foraneos.detalle, foraneos_totales: foraneos.totales } });
  } catch (error) {
    console.error('Error al consultar pago general CXC:', error);
    res.status(500).json({ success: false, message: 'Error al consultar locales/foráneos.' });
  }
});

// --- RUTA: calcular factura (preview, sin guardar) ----------------------
router.post('/cxc/calcular', async (req, res) => {
  const { fecha_inicio_mov, fecha_fin_mov, fecha_pago } = req.body;
  console.log('[CXC DEBUG] body recibido:', req.body); // TEMPORAL: quitar después de diagnosticar
  if (!fecha_inicio_mov || !fecha_fin_mov || !fecha_pago) {
    return res.status(400).json({ success: false, message: 'Faltan fechas para calcular la factura.' });
  }

  try {
    const resultado = await calcularFactura(fecha_inicio_mov, fecha_fin_mov, fecha_pago);
    console.log('[CXC DEBUG] resultado calculado:', JSON.stringify(resultado)); // TEMPORAL: quitar después de diagnosticar
    res.json({ success: true, data: resultado });
  } catch (error) {
    console.error('Error al calcular factura CXC:', error);
    res.status(500).json({ success: false, message: 'Error al calcular la factura.' });
  }
});

// --- RUTA: generar y guardar factura (historial) ------------------------
// El total SIEMPRE se recalcula en el servidor (nunca se confía en los
// montos que mande el navegador), para que el historial quede consistente
// con lo que realmente hay en travels_movements / purchases_orders.
router.post('/cxc/facturas', async (req, res) => {
  const { fecha_inicio_mov, fecha_fin_mov, fecha_pago, username } = req.body;
  if (!fecha_inicio_mov || !fecha_fin_mov || !fecha_pago) {
    return res.status(400).json({ success: false, message: 'Faltan fechas para generar la factura.' });
  }

  try {
    const r = await calcularFactura(fecha_inicio_mov, fecha_fin_mov, fecha_pago);

    const fechaFolio = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const aleatorio = Math.floor(1000 + Math.random() * 9000);
    const folio = `CXC-${fechaFolio}-${aleatorio}`;

    const [result] = await dbPromesa.query(
      `INSERT INTO cxc_facturas
       (FOLIO, FECHA_INICIO_MOVIMIENTOS, FECHA_FIN_MOVIMIENTOS, FECHA_PAGO_GENERAL,
        NUM_MOVIMIENTOS, MONTO_MOVIMIENTOS, NUM_LOCALES, MONTO_LOCALES,
        NUM_FORANEOS, MONTO_FORANEOS, SUBTOTAL, IVA, IVA_RETENIDO, TOTAL_FACTURA,
        ID_STATUS, USERNAME, CREATION_DATE)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW())`,
      [
        folio, fecha_inicio_mov, fecha_fin_mov, fecha_pago,
        r.movimientos.numero, r.movimientos.costo,
        r.locales.numero, r.locales.costo,
        r.foraneos.totales.numero, r.foraneos.totales.costo,
        r.subtotal, r.iva, r.iva_retenido, r.total_factura,
        username || 'Sistema'
      ]
    );

    const idFactura = result.insertId;

    if (r.foraneos.detalle.length > 0) {
      const valoresDetalle = r.foraneos.detalle.map(d => [idFactura, d.cedi_name, d.numero, d.costo]);
      await dbPromesa.query(
        `INSERT INTO cxc_facturas_foraneos_detalle (ID_FACTURA, CEDI_NAME, NUMERO, COSTO) VALUES ?`,
        [valoresDetalle]
      );
    }

    res.json({ success: true, message: `Factura generada con folio ${folio}.`, folio, id_factura: idFactura, ...r });
  } catch (error) {
    console.error('Error al generar factura CXC:', error);
    res.status(500).json({ success: false, message: 'Error al generar la factura.' });
  }
});

// --- RUTA: historial de facturas ----------------------------------------
router.get('/cxc/facturas', async (req, res) => {
  try {
    const [rows] = await dbPromesa.query(
      `SELECT ID_FACTURA, FOLIO, FECHA_INICIO_MOVIMIENTOS, FECHA_FIN_MOVIMIENTOS, FECHA_PAGO_GENERAL,
              NUM_MOVIMIENTOS, MONTO_MOVIMIENTOS, NUM_LOCALES, MONTO_LOCALES,
              NUM_FORANEOS, MONTO_FORANEOS, SUBTOTAL, IVA, IVA_RETENIDO, TOTAL_FACTURA,
              ID_STATUS, USERNAME, CREATION_DATE
       FROM cxc_facturas
       ORDER BY CREATION_DATE DESC`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error al consultar historial de facturas CXC:', error);
    res.status(500).json({ success: false, message: 'Error al consultar el historial.' });
  }
});

// --- RUTA: detalle de una factura (incluye desglose de foráneos) -------
router.get('/cxc/facturas/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [facturas] = await dbPromesa.query('SELECT * FROM cxc_facturas WHERE ID_FACTURA = ?', [id]);
    if (facturas.length === 0) {
      return res.status(404).json({ success: false, message: 'Factura no encontrada.' });
    }

    const [detalleForaneos] = await dbPromesa.query(
      'SELECT CEDI_NAME, NUMERO, COSTO FROM cxc_facturas_foraneos_detalle WHERE ID_FACTURA = ? ORDER BY CEDI_NAME',
      [id]
    );

    res.json({ success: true, data: { ...facturas[0], foraneos_detalle: detalleForaneos } });
  } catch (error) {
    console.error('Error al consultar detalle de factura CXC:', error);
    res.status(500).json({ success: false, message: 'Error al consultar la factura.' });
  }
});

// --- RUTA: cambiar estatus de una factura (1=Generada,2=Pagada,3=Cancelada) ---
router.put('/cxc/facturas/:id/estatus', async (req, res) => {
  const { id } = req.params;
  const status = parseInt(req.body.status, 10);

  if (![1, 2, 3].includes(status)) {
    return res.status(400).json({ success: false, message: 'Estatus no válido.' });
  }

  try {
    await dbPromesa.query('UPDATE cxc_facturas SET ID_STATUS = ? WHERE ID_FACTURA = ?', [status, id]);
    res.json({ success: true, message: 'Estatus actualizado correctamente.' });
  } catch (error) {
    console.error('Error al actualizar estatus de factura CXC:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar el estatus.' });
  }
});

module.exports = router;
