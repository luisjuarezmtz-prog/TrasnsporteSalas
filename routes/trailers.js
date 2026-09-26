// routes/trailers.js — Registro de Tráileres (tractocamiones) de la flotilla
//
// El tráiler y la caja seca son activos distintos: la caja se maneja en
// el Check de Caja Seca (routes/checks.js), que trae su propia copia de
// la tarjeta de circulación DE LA CAJA. Aquí se registra el tracto, con
// su propia tarjeta de circulación del SICT.
//
// Mismo patrón que routes/proveedores.js: ficha principal + documentos
// con catálogo de tipos, y baja lógica con STATUS en vez de DELETE.
'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { dbPromesa } = require('../config/db');
const { UPLOADS_DIR } = require('./checks');

// ── Subida de documentos del tráiler ───────────────────────────────────
const DOCS_DIR = path.join(UPLOADS_DIR, 'trailers', 'documentos');
if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

const storageDocumento = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DOCS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `trailer-${req.params.id}-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
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

// Campos de la ficha que se aceptan desde el formulario. Se listan
// explícitamente para no depender de lo que mande el cliente y para
// poder armar el INSERT/UPDATE sin repetir la lista en cada consulta.
const CAMPOS = [
  'NO_ECONOMICO', 'PLACAS',
  'RAZON_SOCIAL', 'RFC', 'PROPIETARIO_VEHICULO',
  'DOMICILIO_CALLE', 'DOMICILIO_NUMERO', 'DOMICILIO_COLONIA', 'DOMICILIO_CP', 'DOMICILIO_FISCAL',
  'MODALIDAD', 'MARCA', 'ANIO_MODELO', 'NIV_SERIE', 'MOTOR', 'TIPO_VEHICULO', 'CLASE',
  'COMBUSTIBLE', 'NUM_EJES', 'NUM_LLANTAS',
  'CAPACIDAD_LITROS', 'CAPACIDAD_TONELADAS', 'CAPACIDAD_PERSONAS',
  'ALTO_M', 'ANCHO_M', 'LARGO_M', 'PESO_VEHICULAR',
  'TIPO_SUSPENSION', 'EJE_DIRECCIONAL', 'EJE_MOTRIZ', 'EJE_ARRASTRE',
  'PERMISO_RUTA', 'FOLIO', 'FOLIO_SERIE', 'TRAMITE',
  'LUGAR_EXPEDICION', 'FECHA_EXPEDICION', 'FECHA_LIMITE_SUSTITUCION',
];

// Los numéricos y de fecha llegan como '' desde inputs vacíos; MySQL los
// rechaza o los convierte en 0 / 0000-00-00, así que se normalizan a NULL.
const CAMPOS_NO_TEXTO = new Set([
  'NUM_EJES', 'NUM_LLANTAS', 'CAPACIDAD_LITROS', 'CAPACIDAD_TONELADAS', 'CAPACIDAD_PERSONAS',
  'ALTO_M', 'ANCHO_M', 'LARGO_M', 'PESO_VEHICULAR',
  'FECHA_EXPEDICION', 'FECHA_LIMITE_SUSTITUCION',
]);

function valoresDe(body) {
  return CAMPOS.map(campo => {
    const valor = body[campo];
    if (valor === undefined || valor === null || valor === '') return null;
    if (CAMPOS_NO_TEXTO.has(campo)) return valor;
    return String(valor).trim() || null;
  });
}

// --- CATÁLOGO DE TIPOS DE DOCUMENTO ---
router.get('/trailers-catalogos', async (_req, res) => {
  try {
    const [tiposDocumento] = await dbPromesa.query(
      'SELECT ID_DOCUMENT_TYPE, DOCUMENT_TYPE_NAME FROM c_document_types_trailer WHERE STATUS = 1 ORDER BY DOCUMENT_TYPE_NAME'
    );
    res.json({ success: true, tiposDocumento });
  } catch (error) {
    console.error('Error al consultar catálogos de tráileres:', error);
    res.status(500).json({ success: false, message: 'Error al consultar los catálogos.' });
  }
});

// --- LISTADO (para selects: solo activos, igual que /api/personal-externo) ---
router.get('/trailers', async (_req, res) => {
  try {
    const [rows] = await dbPromesa.query(
      `SELECT ID_TRAILER,
              TRIM(CONCAT(COALESCE(NO_ECONOMICO, ''), ' ', PLACAS)) AS NAME,
              PLACAS, NO_ECONOMICO, MARCA, ANIO_MODELO
         FROM trailers
        WHERE STATUS = 1
        ORDER BY NO_ECONOMICO, PLACAS`
    );
    res.json(rows);
  } catch (error) {
    console.error('Error al listar tráileres:', error);
    res.status(500).json({ success: false, message: 'Error al listar los tráileres.' });
  }
});

// --- CONSULTA COMPLETA (incluye bajas, para la pantalla de administración) ---
router.get('/trailers-consulta', async (_req, res) => {
  try {
    const [rows] = await dbPromesa.query(
      `SELECT t.*,
              (SELECT COUNT(*) FROM trailer_documents d WHERE d.ID_TRAILER = t.ID_TRAILER) AS TOTAL_DOCUMENTOS
         FROM trailers t
        ORDER BY t.STATUS DESC, t.NO_ECONOMICO, t.PLACAS`
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error al consultar tráileres:', error);
    res.status(500).json({ success: false, message: 'Error al consultar los tráileres.' });
  }
});

// --- DETALLE DE UN TRÁILER ---
router.get('/trailers/:id', async (req, res) => {
  try {
    const [[trailer]] = await dbPromesa.query('SELECT * FROM trailers WHERE ID_TRAILER = ?', [req.params.id]);
    if (!trailer) return res.status(404).json({ success: false, message: 'Tráiler no encontrado.' });
    res.json({ success: true, data: trailer });
  } catch (error) {
    console.error('Error al consultar el tráiler:', error);
    res.status(500).json({ success: false, message: 'Error al consultar el tráiler.' });
  }
});

// --- ALTA ---
router.post('/trailers', async (req, res) => {
  const placas = String(req.body.PLACAS || '').trim();
  if (!placas) {
    return res.status(400).json({ success: false, message: 'Las placas son obligatorias.' });
  }

  try {
    const [resultado] = await dbPromesa.query(
      `INSERT INTO trailers (${CAMPOS.join(', ')}) VALUES (${CAMPOS.map(() => '?').join(', ')})`,
      valoresDe(req.body)
    );
    res.json({ success: true, message: 'Tráiler registrado correctamente.', id_trailer: resultado.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: `Ya existe un tráiler con las placas ${placas}.` });
    }
    console.error('Error al registrar el tráiler:', error);
    res.status(500).json({ success: false, message: 'Error al registrar el tráiler.' });
  }
});

// --- CAMBIO ---
router.put('/trailers/:id', async (req, res) => {
  const placas = String(req.body.PLACAS || '').trim();
  if (!placas) {
    return res.status(400).json({ success: false, message: 'Las placas son obligatorias.' });
  }

  try {
    const [resultado] = await dbPromesa.query(
      `UPDATE trailers SET ${CAMPOS.map(c => `${c} = ?`).join(', ')} WHERE ID_TRAILER = ?`,
      [...valoresDe(req.body), req.params.id]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Tráiler no encontrado.' });
    }
    res.json({ success: true, message: 'Tráiler actualizado correctamente.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, message: `Ya existe otro tráiler con las placas ${placas}.` });
    }
    console.error('Error al actualizar el tráiler:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar el tráiler.' });
  }
});

// --- BAJA / REACTIVACIÓN (baja lógica, igual que empleados y proveedores) ---
router.put('/trailers/:id/estatus', async (req, res) => {
  const status = parseInt(req.body.status, 10);
  if (status !== 0 && status !== 1) {
    return res.status(400).json({ success: false, message: 'Estatus no válido.' });
  }

  try {
    const [resultado] = await dbPromesa.query('UPDATE trailers SET STATUS = ? WHERE ID_TRAILER = ?', [status, req.params.id]);
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Tráiler no encontrado.' });
    }
    res.json({
      success: true,
      message: status === 0 ? 'Tráiler dado de baja.' : 'Tráiler reactivado.'
    });
  } catch (error) {
    console.error('Error al cambiar el estatus del tráiler:', error);
    res.status(500).json({ success: false, message: 'Error al cambiar el estatus.' });
  }
});

// --- DOCUMENTOS ---
router.get('/trailers/:id/documentos', async (req, res) => {
  try {
    const [rows] = await dbPromesa.query(
      `SELECT d.ID_DOCUMENT, d.ID_DOCUMENT_TYPE, t.DOCUMENT_TYPE_NAME, d.FILE_PATH, d.FILE_NAME, d.UPLOAD_DATE
         FROM trailer_documents d
         INNER JOIN c_document_types_trailer t ON t.ID_DOCUMENT_TYPE = d.ID_DOCUMENT_TYPE
        WHERE d.ID_TRAILER = ?
        ORDER BY d.UPLOAD_DATE DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error al consultar documentos del tráiler:', error);
    res.status(500).json({ success: false, message: 'Error al consultar documentos.' });
  }
});

