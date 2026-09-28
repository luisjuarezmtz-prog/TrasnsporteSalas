// routes/mantenimientos.js — Mantenimientos y Gestorías con orden de compra
//
// Un solo módulo para los dos: comparten unidad, proveedor, monto,
// comprobante y autorización; se distinguen con TIPO
// (MANTENIMIENTO / GESTORIA) y un catálogo de subtipos.
//
// La orden de compra NO es un documento aparte: es el paso de
// autorización de este mismo registro. Al autorizar se genera el
// FOLIO_OC y se sella quién y cuándo, igual que el flujo de nómina que
// el sistema ya usa.
'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { dbPromesa } = require('../config/db');
const { UPLOADS_DIR } = require('./checks');

// ── Comprobantes ───────────────────────────────────────────────────────
const DOCS_DIR = path.join(UPLOADS_DIR, 'mantenimientos');
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

const uploadDocumento = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DOCS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `mant-${req.params.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Solo se acepta PDF, JPG o PNG')),
});

const TIPOS = ['MANTENIMIENTO', 'GESTORIA'];
const TIPOS_UNIDAD = ['TRAILER', 'CAJA'];
const TIPOS_DOCUMENTO = ['FACTURA', 'COMPROBANTE_PAGO', 'OTRO'];

// Ciclo de vida de la orden. Solo se permiten estos saltos: evita que
// una orden concluida vuelva a "solicitada" o que se salte la
// autorización.
const TRANSICIONES = {
  SOLICITADA: ['AUTORIZADA', 'CANCELADA'],
  AUTORIZADA: ['EN_PROCESO', 'CONCLUIDA', 'CANCELADA'],
  EN_PROCESO: ['CONCLUIDA', 'CANCELADA'],
  CONCLUIDA: [],
  CANCELADA: [],
};

// --- CATÁLOGOS DEL FORMULARIO ---
router.get('/mantenimientos/catalogos', async (_req, res) => {
  try {
    const [tipos] = await dbPromesa.query(
      'SELECT ID_TIPO, TIPO, NOMBRE FROM c_tipos_mantenimiento WHERE STATUS = 1 ORDER BY TIPO, NOMBRE'
    );
    const [proveedores] = await dbPromesa.query(
      `SELECT ID_PROVEEDOR, NOMBRE_EMPRESARIAL, NOMBRE_PROVEEDOR
         FROM proveedores WHERE ESTATUS <> 3 ORDER BY NOMBRE_EMPRESARIAL`
    );
    const [trailers] = await dbPromesa.query(
      `SELECT ID_TRAILER, PLACAS, TRIM(CONCAT(COALESCE(NO_ECONOMICO,''), ' ', PLACAS)) AS NAME
         FROM trailers WHERE STATUS = 1 ORDER BY NO_ECONOMICO, PLACAS`
    );
    res.json({ success: true, tipos, proveedores, trailers });
  } catch (err) {
    console.error('Error al consultar catálogos de mantenimientos:', err);
    res.status(500).json({ success: false, message: 'Error al consultar los catálogos.' });
  }
});

function validar(body) {
  if (!TIPOS.includes(body.tipo)) return 'El tipo debe ser Mantenimiento o Gestoría.';
  if (!body.idTipo) return 'Selecciona el concepto.';
  if (!TIPOS_UNIDAD.includes(body.tipoUnidad)) return 'El tipo de unidad no es válido.';
  if (body.tipoUnidad === 'TRAILER' && !body.idTrailer) return 'Selecciona el tráiler.';
  if (body.tipoUnidad === 'CAJA' && !String(body.unidadPlacas || '').trim()) {
    return 'Captura las placas de la caja.';
  }
  if (!body.idProveedor) return 'Selecciona el proveedor: toda orden de compra necesita a quién se le paga.';
  if (!body.fechaSolicitud) return 'La fecha de solicitud es obligatoria.';
  if (Number(body.montoEstimado) < 0) return 'El monto estimado no puede ser negativo.';
  return null;
}

async function valoresComunes(body) {
  // Para tráiler las placas se copian del catálogo, para que el
  // histórico no cambie si después se corrigen en la ficha.
  let placas = (body.unidadPlacas || '').trim() || null;
  if (body.tipoUnidad === 'TRAILER' && body.idTrailer) {
    const [[t]] = await dbPromesa.query('SELECT PLACAS FROM trailers WHERE ID_TRAILER = ?', [body.idTrailer]);
    if (t) placas = t.PLACAS;
  }

  return [
    body.tipo,
    body.idTipo,
    body.tipoUnidad,
    body.tipoUnidad === 'TRAILER' ? body.idTrailer : null,
    placas,
    body.idProveedor,
    (body.descripcion || '').trim() || null,
    body.fechaSolicitud,
    body.fechaProgramada || null,
    body.odometro || null,
    body.montoEstimado || 0,
    body.fechaVencimientoNueva || null,
    body.fechaPago || null,
    (body.observaciones || '').trim() || null,
  ];
}

// Inserta los puntos que vengan junto con la orden. La pantalla los
// puede capturar antes de guardar, así que llegan en el mismo POST en
// vez de N llamadas sueltas.
async function insertarPuntos(idMantenimiento, puntos) {
  if (!Array.isArray(puntos) || puntos.length === 0) return;

  const filas = puntos
    .filter(p => p && String(p.descripcion || '').trim())
    .map((p, i) => [
      idMantenimiento,
      i + 1,
      String(p.descripcion).trim().slice(0, 255),
      p.cantidad || 1,
      p.costo === '' || p.costo === undefined || p.costo === null ? null : p.costo,
      String(p.observaciones || '').trim().slice(0, 255) || null,
    ]);
  if (filas.length === 0) return;

  await dbPromesa.query(
    `INSERT INTO mantenimiento_detalle (ID_MANTENIMIENTO, ORDEN, DESCRIPCION, CANTIDAD, COSTO, OBSERVACIONES)
     VALUES ?`,
    [filas]
  );
}

// --- COMPARATIVO DE SERVICIOS REPETIDOS ---
// Responde a "¿por qué se le han hecho tantos servicios del mismo
// tipo a esta unidad?": agrupa las órdenes concluidas por unidad y
// concepto, y para cada grupo devuelve cuántas van, cuánto se ha
// gastado y cada cuántos días en promedio se repite. Solo cuenta
// CONCLUIDAS: una solicitud que nunca se autorizó no es un servicio
// que haya pasado.
router.get('/mantenimientos/comparativo', async (req, res) => {
  const minimo = Math.max(parseInt(req.query.minimo, 10) || 2, 1);

  const condiciones = ["m.ESTATUS = 'CONCLUIDA'"];
  const params = [];
  if (req.query.tipo && TIPOS.includes(req.query.tipo)) {
    condiciones.push('m.TIPO = ?');
    params.push(req.query.tipo);
  }
  if (req.query.fechaInicio && req.query.fechaFin) {
    condiciones.push('m.FECHA_SOLICITUD BETWEEN ? AND ?');
    params.push(req.query.fechaInicio, req.query.fechaFin);
  }

  try {
    const [grupos] = await dbPromesa.query(
      `SELECT m.UNIDAD_PLACAS, m.ID_TRAILER, m.TIPO, m.ID_TIPO, c.NOMBRE AS CONCEPTO,
              COUNT(*) AS VECES,
              SUM(COALESCE(m.MONTO_REAL, m.MONTO_ESTIMADO)) AS GASTO_TOTAL,
              MIN(m.FECHA_SOLICITUD) AS PRIMERA,
              MAX(m.FECHA_SOLICITUD) AS ULTIMA,
              DATEDIFF(MAX(m.FECHA_SOLICITUD), MIN(m.FECHA_SOLICITUD)) AS DIAS_RANGO
         FROM mantenimientos m
         INNER JOIN c_tipos_mantenimiento c ON c.ID_TIPO = m.ID_TIPO
        WHERE ${condiciones.join(' AND ')}
        GROUP BY m.UNIDAD_PLACAS, m.ID_TRAILER, m.TIPO, m.ID_TIPO, c.NOMBRE
       HAVING VECES >= ?
        ORDER BY VECES DESC, GASTO_TOTAL DESC`,
      [...params, minimo]
    );

    // Días promedio entre servicios: con N repeticiones hay N-1
    // intervalos, no N. Es el dato que delata si algo se está
    // rehaciendo demasiado seguido.
    const data = grupos.map(g => ({
      ...g,
      DIAS_PROMEDIO: g.VECES > 1 ? Math.round(g.DIAS_RANGO / (g.VECES - 1)) : null,
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error al generar el comparativo de servicios:', err);
    res.status(500).json({ success: false, message: 'Error al generar el comparativo.' });
  }
});

// --- DETALLE DE UN GRUPO DEL COMPARATIVO ---
// Las órdenes de esa unidad+concepto con los puntos que se hicieron en
// cada una: es lo que permite ver si se repitió el mismo trabajo.
router.get('/mantenimientos/comparativo/detalle', async (req, res) => {
  const { unidad, idTipo } = req.query;
  if (!unidad || !idTipo) {
    return res.status(400).json({ success: false, message: 'Faltan unidad y concepto.' });
  }

  try {
    const [ordenes] = await dbPromesa.query(
      `SELECT m.ID_MANTENIMIENTO, m.FOLIO_OC, m.FECHA_SOLICITUD, m.FECHA_CONCLUSION,
              m.ODOMETRO, m.MONTO_ESTIMADO, m.MONTO_REAL, m.DESCRIPCION,
              p.NOMBRE_EMPRESARIAL AS PROVEEDOR
         FROM mantenimientos m
         LEFT JOIN proveedores p ON p.ID_PROVEEDOR = m.ID_PROVEEDOR
        WHERE m.UNIDAD_PLACAS = ? AND m.ID_TIPO = ? AND m.ESTATUS = 'CONCLUIDA'
        ORDER BY m.FECHA_SOLICITUD ASC`,
      [unidad, idTipo]
    );

    const ids = ordenes.map(o => o.ID_MANTENIMIENTO);
    const [puntos] = ids.length
      ? await dbPromesa.query(
          `SELECT ID_MANTENIMIENTO, DESCRIPCION, CANTIDAD, COSTO, OBSERVACIONES
             FROM mantenimiento_detalle WHERE ID_MANTENIMIENTO IN (?)
            ORDER BY ID_MANTENIMIENTO, ORDEN, ID_DETALLE`,
          [ids]
        )
      : [[]];

    // Un punto que aparece en varias órdenes del grupo es justo la
    // señal que se está buscando: se marca para que salte a la vista.
    const vecesPorPunto = new Map();
    puntos.forEach(p => {
      const clave = p.DESCRIPCION.trim().toLowerCase();
      if (!vecesPorPunto.has(clave)) vecesPorPunto.set(clave, new Set());
      vecesPorPunto.get(clave).add(p.ID_MANTENIMIENTO);
    });

    const data = ordenes.map(o => ({
      ...o,
      puntos: puntos
        .filter(p => p.ID_MANTENIMIENTO === o.ID_MANTENIMIENTO)
        .map(p => ({
          ...p,
          REPETIDO_EN: vecesPorPunto.get(p.DESCRIPCION.trim().toLowerCase()).size,
        })),
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('Error al consultar el detalle del comparativo:', err);
    res.status(500).json({ success: false, message: 'Error al consultar el detalle.' });
  }
});

// --- ALTA ---
router.post('/mantenimientos', async (req, res) => {
  const error = validar(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  try {
    const [resultado] = await dbPromesa.query(
      `INSERT INTO mantenimientos
         (TIPO, ID_TIPO, TIPO_UNIDAD, ID_TRAILER, UNIDAD_PLACAS, ID_PROVEEDOR, DESCRIPCION,
          FECHA_SOLICITUD, FECHA_PROGRAMADA, ODOMETRO, MONTO_ESTIMADO,
          FECHA_VENCIMIENTO_NUEVA, FECHA_PAGO, OBSERVACIONES, USUARIO)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [...(await valoresComunes(req.body)), (req.body.usuario || 'Sistema').slice(0, 30)]
    );

    await insertarPuntos(resultado.insertId, req.body.puntos);

    res.json({
      success: true,
      message: 'Solicitud registrada. Queda pendiente de autorizar para generar la orden de compra.',
      id_mantenimiento: resultado.insertId,
    });
  } catch (err) {
    console.error('Error al registrar el mantenimiento:', err);
    res.status(500).json({ success: false, message: 'Error al registrar la solicitud.' });
  }
});

