// routes/trailerSeguros.js — Seguros del tráiler y su plan de pagos
//
// El proveedor (aseguradora) es obligatorio: viene del catálogo de
// proveedores que ya existe, y sin él no se puede registrar la póliza.
//
// El plan de pagos NO se captura: se calcula con
// utils/amortizacionSeguro.js a partir del valor, el plazo y el primer
// pago, y se guarda renglón por renglón para poder ir marcando qué se
// ha pagado.
'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { dbPromesa } = require('../config/db');
const { calcularPlanPagos } = require('../utils/amortizacionSeguro');
const { UPLOADS_DIR } = require('./checks');

// ── Póliza digitalizada y sus anexos ───────────────────────────────────
const DOCS_DIR = path.join(UPLOADS_DIR, 'seguros');
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

const uploadDocumento = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DOCS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `poliza-${req.params.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Solo se acepta PDF, JPG o PNG')),
});

// --- CATÁLOGOS DEL FORMULARIO ---
// El requisito es que exista proveedor, no que ya esté autorizado, así
// que solo se excluyen los rechazados (ESTATUS = 3). Los que están en
// autorización sí se pueden usar: de lo contrario el alta del seguro
// quedaría bloqueada por un flujo distinto.
router.get('/trailer-seguros/catalogos', async (_req, res) => {
  try {
    const [proveedores] = await dbPromesa.query(
      `SELECT ID_PROVEEDOR, NOMBRE_EMPRESARIAL, NOMBRE_PROVEEDOR, ESTATUS
         FROM proveedores
        WHERE ESTATUS <> 3
        ORDER BY NOMBRE_EMPRESARIAL`
    );
    const [trailers] = await dbPromesa.query(
      `SELECT ID_TRAILER, TRIM(CONCAT(COALESCE(NO_ECONOMICO,''), ' ', PLACAS)) AS NAME
         FROM trailers WHERE STATUS = 1 ORDER BY NO_ECONOMICO, PLACAS`
    );
    res.json({ success: true, proveedores, trailers });
  } catch (err) {
    console.error('Error al consultar catálogos de seguros:', err);
    res.status(500).json({ success: false, message: 'Error al consultar los catálogos.' });
  }
});

// --- VISTA PREVIA DEL PLAN (no guarda nada) ---
// La usa la pantalla para mostrar la tabla de pagos antes de grabar,
// reusando exactamente el mismo cálculo que se va a persistir.
router.post('/trailer-seguros/previsualizar', (req, res) => {
  const plan = calcularPlanPagos(req.body);
  if (plan.error) return res.status(400).json({ success: false, message: plan.error });
  res.json({ success: true, pagos: plan.pagos });
});

function validarPoliza(body) {
  if (!body.idTrailer) return 'Selecciona el tráiler.';
  if (!body.idProveedor) return 'Selecciona el proveedor: sin proveedor no se puede registrar el seguro.';
  return null;
}

async function guardarPagos(conexion, idSeguro, pagos) {
  await conexion.query('DELETE FROM trailer_seguro_pagos WHERE ID_SEGURO = ?', [idSeguro]);
  await conexion.query(
    'INSERT INTO trailer_seguro_pagos (ID_SEGURO, NUMERO_PAGO, FECHA_PROGRAMADA, MONTO) VALUES ?',
    [pagos.map(p => [idSeguro, p.numero, p.fecha, p.monto])]
  );
}

// --- ALTA ---
router.post('/trailer-seguros', async (req, res) => {
  const error = validarPoliza(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  const plan = calcularPlanPagos(req.body);
  if (plan.error) return res.status(400).json({ success: false, message: plan.error });

  const conexion = await dbPromesa.getConnection();
  try {
    await conexion.beginTransaction();

    const [resultado] = await conexion.query(
      `INSERT INTO trailer_seguros
         (ID_TRAILER, ID_PROVEEDOR, NUMERO_POLIZA, VALOR_SEGURO, PLAZO_MESES,
          PRIMER_PAGO, FECHA_PRIMER_PAGO, FECHA_INICIO, FECHA_VENCIMIENTO, OBSERVACIONES, USUARIO)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.body.idTrailer,
        req.body.idProveedor,
        (req.body.numeroPoliza || '').trim() || null,
        req.body.valorSeguro,
        req.body.plazoMeses,
        req.body.primerPago || 0,
        req.body.fechaPrimerPago,
        req.body.fechaInicio || null,
        req.body.fechaVencimiento || null,
        (req.body.observaciones || '').trim() || null,
        (req.body.usuario || 'Sistema').slice(0, 30),
      ]
    );

    await guardarPagos(conexion, resultado.insertId, plan.pagos);
    await conexion.commit();

    res.json({
      success: true,
      message: `Seguro registrado con ${plan.pagos.length} pago(s) programado(s).`,
      id_seguro: resultado.insertId,
    });
  } catch (err) {
    await conexion.rollback();
    console.error('Error al registrar el seguro:', err);
    res.status(500).json({ success: false, message: 'Error al registrar el seguro.' });
  } finally {
    conexion.release();
  }
});

