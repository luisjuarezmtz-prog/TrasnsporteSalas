// routes/personalExterno.js — Alta, edición, baja/reactivación y consulta
// de Personal Externo. Mismo patrón que routes/empleados.js, sin las
// secciones de datos laborales ni foto de perfil (no aplican aquí).
'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { db, dbPromesa } = require('../config/db');
const { UPLOADS_DIR } = require('./checks');

// ── Subida de documentos de Personal Externo ───────────────────────────
const DOCS_DIR = path.join(UPLOADS_DIR, 'personal-externo', 'documentos');
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

// --- CATÁLOGOS PARA EL FORMULARIO DE ALTA/EDICIÓN ---
router.get('/personal-externo-catalogos', (req, res) => {
  const queries = {
    generos: 'SELECT ID_GENDER, GENDER_NAME FROM c_genders WHERE STATUS = 1 ORDER BY GENDER_NAME ASC',
    tiposDocumento: 'SELECT ID_DOCUMENT_TYPE, DOCUMENT_TYPE_NAME FROM c_document_types_externo WHERE STATUS = 1 ORDER BY DOCUMENT_TYPE_NAME ASC'
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

// --- CONSULTA COMPLETA DE PERSONAL EXTERNO (filtrable) ---
router.get('/personal-externo-consulta', (req, res) => {
  const { estatus, busqueda } = req.query; // estatus: '1' | '0' | 'todos' (u omitido)

  let query = `
        SELECT
            p.ID_EXTERNO,
            p.FIRST_NAME,
            p.MIDDLE_NAME,
            p.PARENTAL_LAST,
            p.MOTHER_LAST,
            p.STATUS,
            p.RFC,
            p.CURP,
            p.MAIL,
            p.BIRTHPLACE,
            p.BIRTHDAY,
            p.STATE,
            p.STREET,
            p.EXTERIOR_NUMBER,
            p.INTERIOR_NUMBER,
            p.COLONIA,
            p.CITY,
            p.POST_CODE,
            p.CELL_PHONE,
            p.HOME_PHONE,
            p.EMERGENCY_CONTACT,
            p.EMERGENCY_NUMBER,
            p.ID_GENDER,
            g.GENDER_NAME
        FROM personal_externo p
        LEFT JOIN c_genders g ON g.ID_GENDER = p.ID_GENDER
        WHERE 1=1`;

  const params = [];

  if (estatus === '1' || estatus === '0') {
    query += ' AND p.STATUS = ?';
    params.push(estatus);
  }

  if (busqueda) {
    query += ` AND (p.FIRST_NAME LIKE ? OR p.MIDDLE_NAME LIKE ? OR p.PARENTAL_LAST LIKE ? OR p.MOTHER_LAST LIKE ? OR p.RFC LIKE ?)`;
    const like = `%${busqueda}%`;
    params.push(like, like, like, like, like);
  }

  query += ' ORDER BY p.FIRST_NAME ASC';

  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Error al consultar personal externo:', err);
      return res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
    res.json({ success: true, data: results });
  });
});

// --- DETALLE (para precargar el formulario de edición) ---
router.get('/personal-externo/:id/detalle', (req, res) => {
  const { id } = req.params;
  db.query('SELECT * FROM personal_externo WHERE ID_EXTERNO = ?', [id], (err, results) => {
    if (err) {
      console.error('Error al consultar personal externo:', err);
      return res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
    if (results.length === 0) return res.json({ success: false, message: 'Registro no encontrado.' });
    res.json({ success: true, data: results[0] });
  });
});

// --- ALTA ---
router.post('/personal-externo', (req, res) => {
  const d = req.body;

  if (!d.first_name || !d.parental_last) {
    return res.status(400).json({ success: false, message: 'Nombre y apellido paterno son obligatorios.' });
  }

  const query = `
        INSERT INTO personal_externo (
            ID_GENDER, STATUS,
            FIRST_NAME, MIDDLE_NAME, PARENTAL_LAST, MOTHER_LAST, RFC, CURP, MAIL,
            BIRTHPLACE, BIRTHDAY, STATE, STREET, EXTERIOR_NUMBER, INTERIOR_NUMBER, COLONIA, CITY,
            POST_CODE, CELL_PHONE, HOME_PHONE, EMERGENCY_CONTACT, EMERGENCY_NUMBER
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const valores = [
    d.id_gender || null,
    d.first_name || '', d.middle_name || '', d.parental_last || '', d.mother_last || '',
    d.rfc || '', d.curp || '', d.mail || '',
    d.birthplace || '', d.birthday || null, d.state || '', d.street || '',
    d.exterior_number || '', d.interior_number || '', d.colonia || '', d.city || '',
    d.post_code || null, d.cell_phone || '', d.home_phone || '',
    d.emergency_contact || '', d.emergency_number || ''
  ];

  db.query(query, valores, (err, result) => {
    if (err) {
      console.error('Error al dar de alta personal externo:', err);
      return res.status(500).json({ success: false, message: 'Error al registrar el registro.' });
    }
    res.json({ success: true, message: 'Personal externo registrado correctamente.', id_externo: result.insertId });
  });
});

// --- ACTUALIZAR (CAMBIO) ---
router.put('/personal-externo/:id', (req, res) => {
  const { id } = req.params;
  const d = req.body;

  if (!d.first_name || !d.parental_last) {
    return res.status(400).json({ success: false, message: 'Nombre y apellido paterno son obligatorios.' });
  }

  const query = `
        UPDATE personal_externo SET
            ID_GENDER = ?,
            FIRST_NAME = ?, MIDDLE_NAME = ?, PARENTAL_LAST = ?, MOTHER_LAST = ?, RFC = ?, CURP = ?,
            MAIL = ?, BIRTHPLACE = ?, BIRTHDAY = ?, STATE = ?, STREET = ?,
            EXTERIOR_NUMBER = ?, INTERIOR_NUMBER = ?, COLONIA = ?, CITY = ?, POST_CODE = ?,
            CELL_PHONE = ?, HOME_PHONE = ?, EMERGENCY_CONTACT = ?, EMERGENCY_NUMBER = ?
        WHERE ID_EXTERNO = ?`;

  const valores = [
    d.id_gender || null,
    d.first_name || '', d.middle_name || '', d.parental_last || '', d.mother_last || '',
    d.rfc || '', d.curp || '', d.mail || '',
    d.birthplace || '', d.birthday || null, d.state || '', d.street || '',
    d.exterior_number || '', d.interior_number || '', d.colonia || '', d.city || '',
    d.post_code || null, d.cell_phone || '', d.home_phone || '',
    d.emergency_contact || '', d.emergency_number || '',
    id
  ];

  db.query(query, valores, (err) => {
    if (err) {
      console.error('Error al actualizar personal externo:', err);
      return res.status(500).json({ success: false, message: 'Error al actualizar el registro.' });
    }
    res.json({ success: true, message: 'Registro actualizado correctamente.' });
  });
});

// --- BAJA / REACTIVACIÓN (STATUS 1 = activo, 0 = baja) ---
router.put('/personal-externo/:id/estatus', async (req, res) => {
  const { id } = req.params;
  const status = parseInt(req.body.status, 10);

  if (status !== 0 && status !== 1) {
    return res.status(400).json({ success: false, message: 'Estatus no válido.' });
  }

  try {
    // No se permite dar de baja a alguien con un préstamo activo (con o
    // sin saldo pendiente) — primero hay que liquidarlo o cerrarlo.
    if (status === 0) {
      const [prestamosActivos] = await dbPromesa.query(
        'SELECT ID_PRESTAMO FROM reg_prestamos_externos WHERE ID_EXTERNO = ? AND ESTATUS = 1',
        [id]
      );
      if (prestamosActivos.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'No se puede dar de baja: tiene un préstamo activo. Liquídalo antes de continuar.'
        });
      }
    }

    await dbPromesa.query('UPDATE personal_externo SET STATUS = ? WHERE ID_EXTERNO = ?', [status, id]);
    res.json({
      success: true,
      message: status === 1 ? 'Registro reactivado correctamente.' : 'Registro dado de baja correctamente.'
    });
  } catch (err) {
    console.error('Error al cambiar estatus de personal externo:', err);
    res.status(500).json({ success: false, message: 'Error al actualizar el estatus.' });
  }
});

// --- CUENTAS BANCARIAS (PRINCIPAL Y PROVISIONAL) ---
router.get('/personal-externo/:id/cuentas-bancarias', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await dbPromesa.query(
      'SELECT TIPO_CUENTA, ACCOUNT_NUMBER, CARD_NUMBER, CLABE FROM personal_externo_bank_accounts WHERE ID_EXTERNO = ?',
      [id]
    );
    const resultado = { principal: null, provisional: null };
    rows.forEach(fila => {
      if (fila.TIPO_CUENTA === 'PRINCIPAL') resultado.principal = fila;
      if (fila.TIPO_CUENTA === 'PROVISIONAL') resultado.provisional = fila;
    });
    res.json({ success: true, data: resultado });
  } catch (error) {
    console.error('Error al consultar cuentas bancarias:', error);
    res.status(500).json({ success: false, message: 'Error al consultar cuentas bancarias.' });
  }
});

router.put('/personal-externo/:id/cuentas-bancarias', async (req, res) => {
  const { id } = req.params;
  const { principal, provisional } = req.body;

  const upsert = (tipo, datos) => dbPromesa.query(
    `INSERT INTO personal_externo_bank_accounts (ID_EXTERNO, TIPO_CUENTA, ACCOUNT_NUMBER, CARD_NUMBER, CLABE)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE ACCOUNT_NUMBER = VALUES(ACCOUNT_NUMBER), CARD_NUMBER = VALUES(CARD_NUMBER), CLABE = VALUES(CLABE)`,
    [id, tipo, datos.account_number || null, datos.card_number || null, datos.clabe || null]
  );

  try {
    if (principal) await upsert('PRINCIPAL', principal);
    if (provisional) await upsert('PROVISIONAL', provisional);
    res.json({ success: true, message: 'Cuentas bancarias guardadas correctamente.' });
  } catch (error) {
    console.error('Error al guardar cuentas bancarias:', error);
    res.status(500).json({ success: false, message: 'Error al guardar las cuentas bancarias.' });
  }
});

// --- DOCUMENTOS (n documentos, con tipo de catálogo propio) ---
router.get('/personal-externo/:id/documentos', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await dbPromesa.query(
      `SELECT d.ID_DOCUMENT, d.ID_DOCUMENT_TYPE, t.DOCUMENT_TYPE_NAME, d.FILE_PATH, d.FILE_NAME, d.UPLOAD_DATE
       FROM personal_externo_documents d
       INNER JOIN c_document_types_externo t ON t.ID_DOCUMENT_TYPE = d.ID_DOCUMENT_TYPE
       WHERE d.ID_EXTERNO = ?
       ORDER BY d.UPLOAD_DATE DESC`,
      [id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error al consultar documentos:', error);
    res.status(500).json({ success: false, message: 'Error al consultar documentos.' });
  }
});

router.post('/personal-externo/:id/documentos', uploadDocumento.single('documento'), async (req, res) => {
  const { id } = req.params;
  const idTipo = req.body.id_document_type;

  if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió ningún archivo.' });
  if (!idTipo) return res.status(400).json({ success: false, message: 'Selecciona el tipo de documento.' });

  const rutaArchivo = `/uploads/personal-externo/documentos/${req.file.filename}`;

  try {
    const [resultado] = await dbPromesa.query(
      'INSERT INTO personal_externo_documents (ID_EXTERNO, ID_DOCUMENT_TYPE, FILE_PATH, FILE_NAME) VALUES (?, ?, ?, ?)',
      [id, idTipo, rutaArchivo, req.file.originalname]
    );
    res.json({ success: true, message: 'Documento agregado correctamente.', id_document: resultado.insertId });
  } catch (error) {
    console.error('Error al guardar documento:', error);
    res.status(500).json({ success: false, message: 'Error al guardar el documento.' });
  }
});

router.delete('/personal-externo/documentos/:idDocumento', async (req, res) => {
  const { idDocumento } = req.params;
  try {
    const [rows] = await dbPromesa.query('SELECT FILE_PATH FROM personal_externo_documents WHERE ID_DOCUMENT = ?', [idDocumento]);
    if (rows.length === 0) return res.json({ success: false, message: 'Documento no encontrado.' });

    await dbPromesa.query('DELETE FROM personal_externo_documents WHERE ID_DOCUMENT = ?', [idDocumento]);

    const rutaCompleta = path.join(UPLOADS_DIR, rows[0].FILE_PATH.replace(/^\/uploads\//, ''));
    fs.unlink(rutaCompleta, () => {});

    res.json({ success: true, message: 'Documento eliminado correctamente.' });
  } catch (error) {
    console.error('Error al eliminar documento:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el documento.' });
  }
});

module.exports = router;