router.post('/trailers/:id/documentos', uploadDocumento.single('documento'), async (req, res) => {
  const idTipo = req.body.id_document_type;

  if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió ningún archivo.' });
  if (!idTipo) return res.status(400).json({ success: false, message: 'Selecciona el tipo de documento.' });

  const rutaArchivo = `/uploads/trailers/documentos/${req.file.filename}`;

  try {
    const [resultado] = await dbPromesa.query(
      'INSERT INTO trailer_documents (ID_TRAILER, ID_DOCUMENT_TYPE, FILE_PATH, FILE_NAME) VALUES (?, ?, ?, ?)',
      [req.params.id, idTipo, rutaArchivo, req.file.originalname]
    );
    res.json({ success: true, message: 'Documento agregado correctamente.', id_documento: resultado.insertId });
  } catch (error) {
    console.error('Error al guardar documento del tráiler:', error);
    res.status(500).json({ success: false, message: 'Error al guardar el documento.' });
  }
});

router.delete('/trailers/documentos/:idDocumento', async (req, res) => {
  const { idDocumento } = req.params;
  try {
    const [rows] = await dbPromesa.query('SELECT FILE_PATH FROM trailer_documents WHERE ID_DOCUMENT = ?', [idDocumento]);
    if (rows.length === 0) return res.json({ success: false, message: 'Documento no encontrado.' });

    await dbPromesa.query('DELETE FROM trailer_documents WHERE ID_DOCUMENT = ?', [idDocumento]);

    const rutaCompleta = path.join(UPLOADS_DIR, rows[0].FILE_PATH.replace(/^\/uploads\//, ''));
    fs.unlink(rutaCompleta, () => {});

    res.json({ success: true, message: 'Documento eliminado correctamente.' });
  } catch (error) {
    console.error('Error al eliminar documento del tráiler:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el documento.' });
  }
});

// --- VERIFICACIONES FÍSICO-MECÁNICAS (NOM-068-SCT-2-2014) ---
// El dictamen es periódico y el propio documento registra la fecha de
// la verificación anterior, así que se conserva el histórico completo:
// el panel de vencimientos solo mira la más reciente de cada unidad.
router.get('/trailers/:id/verificaciones', async (req, res) => {
  try {
    const [rows] = await dbPromesa.query(
      `SELECT ID_VERIFICACION, FOLIO_DICTAMEN, NO_APROBACION, NO_ACREDITACION, RESULTADO,
              TIPO_SERVICIO, FECHA_VERIFICACION, FECHA_VERIFICACION_ANTERIOR, FECHA_VIGENCIA,
              ODOMETRO, SE_PRESENTO, TECNICO_NOMBRE, OBSERVACIONES
         FROM trailer_verificaciones
        WHERE ID_TRAILER = ?
        ORDER BY FECHA_VERIFICACION DESC, ID_VERIFICACION DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error al consultar verificaciones:', error);
    res.status(500).json({ success: false, message: 'Error al consultar las verificaciones.' });
  }
});

router.post('/trailers/:id/verificaciones', async (req, res) => {
  const b = req.body;
  if (!b.fechaVerificacion) {
    return res.status(400).json({ success: false, message: 'La fecha de verificación es obligatoria.' });
  }

  try {
    const [resultado] = await dbPromesa.query(
      `INSERT INTO trailer_verificaciones
         (ID_TRAILER, FOLIO_DICTAMEN, NO_APROBACION, NO_ACREDITACION, RESULTADO, TIPO_SERVICIO,
          FECHA_VERIFICACION, HORA_INICIO, HORA_FINAL, FECHA_VERIFICACION_ANTERIOR, FECHA_VIGENCIA,
          ODOMETRO, SE_PRESENTO, TECNICO_NOMBRE, OBSERVACIONES)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        (b.folioDictamen || '').trim() || null,
        (b.noAprobacion || '').trim() || null,
        (b.noAcreditacion || '').trim() || null,
        (b.resultado || '').trim() || null,
        (b.tipoServicio || '').trim() || null,
        b.fechaVerificacion,
        b.horaInicio || null,
        b.horaFinal || null,
        b.fechaVerificacionAnterior || null,
        b.fechaVigencia || null,
        b.odometro || null,
        (b.sePresento || '').trim() || null,
        (b.tecnicoNombre || '').trim() || null,
        (b.observaciones || '').trim() || null,
      ]
    );
    res.json({ success: true, message: 'Verificación registrada.', id_verificacion: resultado.insertId });
  } catch (error) {
    console.error('Error al registrar la verificación:', error);
    res.status(500).json({ success: false, message: 'Error al registrar la verificación.' });
  }
});

router.delete('/trailers/verificaciones/:idVerificacion', async (req, res) => {
  try {
    const [resultado] = await dbPromesa.query(
      'DELETE FROM trailer_verificaciones WHERE ID_VERIFICACION = ?',
      [req.params.idVerificacion]
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Verificación no encontrada.' });
    }
    res.json({ success: true, message: 'Verificación eliminada.' });
  } catch (error) {
    console.error('Error al eliminar la verificación:', error);
    res.status(500).json({ success: false, message: 'Error al eliminar la verificación.' });
  }
});

module.exports = router;