// --- CAMBIO ---
// Si cambian valor, plazo, primer pago o fecha, el plan se vuelve a
// generar. Los pagos ya marcados como pagados se conservan por número
// de pago, para no perder el registro de lo que ya se cubrió.
router.put('/trailer-seguros/:id', async (req, res) => {
  const error = validarPoliza(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  const plan = calcularPlanPagos(req.body);
  if (plan.error) return res.status(400).json({ success: false, message: plan.error });

  const conexion = await dbPromesa.getConnection();
  try {
    await conexion.beginTransaction();

    const [pagados] = await conexion.query(
      'SELECT NUMERO_PAGO, FECHA_PAGO FROM trailer_seguro_pagos WHERE ID_SEGURO = ? AND PAGADO = 1',
      [req.params.id]
    );

    const [resultado] = await conexion.query(
      `UPDATE trailer_seguros
          SET ID_TRAILER = ?, ID_PROVEEDOR = ?, NUMERO_POLIZA = ?, VALOR_SEGURO = ?,
              PLAZO_MESES = ?, PRIMER_PAGO = ?, FECHA_PRIMER_PAGO = ?, FECHA_INICIO = ?,
              FECHA_VENCIMIENTO = ?, OBSERVACIONES = ?
        WHERE ID_SEGURO = ?`,
      [
        req.body.idTrailer,
        req.body.idProveedor,
        (req.body.numeroPoliza || '').trim() || null,
        req.body.valorSeguro,
        req.body.plazoMeses,
        req.body.primerPago || 0,
        req.body.fechaPrimerPago,
        req.body.fechaInicio || null,
        req.body.fechaVencimiento || null,
        (req.body.observaciones || '').trim() || null,
        req.params.id,
      ]
    );

    if (resultado.affectedRows === 0) {
      await conexion.rollback();
      return res.status(404).json({ success: false, message: 'Seguro no encontrado.' });
    }

    await guardarPagos(conexion, req.params.id, plan.pagos);

    for (const p of pagados) {
      await conexion.query(
        'UPDATE trailer_seguro_pagos SET PAGADO = 1, FECHA_PAGO = ? WHERE ID_SEGURO = ? AND NUMERO_PAGO = ?',
        [p.FECHA_PAGO, req.params.id, p.NUMERO_PAGO]
      );
    }

    await conexion.commit();
    res.json({ success: true, message: 'Seguro actualizado y plan de pagos recalculado.' });
  } catch (err) {
    await conexion.rollback();
    console.error('Error al actualizar el seguro:', err);
    res.status(500).json({ success: false, message: 'Error al actualizar el seguro.' });
  } finally {
    conexion.release();
  }
});

// --- LISTADO ---
router.get('/trailer-seguros', async (req, res) => {
  const condiciones = [];
  const params = [];
  if (req.query.trailer) {
    condiciones.push('s.ID_TRAILER = ?');
    params.push(req.query.trailer);
  }
  if (req.query.estatus === '0' || req.query.estatus === '1') {
    condiciones.push('s.ESTATUS = ?');
    params.push(req.query.estatus);
  }
  const whereSql = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  try {
    const [filas] = await dbPromesa.query(
      `SELECT s.*,
              TRIM(CONCAT(COALESCE(t.NO_ECONOMICO,''), ' ', t.PLACAS)) AS UNIDAD,
              p.NOMBRE_EMPRESARIAL AS PROVEEDOR,
              COALESCE(g.PAGADO, 0) AS TOTAL_PAGADO,
              (s.VALOR_SEGURO - COALESCE(g.PAGADO, 0)) AS SALDO,
              COALESCE(g.PAGOS_CUBIERTOS, 0) AS PAGOS_CUBIERTOS,
              COALESCE(g.TOTAL_PAGOS, 0) AS TOTAL_PAGOS,
              pr.FECHA_PROGRAMADA AS PROXIMO_PAGO_FECHA,
              pr.MONTO AS PROXIMO_PAGO_MONTO
         FROM trailer_seguros s
         LEFT JOIN trailers t ON t.ID_TRAILER = s.ID_TRAILER
         LEFT JOIN proveedores p ON p.ID_PROVEEDOR = s.ID_PROVEEDOR
         LEFT JOIN (
             SELECT ID_SEGURO,
                    SUM(CASE WHEN PAGADO = 1 THEN MONTO ELSE 0 END) AS PAGADO,
                    SUM(PAGADO) AS PAGOS_CUBIERTOS,
                    COUNT(*) AS TOTAL_PAGOS
               FROM trailer_seguro_pagos GROUP BY ID_SEGURO
         ) g ON g.ID_SEGURO = s.ID_SEGURO
         LEFT JOIN trailer_seguro_pagos pr
                ON pr.ID_PAGO = (
                     SELECT x.ID_PAGO FROM trailer_seguro_pagos x
                      WHERE x.ID_SEGURO = s.ID_SEGURO AND x.PAGADO = 0
                      ORDER BY x.FECHA_PROGRAMADA ASC, x.NUMERO_PAGO ASC LIMIT 1
                   )
         ${whereSql}
        ORDER BY s.ESTATUS DESC, s.FECHA_VENCIMIENTO IS NULL, s.FECHA_VENCIMIENTO ASC`,
      params
    );
    res.json({ success: true, data: filas });
  } catch (err) {
    console.error('Error al consultar seguros:', err);
    res.status(500).json({ success: false, message: 'Error al consultar los seguros.' });
  }
});

// --- DETALLE CON PLAN DE PAGOS ---
router.get('/trailer-seguros/:id', async (req, res) => {
  try {
    const [[seguro]] = await dbPromesa.query(
      `SELECT s.*, TRIM(CONCAT(COALESCE(t.NO_ECONOMICO,''), ' ', t.PLACAS)) AS UNIDAD,
              p.NOMBRE_EMPRESARIAL AS PROVEEDOR
         FROM trailer_seguros s
         LEFT JOIN trailers t ON t.ID_TRAILER = s.ID_TRAILER
         LEFT JOIN proveedores p ON p.ID_PROVEEDOR = s.ID_PROVEEDOR
        WHERE s.ID_SEGURO = ?`,
      [req.params.id]
    );
    if (!seguro) return res.status(404).json({ success: false, message: 'Seguro no encontrado.' });

    const [pagos] = await dbPromesa.query(
      `SELECT ID_PAGO, NUMERO_PAGO, FECHA_PROGRAMADA, MONTO, PAGADO, FECHA_PAGO, OBSERVACIONES
         FROM trailer_seguro_pagos WHERE ID_SEGURO = ? ORDER BY NUMERO_PAGO`,
      [req.params.id]
    );

    const [documentos] = await dbPromesa.query(
      'SELECT ID_DOCUMENTO, FILE_PATH, FILE_NAME, UPLOAD_DATE FROM trailer_seguro_documentos WHERE ID_SEGURO = ? ORDER BY UPLOAD_DATE DESC',
      [req.params.id]
    );

    res.json({ success: true, data: { ...seguro, pagos, documentos } });
  } catch (err) {
    console.error('Error al consultar el seguro:', err);
    res.status(500).json({ success: false, message: 'Error al consultar el seguro.' });
  }
});

// --- MARCAR / DESMARCAR UN PAGO ---
router.put('/trailer-seguros/pagos/:idPago', async (req, res) => {
  const pagado = req.body.pagado ? 1 : 0;
  try {
    const [resultado] = await dbPromesa.query(
      'UPDATE trailer_seguro_pagos SET PAGADO = ?, FECHA_PAGO = ?, OBSERVACIONES = ? WHERE ID_PAGO = ?',
      [
        pagado,
        pagado ? (req.body.fechaPago || new Date().toISOString().split('T')[0]) : null,
        (req.body.observaciones || '').trim() || null,
        req.params.idPago,
      ]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Pago no encontrado.' });
    }
    res.json({ success: true, message: pagado ? 'Pago registrado.' : 'Pago marcado como pendiente.' });
  } catch (err) {
    console.error('Error al actualizar el pago del seguro:', err);
    res.status(500).json({ success: false, message: 'Error al actualizar el pago.' });
  }
});

// --- CANCELAR / REACTIVAR LA PÓLIZA ---
router.put('/trailer-seguros/:id/estatus', async (req, res) => {
  const estatus = parseInt(req.body.estatus, 10);
  if (estatus !== 0 && estatus !== 1) {
    return res.status(400).json({ success: false, message: 'Estatus no válido.' });
  }
  try {
    const [resultado] = await dbPromesa.query(
      'UPDATE trailer_seguros SET ESTATUS = ? WHERE ID_SEGURO = ?',
      [estatus, req.params.id]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Seguro no encontrado.' });
    }
    res.json({ success: true, message: estatus === 0 ? 'Póliza cancelada.' : 'Póliza reactivada.' });
  } catch (err) {
    console.error('Error al cambiar el estatus del seguro:', err);
    res.status(500).json({ success: false, message: 'Error al cambiar el estatus.' });
  }
});

// --- PÓLIZA DIGITALIZADA Y ANEXOS ---
router.post('/trailer-seguros/:id/documentos', uploadDocumento.single('documento'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió ningún archivo.' });

  try {
    const [resultado] = await dbPromesa.query(
      'INSERT INTO trailer_seguro_documentos (ID_SEGURO, FILE_PATH, FILE_NAME) VALUES (?, ?, ?)',
      [req.params.id, `/uploads/seguros/${req.file.filename}`, req.file.originalname]
    );
    res.json({ success: true, message: 'Documento agregado.', id_documento: resultado.insertId });
  } catch (err) {
    console.error('Error al guardar el documento de la póliza:', err);
    res.status(500).json({ success: false, message: 'Error al guardar el documento.' });
  }
});

router.delete('/trailer-seguros/documentos/:idDocumento', async (req, res) => {
  try {
    const [rows] = await dbPromesa.query(
      'SELECT FILE_PATH FROM trailer_seguro_documentos WHERE ID_DOCUMENTO = ?',
      [req.params.idDocumento]
    );
    if (rows.length === 0) return res.json({ success: false, message: 'Documento no encontrado.' });

    await dbPromesa.query('DELETE FROM trailer_seguro_documentos WHERE ID_DOCUMENTO = ?', [req.params.idDocumento]);
    fs.unlink(path.join(UPLOADS_DIR, rows[0].FILE_PATH.replace(/^\/uploads\//, '')), () => {});

    res.json({ success: true, message: 'Documento eliminado.' });
  } catch (err) {
    console.error('Error al eliminar el documento de la póliza:', err);
    res.status(500).json({ success: false, message: 'Error al eliminar el documento.' });
  }
});

module.exports = router;
