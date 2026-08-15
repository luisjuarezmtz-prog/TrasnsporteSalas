// routes/proveedores.js — Alta, edición, baja/reactivación y consulta de proveedores
//
// Mismo patrón que routes/empleados.js: ficha principal + secciones
// relacionadas (contacto de referencia, cuenta bancaria, dirección,
// documentos). A diferencia de empleados, el contacto de referencia y la
// dirección son 1 solo registro por proveedor (no una lista), así que se
// manejan con INSERT ... ON DUPLICATE KEY UPDATE sobre una columna UNIQUE.
'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { db, dbPromesa } = require('../config/db');
const { UPLOADS_DIR } = require('./checks');

// ── Subida de documentos del proveedor ─────────────────────────────────
const DOCS_DIR = path.join(UPLOADS_DIR, 'proveedores', 'documentos');
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

const storageDocumento = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DOCS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `doc-${req.params.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  }
});
const uploadDocumento = multer({
  storage: storageDocumento,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Solo se acepta PDF, JPG o PNG'))
});

// --- CATÁLOGOS PARA EL FORMULARIO DE ALTA/EDICIÓN DE PROVEEDORES ---
router.get('/proveedores-catalogos', (req, res) => {
  const queries = {
    bancos: 'SELECT ID_BANCO, BANCO_NAME FROM c_bancos WHERE STATUS = 1 ORDER BY BANCO_NAME ASC',
    tiposDocumento: 'SELECT ID_DOCUMENT_TYPE, DOCUMENT_TYPE_NAME FROM c_document_types_proveedor WHERE STATUS = 1 ORDER BY DOCUMENT_TYPE_NAME ASC'
  };

  const resultado = {};
  const claves = Object.keys(queries);
  let pendientes = claves.length;
  let huboError = false;

  claves.forEach(clave => {
    db.query(queries[clave], (err, rows) => {
      if (huboError) return;
      if (err) {
        huboError = true;
        console.error(`Error al consultar catálogo ${clave}:`, err);
        return res.status(500).json({ success: false, message: 'Error al consultar catálogos.' });
      }
      resultado[clave] = rows;
      pendientes--;
      if (pendientes === 0) res.json({ success: true, ...resultado });
    });
  });
});

// --- CONSULTA DE PROVEEDORES (filtrable por estatus/búsqueda) ---
router.get('/proveedores-consulta', (req, res) => {
  const { estatus, busqueda } = req.query; // estatus: '1' | '0' | 'todos' (u omitido)

  let query = `
        SELECT ID_PROVEEDOR, ESTATUS, NOMBRE_EMPRESARIAL, NOMBRE_PROVEEDOR, RFC,
               DIAS_CREDITO, TELEFONO, USERNAME, CREATION_DATE
        FROM proveedores
        WHERE 1=1`;

  const params = [];

  if (estatus === '1' || estatus === '2' || estatus === '3') {
    query += ' AND ESTATUS = ?';
    params.push(estatus);
  }

  if (busqueda) {
    query += ` AND (NOMBRE_EMPRESARIAL LIKE ? OR NOMBRE_PROVEEDOR LIKE ? OR RFC LIKE ?)`;
    const like = `%${busqueda}%`;
    params.push(like, like, like);
  }

  query += ' ORDER BY NOMBRE_EMPRESARIAL ASC';

  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Error al consultar proveedores:', err);
      return res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
    res.json({ success: true, data: results });
  });
});

// --- DETALLE DE UN PROVEEDOR (para precargar el formulario de edición) ---
router.get('/proveedores/:id/detalle', (req, res) => {
  const { id } = req.params;
  db.query('SELECT * FROM proveedores WHERE ID_PROVEEDOR = ?', [id], (err, results) => {
    if (err) {
      console.error('Error al consultar proveedor:', err);
      return res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
    if (results.length === 0) return res.json({ success: false, message: 'Proveedor no encontrado.' });
    res.json({ success: true, data: results[0] });
  });
});

// --- ALTA DE PROVEEDOR ---
// Nace en ESTATUS = 1 ("En Autorización"); alguien debe autorizarlo (2) o
// rechazarlo (3) desde la tabla antes de considerarlo un proveedor válido.
router.post('/proveedores', (req, res) => {
  const d = req.body;

  if (!d.nombre_empresarial) {
    return res.status(400).json({ success: false, message: 'El nombre empresarial es obligatorio.' });
  }

  const query = `
        INSERT INTO proveedores (
            ESTATUS, NOMBRE_EMPRESARIAL, NOMBRE_PROVEEDOR, RFC, DIAS_CREDITO, TELEFONO, USERNAME, CREATION_DATE
        ) VALUES (1, ?, ?, ?, ?, ?, ?, NOW())`;

  const valores = [
    d.nombre_empresarial || '', d.nombre_proveedor || '', d.rfc || '',
    d.dias_credito || null, d.telefono || '', d.username || 'Sistema'
  ];

  db.query(query, valores, (err, result) => {
    if (err) {
      console.error('Error al dar de alta proveedor:', err);
      return res.status(500).json({ success: false, message: 'Error al registrar el proveedor.' });
    }
    res.json({ success: true, message: 'Proveedor registrado correctamente.', id_proveedor: result.insertId });
  });
});

// --- ACTUALIZAR (CAMBIO) DE PROVEEDOR ---
router.put('/proveedores/:id', (req, res) => {
  const { id } = req.params;
  const d = req.body;

  if (!d.nombre_empresarial) {
    return res.status(400).json({ success: false, message: 'El nombre empresarial es obligatorio.' });
  }

  const query = `
        UPDATE proveedores SET
            NOMBRE_EMPRESARIAL = ?, NOMBRE_PROVEEDOR = ?, RFC = ?, DIAS_CREDITO = ?, TELEFONO = ?
        WHERE ID_PROVEEDOR = ?`;

  const valores = [
    d.nombre_empresarial || '', d.nombre_proveedor || '', d.rfc || '',
    d.dias_credito || null, d.telefono || '',
    id
  ];

  db.query(query, valores, (err) => {
    if (err) {
      console.error('Error al actualizar proveedor:', err);
      return res.status(500).json({ success: false, message: 'Error al actualizar el proveedor.' });
    }
    res.json({ success: true, message: 'Proveedor actualizado correctamente.' });
  });
});

// --- AUTORIZAR / RECHAZAR PROVEEDOR ---
// ESTATUS: 1 = En Autorización (estado inicial al dar de alta),
// 2 = Autorizado, 3 = Rechazado. Mismo patrón de botones directos en la
// tabla que ya se usa en Facturas CXC.
router.put('/proveedores/:id/estatus', (req, res) => {
  const { id } = req.params;
  const status = parseInt(req.body.status, 10);

  if (![1, 2, 3].includes(status)) {
    return res.status(400).json({ success: false, message: 'Estatus no válido.' });
  }

  db.query('UPDATE proveedores SET ESTATUS = ? WHERE ID_PROVEEDOR = ?', [status, id], (err) => {
    if (err) {
      console.error('Error al cambiar estatus del proveedor:', err);
      return res.status(500).json({ success: false, message: 'Error al actualizar el estatus.' });
    }
    const mensajes = {
      1: 'Proveedor puesto en autorización nuevamente.',
      2: 'Proveedor autorizado correctamente.',
      3: 'Proveedor rechazado correctamente.'
    };
    res.json({ success: true, message: mensajes[status] });
  });
});

// --- CONTACTO DE REFERENCIA (1 por proveedor) ---
router.get('/proveedores/:id/contacto', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await dbPromesa.query(
      'SELECT NOMBRE, TELEFONO, EMAIL FROM proveedores_contacto_referencia WHERE ID_PROVEEDOR = ?',
      [id]
    );
    res.json({ success: true, data: rows[0] || null });
  } catch (error) {
    console.error('Error al consultar contacto de referencia:', error);
    res.status(500).json({ success: false, message: 'Error al consultar el contacto de referencia.' });
  }
});

router.put('/proveedores/:id/contacto', async (req, res) => {
  const { id } = req.params;
  const { nombre, telefono, email } = req.body;

  try {
    await dbPromesa.query(
      `INSERT INTO proveedores_contacto_referencia (ID_PROVEEDOR, NOMBRE, TELEFONO, EMAIL)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE NOMBRE = VALUES(NOMBRE), TELEFONO = VALUES(TELEFONO), EMAIL = VALUES(EMAIL)`,
      [id, nombre || '', telefono || '', email || '']
    );
    res.json({ success: true, message: 'Contacto de referencia guardado correctamente.' });
  } catch (error) {
    console.error('Error al guardar contacto de referencia:', error);
    res.status(500).json({ success: false, message: 'Error al guardar el contacto de referencia.' });
  }
});

// --- DIRECCIÓN (1 por proveedor) ---
router.get('/proveedores/:id/direccion', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await dbPromesa.query(
      'SELECT CALLE, NUM_EXT, NUM_INT, COLONIA, COD_POSTAL FROM proveedores_direccion WHERE ID_PROVEEDOR = ?',
      [id]
    );
    res.json({ success: true, data: rows[0] || null });
  } catch (error) {
    console.error('Error al consultar dirección del proveedor:', error);
    res.status(500).json({ success: false, message: 'Error al consultar la dirección.' });
  }
});

router.put('/proveedores/:id/direccion', async (req, res) => {
  const { id } = req.params;
  const { calle, num_ext, num_int, colonia, cod_postal } = req.body;

  try {
    await dbPromesa.query(
      `INSERT INTO proveedores_direccion (ID_PROVEEDOR, CALLE, NUM_EXT, NUM_INT, COLONIA, COD_POSTAL)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE CALLE = VALUES(CALLE), NUM_EXT = VALUES(NUM_EXT), NUM_INT = VALUES(NUM_INT),
         COLONIA = VALUES(COLONIA), COD_POSTAL = VALUES(COD_POSTAL)`,
      [id, calle || '', num_ext || '', num_int || '', colonia || '', cod_postal || '']
    );
    res.json({ success: true, message: 'Dirección guardada correctamente.' });
  } catch (error) {
    console.error('Error al guardar dirección del proveedor:', error);
    res.status(500).json({ success: false, message: 'Error al guardar la dirección.' });
  }
});

// --- CUENTAS BANCARIAS (PRINCIPAL Y RESPALDO) ---
router.get('/proveedores/:id/cuentas-bancarias', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await dbPromesa.query(
      `SELECT c.TIPO_CUENTA, c.ID_BANCO, b.BANCO_NAME, c.NUMERO_CUENTA, c.CLABE
       FROM proveedores_cuenta c
       LEFT JOIN c_bancos b ON b.ID_BANCO = c.ID_BANCO
       WHERE c.ID_PROVEEDOR = ?`,
      [id]
    );
    const resultado = { principal: null, respaldo: null };
    rows.forEach(fila => {
      if (fila.TIPO_CUENTA === 'PRINCIPAL') resultado.principal = fila;
      if (fila.TIPO_CUENTA === 'RESPALDO') resultado.respaldo = fila;
    });
    res.json({ success: true, data: resultado });
  } catch (error) {
    console.error('Error al consultar cuentas bancarias del proveedor:', error);
    res.status(500).json({ success: false, message: 'Error al consultar cuentas bancarias.' });
  }
});

// Guarda (alta o actualización) las 2 cuentas de un jalón. Body:
// { principal: {id_banco, numero_cuenta, clabe}, respaldo: {...} }
// Cualquiera de las dos puede omitirse si no se quiere tocar esa cuenta.
router.put('/proveedores/:id/cuentas-bancarias', async (req, res) => {
  const { id } = req.params;
  const { principal, respaldo } = req.body;

  const upsert = (tipo, datos) => dbPromesa.query(
    `INSERT INTO proveedores_cuenta (ID_PROVEEDOR, TIPO_CUENTA, ID_BANCO, NUMERO_CUENTA, CLABE)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE ID_BANCO = VALUES(ID_BANCO), NUMERO_CUENTA = VALUES(NUMERO_CUENTA), CLABE = VALUES(CLABE)`,
    [id, tipo, datos.id_banco || null, datos.numero_cuenta || null, datos.clabe || null]
  );

  try {
    if (principal) await upsert('PRINCIPAL', principal);
    if (respaldo) await upsert('RESPALDO', respaldo);
    res.json({ success: true, message: 'Cuentas bancarias guardadas correctamente.' });
  } catch (error) {
    console.error('Error al guardar cuentas bancarias del proveedor:', error);
    res.status(500).json({ success: false, message: 'Error al guardar las cuentas bancarias.' });
  }
});

// --- DOCUMENTOS DEL PROVEEDOR (n documentos, con tipo de catálogo) ---
router.get('/proveedores/:id/documentos', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await dbPromesa.query(
      `SELECT d.ID_DOCUMENTO, d.ID_DOCUMENT_TYPE, t.DOCUMENT_TYPE_NAME, d.FILE_PATH, d.FILE_NAME, d.UPLOAD_DATE
       FROM documentos_proveedores d
       INNER JOIN c_document_types_proveedor t ON t.ID_DOCUMENT_TYPE = d.ID_DOCUMENT_TYPE
       WHERE d.ID_PROVEEDOR = ?
       ORDER BY d.UPLOAD_DATE DESC`,
      [id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error al consultar documentos del proveedor:', error);
    res.status(500).json({ success: false, message: 'Error al consultar documentos.' });
  }
});

router.post('/proveedores/:id/documentos', uploadDocumento.single('documento'), async (req, res) => {
  const { id } = req.params;
  const idTipo = req.body.id_document_type;

  if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió ningún archivo.' });
  if (!idTipo) return res.status(400).json({ success: false, message: 'Selecciona el tipo de documento.' });

  const rutaArchivo = `/uploads/proveedores/documentos/${req.file.filename}`;

  try {
    const [resultado] = await dbPromesa.query(
      'INSERT INTO documentos_proveedores (ID_PROVEEDOR, ID_DOCUMENT_TYPE, FILE_PATH, FILE_NAME) VALUES (?, ?, ?, ?)',
      [id, idTipo, rutaArchivo, req.file.originalname]
    );
    res.json({ success: true, message: 'Documento agregado correctamente.', id_documento: resultado.insertId });
  } catch (error) {
    console.error('Error al guardar documento del proveedor:', error);
    res.status(500).json({ success: false, message: 'Error al guardar el documento.' });
  }
});

router.delete('/proveedores/documentos/:idDocumento', async (req, res) => {
  const { idDocumento } = req.params;
  try {
    const [rows] = await dbPromesa.query('SELECT FILE_PATH FROM documentos_proveedores WHERE ID_DOCUMENTO = ?', [idDocumento]);
    if (rows.length === 0) return res.json({ success: false, message: 'Documento no encontrado.' });

    await dbPromesa.query('DELETE FROM documentos_proveedores WHERE ID_DOCUMENTO = ?', [idDocumento]);

    const rutaCompleta = path.join(UPLOADS_DIR, rows[0].FILE_PATH.replace(/^\/uploads\//, ''));
    fs.unlink(rutaCompleta, () => {});

    res.json({ success: true, message: 'Documento eliminado correctamente.' });
  } catch (error) {
    console.error('Error al eliminar documento del proveedor:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el documento.' });
  }
});

module.exports = router;