// --- CAMBIO ---
// Una orden ya autorizada no se puede editar en lo que afecta el gasto
// aprobado: para eso está cancelar y levantar una nueva.
router.put('/mantenimientos/:id', async (req, res) => {
  const error = validar(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  try {
    const [[actual]] = await dbPromesa.query(
      'SELECT ESTATUS FROM mantenimientos WHERE ID_MANTENIMIENTO = ?',
      [req.params.id]
    );
    if (!actual) return res.status(404).json({ success: false, message: 'Registro no encontrado.' });
    if (actual.ESTATUS !== 'SOLICITADA') {
      return res.status(400).json({
        success: false,
        message: `Esta orden ya está ${actual.ESTATUS.toLowerCase()}. Solo se puede editar mientras está solicitada; si cambió el alcance, cancélala y levanta una nueva.`,
      });
    }

    await dbPromesa.query(
      `UPDATE mantenimientos
          SET TIPO = ?, ID_TIPO = ?, TIPO_UNIDAD = ?, ID_TRAILER = ?, UNIDAD_PLACAS = ?,
              ID_PROVEEDOR = ?, DESCRIPCION = ?, FECHA_SOLICITUD = ?, FECHA_PROGRAMADA = ?,
              ODOMETRO = ?, MONTO_ESTIMADO = ?, FECHA_VENCIMIENTO_NUEVA = ?, FECHA_PAGO = ?,
              OBSERVACIONES = ?
        WHERE ID_MANTENIMIENTO = ?`,
      [...(await valoresComunes(req.body)), req.params.id]
    );
    res.json({ success: true, message: 'Solicitud actualizada.' });
  } catch (err) {
    console.error('Error al actualizar el mantenimiento:', err);
    res.status(500).json({ success: false, message: 'Error al actualizar la solicitud.' });
  }
});

// --- CAMBIO DE ESTATUS (aquí vive la orden de compra) ---
router.put('/mantenimientos/:id/estatus', async (req, res) => {
  const nuevo = String(req.body.estatus || '').toUpperCase();
  const usuario = (req.body.usuario || 'Sistema').slice(0, 30);

  const conexion = await dbPromesa.getConnection();
  try {
    await conexion.beginTransaction();

    const [[actual]] = await conexion.query(
      'SELECT ESTATUS, FOLIO_OC FROM mantenimientos WHERE ID_MANTENIMIENTO = ? FOR UPDATE',
      [req.params.id]
    );
    if (!actual) {
      await conexion.rollback();
      return res.status(404).json({ success: false, message: 'Registro no encontrado.' });
    }

    const permitidos = TRANSICIONES[actual.ESTATUS] || [];
    if (!permitidos.includes(nuevo)) {
      await conexion.rollback();
      return res.status(400).json({
        success: false,
        message: permitidos.length
          ? `Desde ${actual.ESTATUS} solo se puede pasar a: ${permitidos.join(', ')}.`
          : `Una orden ${actual.ESTATUS.toLowerCase()} ya no cambia de estatus.`,
      });
    }

    // Concluir exige el costo real: es lo que permite comparar contra
    // el monto autorizado.
    if (nuevo === 'CONCLUIDA' && (req.body.montoReal === undefined || req.body.montoReal === null || req.body.montoReal === '')) {
      await conexion.rollback();
      return res.status(400).json({ success: false, message: 'Para concluir la orden captura el monto real.' });
    }

    let folio = actual.FOLIO_OC;
    if (nuevo === 'AUTORIZADA' && !folio) {
      // El consecutivo va sobre los folios YA EMITIDOS, no sobre el id:
      // el registro ya existe en este punto y las solicitudes que nunca
      // se autorizan no deben consumir número de orden. El UNIQUE de
      // FOLIO_OC atrapa cualquier empate por concurrencia.
      const [[{ ultimo }]] = await conexion.query(
        'SELECT MAX(CAST(SUBSTRING(FOLIO_OC, 4) AS UNSIGNED)) AS ultimo FROM mantenimientos WHERE FOLIO_OC IS NOT NULL'
      );
      folio = `OC-${String((ultimo || 0) + 1).padStart(5, '0')}`;

      await conexion.query(
        `UPDATE mantenimientos
            SET ESTATUS = ?, FOLIO_OC = ?, AUTORIZADO_POR = ?, FECHA_AUTORIZACION = NOW()
          WHERE ID_MANTENIMIENTO = ?`,
        [nuevo, folio, usuario, req.params.id]
      );
    } else if (nuevo === 'CONCLUIDA') {
      await conexion.query(
        `UPDATE mantenimientos
            SET ESTATUS = ?, MONTO_REAL = ?, FECHA_CONCLUSION = ?
          WHERE ID_MANTENIMIENTO = ?`,
        [nuevo, req.body.montoReal, req.body.fechaConclusion || new Date().toISOString().split('T')[0], req.params.id]
      );
    } else {
      await conexion.query(
        'UPDATE mantenimientos SET ESTATUS = ? WHERE ID_MANTENIMIENTO = ?',
        [nuevo, req.params.id]
      );
    }

    await conexion.commit();

    const mensajes = {
      AUTORIZADA: `Orden de compra ${folio} autorizada.`,
      EN_PROCESO: 'Orden marcada en proceso.',
      CONCLUIDA: 'Orden concluida.',
      CANCELADA: 'Orden cancelada.',
    };
    res.json({ success: true, message: mensajes[nuevo], folio_oc: folio });
  } catch (err) {
    await conexion.rollback();
    console.error('Error al cambiar el estatus del mantenimiento:', err);
    res.status(500).json({ success: false, message: 'Error al cambiar el estatus.' });
  } finally {
    conexion.release();
  }
});

// --- REGISTRAR / QUITAR EL PAGO ---
// Concluir y pagar son momentos distintos: el taller puede entregar el
// día 10 y cobrarse el día 30. Por eso el pago tiene su propio endpoint
// y no viaja en el PUT general, que está bloqueado tras la autorización.
router.put('/mantenimientos/:id/pago', async (req, res) => {
  const fechaPago = req.body.fechaPago || null;

  try {
    const [[actual]] = await dbPromesa.query(
      'SELECT ESTATUS FROM mantenimientos WHERE ID_MANTENIMIENTO = ?',
      [req.params.id]
    );
    if (!actual) return res.status(404).json({ success: false, message: 'Registro no encontrado.' });

    // Lo único sin sentido es pagar algo cancelado: hay talleres que
    // cobran al momento y la orden se captura después, así que exigir
    // que ya esté autorizada estorbaba más de lo que protegía.
    if (fechaPago && actual.ESTATUS === 'CANCELADA') {
      return res.status(400).json({
        success: false,
        message: 'No se puede registrar el pago de una orden cancelada.',
      });
    }

    await dbPromesa.query(
      'UPDATE mantenimientos SET FECHA_PAGO = ? WHERE ID_MANTENIMIENTO = ?',
      [fechaPago, req.params.id]
    );
    res.json({
      success: true,
      message: fechaPago ? 'Pago registrado.' : 'Se quitó la fecha de pago.',
    });
  } catch (err) {
    console.error('Error al registrar el pago del mantenimiento:', err);
    res.status(500).json({ success: false, message: 'Error al registrar el pago.' });
  }
});

// --- LISTADO ---
router.get('/mantenimientos', async (req, res) => {
  const { tipo, estatus, trailer, fechaInicio, fechaFin } = req.query;

  const condiciones = [];
  const params = [];
  if (tipo && TIPOS.includes(tipo)) { condiciones.push('m.TIPO = ?'); params.push(tipo); }
  if (estatus) { condiciones.push('m.ESTATUS = ?'); params.push(estatus); }
  if (trailer) { condiciones.push('m.ID_TRAILER = ?'); params.push(trailer); }
  if (fechaInicio && fechaFin) {
    condiciones.push('m.FECHA_SOLICITUD BETWEEN ? AND ?');
    params.push(fechaInicio, fechaFin);
  }
  const whereSql = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  try {
    const [filas] = await dbPromesa.query(
      `SELECT m.*, c.NOMBRE AS CONCEPTO,
              p.NOMBRE_EMPRESARIAL AS PROVEEDOR,
              t.NO_ECONOMICO,
              (SELECT COUNT(*) FROM mantenimiento_documentos d WHERE d.ID_MANTENIMIENTO = m.ID_MANTENIMIENTO) AS TOTAL_DOCUMENTOS,
              (SELECT COUNT(*) FROM mantenimiento_detalle x WHERE x.ID_MANTENIMIENTO = m.ID_MANTENIMIENTO) AS TOTAL_PUNTOS,
              (SELECT COUNT(*) FROM mantenimiento_documentos d
                WHERE d.ID_MANTENIMIENTO = m.ID_MANTENIMIENTO AND d.TIPO_DOCUMENTO = 'COMPROBANTE_PAGO') AS TIENE_COMPROBANTE_PAGO,
              (m.MONTO_REAL - m.MONTO_ESTIMADO) AS DIFERENCIA
         FROM mantenimientos m
         INNER JOIN c_tipos_mantenimiento c ON c.ID_TIPO = m.ID_TIPO
         LEFT JOIN proveedores p ON p.ID_PROVEEDOR = m.ID_PROVEEDOR
         LEFT JOIN trailers t ON t.ID_TRAILER = m.ID_TRAILER
         ${whereSql}
        ORDER BY m.FECHA_SOLICITUD DESC, m.ID_MANTENIMIENTO DESC`,
      params
    );
    res.json({ success: true, data: filas });
  } catch (err) {
    console.error('Error al consultar mantenimientos:', err);
    res.status(500).json({ success: false, message: 'Error al consultar los mantenimientos.' });
  }
});

// --- DETALLE ---
router.get('/mantenimientos/:id', async (req, res) => {
  try {
    const [[registro]] = await dbPromesa.query(
      `SELECT m.*, c.NOMBRE AS CONCEPTO, p.NOMBRE_EMPRESARIAL AS PROVEEDOR
         FROM mantenimientos m
         INNER JOIN c_tipos_mantenimiento c ON c.ID_TIPO = m.ID_TIPO
         LEFT JOIN proveedores p ON p.ID_PROVEEDOR = m.ID_PROVEEDOR
        WHERE m.ID_MANTENIMIENTO = ?`,
      [req.params.id]
    );
    if (!registro) return res.status(404).json({ success: false, message: 'Registro no encontrado.' });

    const [documentos] = await dbPromesa.query(
      'SELECT ID_DOCUMENTO, TIPO_DOCUMENTO, FILE_PATH, FILE_NAME, UPLOAD_DATE FROM mantenimiento_documentos WHERE ID_MANTENIMIENTO = ? ORDER BY UPLOAD_DATE DESC',
      [req.params.id]
    );

    const [puntos] = await dbPromesa.query(
      'SELECT ID_DETALLE, ORDEN, DESCRIPCION, CANTIDAD, COSTO, OBSERVACIONES FROM mantenimiento_detalle WHERE ID_MANTENIMIENTO = ? ORDER BY ORDEN, ID_DETALLE',
      [req.params.id]
    );

    res.json({ success: true, data: { ...registro, documentos, puntos } });
  } catch (err) {
    console.error('Error al consultar el mantenimiento:', err);
    res.status(500).json({ success: false, message: 'Error al consultar el registro.' });
  }
});

// --- COMPROBANTES ---
router.post('/mantenimientos/:id/documentos', uploadDocumento.single('documento'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió ningún archivo.' });

  const tipoDocumento = TIPOS_DOCUMENTO.includes(req.body.tipoDocumento)
    ? req.body.tipoDocumento
    : 'FACTURA';

  try {
    const [resultado] = await dbPromesa.query(
      'INSERT INTO mantenimiento_documentos (ID_MANTENIMIENTO, TIPO_DOCUMENTO, FILE_PATH, FILE_NAME) VALUES (?, ?, ?, ?)',
      [req.params.id, tipoDocumento, `/uploads/mantenimientos/${req.file.filename}`, req.file.originalname]
    );
    res.json({ success: true, message: 'Documento agregado.', id_documento: resultado.insertId });
  } catch (err) {
    console.error('Error al guardar el comprobante:', err);
    res.status(500).json({ success: false, message: 'Error al guardar el comprobante.' });
  }
});

router.delete('/mantenimientos/documentos/:idDocumento', async (req, res) => {
  try {
    const [rows] = await dbPromesa.query(
      'SELECT FILE_PATH FROM mantenimiento_documentos WHERE ID_DOCUMENTO = ?',
      [req.params.idDocumento]
    );
    if (rows.length === 0) return res.json({ success: false, message: 'Comprobante no encontrado.' });

    await dbPromesa.query('DELETE FROM mantenimiento_documentos WHERE ID_DOCUMENTO = ?', [req.params.idDocumento]);
    fs.unlink(path.join(UPLOADS_DIR, rows[0].FILE_PATH.replace(/^\/uploads\//, '')), () => {});

    res.json({ success: true, message: 'Comprobante eliminado.' });
  } catch (err) {
    console.error('Error al eliminar el comprobante:', err);
    res.status(500).json({ success: false, message: 'Error al eliminar el comprobante.' });
  }
});

// --- PUNTOS REALIZADOS (lista, no checklist) ---
router.post('/mantenimientos/:id/detalle', async (req, res) => {
  const descripcion = String(req.body.descripcion || '').trim();
  if (!descripcion) return res.status(400).json({ success: false, message: 'Captura el punto realizado.' });

  try {
    const [[fila]] = await dbPromesa.query(
      'SELECT COALESCE(MAX(ORDEN), 0) + 1 AS siguiente FROM mantenimiento_detalle WHERE ID_MANTENIMIENTO = ?',
      [req.params.id]
    );

    const [resultado] = await dbPromesa.query(
      `INSERT INTO mantenimiento_detalle (ID_MANTENIMIENTO, ORDEN, DESCRIPCION, CANTIDAD, COSTO, OBSERVACIONES)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        fila.siguiente,
        descripcion,
        req.body.cantidad || 1,
        req.body.costo === '' || req.body.costo === undefined || req.body.costo === null ? null : req.body.costo,
        String(req.body.observaciones || '').trim() || null,
      ]
    );
    res.json({ success: true, message: 'Punto agregado.', id_detalle: resultado.insertId });
  } catch (err) {
    console.error('Error al agregar el punto:', err);
    res.status(500).json({ success: false, message: 'Error al agregar el punto.' });
  }
});

router.delete('/mantenimientos/detalle/:idDetalle', async (req, res) => {
  try {
    const [resultado] = await dbPromesa.query(
      'DELETE FROM mantenimiento_detalle WHERE ID_DETALLE = ?',
      [req.params.idDetalle]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Punto no encontrado.' });
    }
    res.json({ success: true, message: 'Punto eliminado.' });
  } catch (err) {
    console.error('Error al eliminar el punto:', err);
    res.status(500).json({ success: false, message: 'Error al eliminar el punto.' });
  }
});

module.exports = router;
