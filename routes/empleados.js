// routes/empleados.js — Alta, edición, baja/reactivación y consulta de empleados
//
// NOTA: routes/catalogos.js ya expone GET /api/empleados (lista simple y
// activa, usada como <select> en muchas otras pantallas). No se toca ese
// endpoint para no romper nada; este módulo agrega rutas nuevas con nombres
// distintos para el CRUD completo de la ficha del empleado.
'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { db, dbPromesa } = require('../config/db');
const { UPLOADS_DIR } = require('./checks');

// ── Subida de archivos del empleado (foto de perfil y documentos) ──────────
const FOTOS_DIR = path.join(UPLOADS_DIR, 'empleados', 'fotos');
const DOCS_DIR = path.join(UPLOADS_DIR, 'empleados', 'documentos');
if (!fs.existsSync(FOTOS_DIR)) fs.mkdirSync(FOTOS_DIR, { recursive: true });
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

const storageFoto = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FOTOS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `foto-${req.params.id}-${Date.now()}${ext}`);
  }
});
const uploadFoto = multer({
  storage: storageFoto,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    ['image/jpeg', 'image/jpg', 'image/png'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('La foto debe ser JPG o PNG'))
});

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

// --- CATÁLOGOS PARA EL FORMULARIO DE ALTA/EDICIÓN DE EMPLEADOS ---
router.get('/empleados-catalogos', (req, res) => {
  const queries = {
    tiposEmpleado: 'SELECT ID_EMPLOYEE_TYPE, EMPLOYEE_TYPE_NAME FROM c_employee_types WHERE STATUS = 1 ORDER BY EMPLOYEE_TYPE_NAME ASC',
    tiposContrato: 'SELECT ID_CONTRACT_TYPE, CONTRACT_TYPE_NAME FROM c_contract_types WHERE STATUS = 1 ORDER BY CONTRACT_TYPE_NAME ASC',
    educaciones: 'SELECT ID_EDUCATION, EDUCATION_NAME FROM c_educations WHERE STATUS = 1 ORDER BY EDUCATION_NAME ASC',
    generos: 'SELECT ID_GENDER, GENDER_NAME FROM c_genders WHERE STATUS = 1 ORDER BY GENDER_NAME ASC',
    tiposDocumento: 'SELECT ID_DOCUMENT_TYPE, DOCUMENT_TYPE_NAME FROM c_document_types WHERE STATUS = 1 ORDER BY DOCUMENT_TYPE_NAME ASC'
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

// --- CONSULTA COMPLETA DE EMPLEADOS (con nombres de catálogos, filtrable) ---
router.get('/empleados-consulta', (req, res) => {
  const { estatus, busqueda } = req.query; // estatus: '1' | '0' | 'todos' (u omitido)

  let query = `
        SELECT
            e.ID_EMPLOYEE,
            e.FIRST_NAME,
            e.MIDDLE_NAME,
            e.PARENTAL_LAST,
            e.MOTHER_LAST,
            e.STATUS,
            e.OPERADOR,
            e.PHOTO_PATH,
            e.RFC,
            e.CURP,
            e.MAIL,
            e.IMSS,
            e.SALARY,
            e.BIRTHPLACE,
            e.BIRTHDAY,
            e.STATE,
            e.STREET,
            e.EXTERIOR_NUMBER,
            e.INTERIOR_NUMBER,
            e.COLONIA,
            e.CITY,
            e.POST_CODE,
            e.CELL_PHONE,
            e.HOME_PHONE,
            e.EMERGENCY_CONTACT,
            e.EMERGENCY_NUMBER,
            e.ID_EMPLOYEE_TYPE,
            e.ID_CONTRACT_TYPE,
            e.ID_EDUCATION,
            e.ID_GENDER,
            t.EMPLOYEE_TYPE_NAME,
            c.CONTRACT_TYPE_NAME,
            ed.EDUCATION_NAME,
            g.GENDER_NAME
        FROM employees e
        LEFT JOIN c_employee_types t ON t.ID_EMPLOYEE_TYPE = e.ID_EMPLOYEE_TYPE
        LEFT JOIN c_contract_types c ON c.ID_CONTRACT_TYPE = e.ID_CONTRACT_TYPE
        LEFT JOIN c_educations ed ON ed.ID_EDUCATION = e.ID_EDUCATION
        LEFT JOIN c_genders g ON g.ID_GENDER = e.ID_GENDER
        WHERE 1=1`;

  const params = [];

  if (estatus === '1' || estatus === '0') {
    query += ' AND e.STATUS = ?';
    params.push(estatus);
  }

  if (busqueda) {
    query += ` AND (e.FIRST_NAME LIKE ? OR e.MIDDLE_NAME LIKE ? OR e.PARENTAL_LAST LIKE ? OR e.MOTHER_LAST LIKE ? OR e.RFC LIKE ?)`;
    const like = `%${busqueda}%`;
    params.push(like, like, like, like, like);
  }

  query += ' ORDER BY e.FIRST_NAME ASC';

  db.query(query, params, (err, results) => {
    if (err) {
      console.error('Error al consultar empleados:', err);
      return res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
    res.json({ success: true, data: results });
  });
});

// --- DETALLE DE UN EMPLEADO (para precargar el formulario de edición) ---
router.get('/empleados/:id/detalle', (req, res) => {
  const { id } = req.params;
  db.query('SELECT * FROM employees WHERE ID_EMPLOYEE = ?', [id], (err, results) => {
    if (err) {
      console.error('Error al consultar empleado:', err);
      return res.status(500).json({ success: false, message: 'Error en el servidor' });
    }
    if (results.length === 0) return res.json({ success: false, message: 'Empleado no encontrado.' });
    res.json({ success: true, data: results[0] });
  });
});

// --- ALTA DE EMPLEADO ---
router.post('/empleados', (req, res) => {
  const d = req.body;

  if (!d.first_name || !d.parental_last) {
    return res.status(400).json({ success: false, message: 'Nombre y apellido paterno son obligatorios.' });
  }

  const query = `
        INSERT INTO employees (
            ID_EMPLOYEE_TYPE, ID_CONTRACT_TYPE, ID_EDUCATION, ID_GENDER, STATUS, OPERADOR,
            FIRST_NAME, MIDDLE_NAME, PARENTAL_LAST, MOTHER_LAST, RFC, CURP, MAIL, IMSS, SALARY,
            BIRTHPLACE, BIRTHDAY, STATE, STREET, EXTERIOR_NUMBER, INTERIOR_NUMBER, COLONIA, CITY,
            POST_CODE, CELL_PHONE, HOME_PHONE, EMERGENCY_CONTACT, EMERGENCY_NUMBER
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const valores = [
    d.id_employee_type || null, d.id_contract_type || null, d.id_education || null, d.id_gender || null,
    d.operador ? 1 : 0,
    d.first_name || '', d.middle_name || '', d.parental_last || '', d.mother_last || '',
    d.rfc || '', d.curp || '', d.mail || '', d.imss || '', d.salary || null,
    d.birthplace || '', d.birthday || null, d.state || '', d.street || '',
    d.exterior_number || '', d.interior_number || '', d.colonia || '', d.city || '',
    d.post_code || null, d.cell_phone || '', d.home_phone || '',
    d.emergency_contact || '', d.emergency_number || ''
  ];

  db.query(query, valores, (err, result) => {
    if (err) {
      console.error('Error al dar de alta empleado:', err);
      return res.status(500).json({ success: false, message: 'Error al registrar el empleado.' });
    }
    res.json({ success: true, message: 'Empleado registrado correctamente.', id_employee: result.insertId });
  });
});

// --- ACTUALIZAR (CAMBIO) DE EMPLEADO ---
router.put('/empleados/:id', (req, res) => {
  const { id } = req.params;
  const d = req.body;

  if (!d.first_name || !d.parental_last) {
    return res.status(400).json({ success: false, message: 'Nombre y apellido paterno son obligatorios.' });
  }

  const query = `
        UPDATE employees SET
            ID_EMPLOYEE_TYPE = ?, ID_CONTRACT_TYPE = ?, ID_EDUCATION = ?, ID_GENDER = ?, OPERADOR = ?,
            FIRST_NAME = ?, MIDDLE_NAME = ?, PARENTAL_LAST = ?, MOTHER_LAST = ?, RFC = ?, CURP = ?,
            MAIL = ?, IMSS = ?, SALARY = ?, BIRTHPLACE = ?, BIRTHDAY = ?, STATE = ?, STREET = ?,
            EXTERIOR_NUMBER = ?, INTERIOR_NUMBER = ?, COLONIA = ?, CITY = ?, POST_CODE = ?,
            CELL_PHONE = ?, HOME_PHONE = ?, EMERGENCY_CONTACT = ?, EMERGENCY_NUMBER = ?
        WHERE ID_EMPLOYEE = ?`;

  const valores = [
    d.id_employee_type || null, d.id_contract_type || null, d.id_education || null, d.id_gender || null,
    d.operador ? 1 : 0,
    d.first_name || '', d.middle_name || '', d.parental_last || '', d.mother_last || '',
    d.rfc || '', d.curp || '', d.mail || '', d.imss || '', d.salary || null,
    d.birthplace || '', d.birthday || null, d.state || '', d.street || '',
    d.exterior_number || '', d.interior_number || '', d.colonia || '', d.city || '',
    d.post_code || null, d.cell_phone || '', d.home_phone || '',
    d.emergency_contact || '', d.emergency_number || '',
    id
  ];

  db.query(query, valores, (err) => {
    if (err) {
      console.error('Error al actualizar empleado:', err);
      return res.status(500).json({ success: false, message: 'Error al actualizar el empleado.' });
    }
    res.json({ success: true, message: 'Empleado actualizado correctamente.' });
  });
});

// --- BAJA / REACTIVACIÓN DE EMPLEADO (STATUS 1 = activo, 0 = baja) ---
router.put('/empleados/:id/estatus', (req, res) => {
  const { id } = req.params;
  const status = parseInt(req.body.status, 10);

  if (status !== 0 && status !== 1) {
    return res.status(400).json({ success: false, message: 'Estatus no válido.' });
  }

  db.query('UPDATE employees SET STATUS = ? WHERE ID_EMPLOYEE = ?', [status, id], (err) => {
    if (err) {
      console.error('Error al cambiar estatus del empleado:', err);
      return res.status(500).json({ success: false, message: 'Error al actualizar el estatus.' });
    }
    res.json({
      success: true,
      message: status === 1 ? 'Empleado reactivado correctamente.' : 'Empleado dado de baja correctamente.'
    });
  });
});

// --- CUENTAS BANCARIAS (PRINCIPAL Y PROVISIONAL) ---
router.get('/empleados/:id/cuentas-bancarias', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await dbPromesa.query(
      'SELECT TIPO_CUENTA, ACCOUNT_NUMBER, CARD_NUMBER, CLABE FROM employee_bank_accounts WHERE ID_EMPLOYEE = ?',
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

// Guarda (alta o actualización) las 2 cuentas de un jalón. Body:
// { principal: {account_number, card_number, clabe}, provisional: {...} }
// Cualquiera de las dos puede omitirse si no se quiere tocar esa cuenta.
router.put('/empleados/:id/cuentas-bancarias', async (req, res) => {
  const { id } = req.params;
  const { principal, provisional } = req.body;

  const upsert = (tipo, datos) => dbPromesa.query(
    `INSERT INTO employee_bank_accounts (ID_EMPLOYEE, TIPO_CUENTA, ACCOUNT_NUMBER, CARD_NUMBER, CLABE)
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

// --- FOTO DE PERFIL DEL EMPLEADO ---
router.post('/empleados/:id/foto', uploadFoto.single('foto'), async (req, res) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió ninguna foto.' });

  const rutaFoto = `/uploads/empleados/fotos/${req.file.filename}`;

  try {
    const [previo] = await dbPromesa.query('SELECT PHOTO_PATH FROM employees WHERE ID_EMPLOYEE = ?', [id]);
    await dbPromesa.query('UPDATE employees SET PHOTO_PATH = ? WHERE ID_EMPLOYEE = ?', [rutaFoto, id]);

    // Borra la foto anterior del disco (si existía) para no acumular basura.
    if (previo.length && previo[0].PHOTO_PATH) {
      const rutaAnterior = path.join(UPLOADS_DIR, previo[0].PHOTO_PATH.replace(/^\/uploads\//, ''));
      fs.unlink(rutaAnterior, () => {}); // si falla (no existe, etc.) no es crítico
    }

    res.json({ success: true, message: 'Foto actualizada correctamente.', photo_path: rutaFoto });
  } catch (error) {
    console.error('Error al guardar foto de empleado:', error);
    res.status(500).json({ success: false, message: 'Error al guardar la foto.' });
  }
});

// --- DOCUMENTOS DEL EMPLEADO (n documentos, con tipo de catálogo) ---
router.get('/empleados/:id/documentos', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await dbPromesa.query(
      `SELECT d.ID_DOCUMENT, d.ID_DOCUMENT_TYPE, t.DOCUMENT_TYPE_NAME, d.FILE_PATH, d.FILE_NAME, d.UPLOAD_DATE
       FROM employee_documents d
       INNER JOIN c_document_types t ON t.ID_DOCUMENT_TYPE = d.ID_DOCUMENT_TYPE
       WHERE d.ID_EMPLOYEE = ?
       ORDER BY d.UPLOAD_DATE DESC`,
      [id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error al consultar documentos del empleado:', error);
    res.status(500).json({ success: false, message: 'Error al consultar documentos.' });
  }
});

router.post('/empleados/:id/documentos', uploadDocumento.single('documento'), async (req, res) => {
  const { id } = req.params;
  const idTipo = req.body.id_document_type;

  if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió ningún archivo.' });
  if (!idTipo) return res.status(400).json({ success: false, message: 'Selecciona el tipo de documento.' });

  const rutaArchivo = `/uploads/empleados/documentos/${req.file.filename}`;

  try {
    const [resultado] = await dbPromesa.query(
      'INSERT INTO employee_documents (ID_EMPLOYEE, ID_DOCUMENT_TYPE, FILE_PATH, FILE_NAME) VALUES (?, ?, ?, ?)',
      [id, idTipo, rutaArchivo, req.file.originalname]
    );
    res.json({ success: true, message: 'Documento agregado correctamente.', id_document: resultado.insertId });
  } catch (error) {
    console.error('Error al guardar documento del empleado:', error);
    res.status(500).json({ success: false, message: 'Error al guardar el documento.' });
  }
});

router.delete('/empleados/documentos/:idDocumento', async (req, res) => {
  const { idDocumento } = req.params;
  try {
    const [rows] = await dbPromesa.query('SELECT FILE_PATH FROM employee_documents WHERE ID_DOCUMENT = ?', [idDocumento]);
    if (rows.length === 0) return res.json({ success: false, message: 'Documento no encontrado.' });

    await dbPromesa.query('DELETE FROM employee_documents WHERE ID_DOCUMENT = ?', [idDocumento]);

    const rutaCompleta = path.join(UPLOADS_DIR, rows[0].FILE_PATH.replace(/^\/uploads\//, ''));
    fs.unlink(rutaCompleta, () => {});

    res.json({ success: true, message: 'Documento eliminado correctamente.' });
  } catch (error) {
    console.error('Error al eliminar documento del empleado:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el documento.' });
  }
});

module.exports = router;
