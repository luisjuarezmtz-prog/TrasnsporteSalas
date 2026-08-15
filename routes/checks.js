// routes/checks.js — Check de Caja Seca para Tráiler (encabezado, llantas, componentes, marcas de daño)
'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { db, dbPromesa } = require('../config/db');

// ── Subida de archivos (Tarjeta de Circulación) ──────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `tarjeta-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, name);
  }
});
const TIPOS_ARCHIVO = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    TIPOS_ARCHIVO.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Solo se acepta PDF, JPG o PNG'))
});

// ── Constantes de validación ──────────────────────────────────────────────────
const VISTAS_VALIDAS = ['LATERAL_IZQUIERDA', 'LATERAL_DERECHA', 'TRASERA', 'FRONTAL', 'TECHO'];
const TIPOS_DANO_VALIDOS = ['RASPONES', 'GOLPES', 'ABOLLADURAS', 'PERFORACIONES', 'OTROS'];
const ESTADOS_VALIDOS = ['BUENO', 'REGULAR', 'MALO'];

// ── Helper: construye array de valores a partir del cuerpo parseado ───────────
function buildValues(e, f, piso, body, archivo, archivoNombre) {
  return [
    e.fecha, e.hora,
    e.noEconomico || null, e.placa || null,
    e.marca || null, e.modelo || null,
    e.tipoCaja || null, e.numeroSerieVin || null,
    e.clienteEmpresa || null, e.inspector || null,
    piso.tipoMaterial || null, piso.tipoMaterialOtro || null,
    piso.condicion || null, piso.observaciones || null,
    body.observacionesGenerales || null,
    body.notasAdicionales || null,
    body.dictamenGeneral || null,
    body.firmaInspector || null,
    f.razonSocial || null, f.rfc || null,
    f.propietarioVehiculo || null,
    f.calle || null, f.numero || null,
    f.colonia || null, f.cp || null,
    f.domicilioFiscal || null,
    f.nivSerie || null, f.modalidad || null,
    f.motor || null, f.marcaCaja || null,
    f.clase || null, f.combustible || null,
    f.tipoCajaTransmision || null,
    f.pesoVehicular || null, f.numEjes || null,
    f.numLlantas || null, f.litros || null,
    f.toneladas || null, f.personas || null,
    f.altoM || null, f.anchoM || null,
    f.largoM || null, f.tipoSuspension || null,
    f.ejeDireccional || null, f.ejeMotriz || null,
    f.ejeArrastre || null, f.permisoRuta || null,
    f.folio || null, f.folioSerie || null,
    f.fechaLimiteSuspension || null,
    f.tramite || null, f.lugarExpedicion || null,
    f.fechaExpedicion || null,
    archivo, archivoNombre
  ];
}

const SQL_COLUMNS = `
  fecha, hora,
  no_economico, placa, marca, modelo, tipo_caja, numero_serie_vin,
  cliente_empresa, inspector,
  tipo_material_piso, tipo_material_piso_otro,
  condicion_piso, condicion_piso_observaciones,
  observaciones_generales, notas_adicionales, dictamen_general, firma_inspector_nombre,
  razon_social, rfc, propietario_vehiculo,
  domicilio_calle, domicilio_numero, domicilio_colonia, domicilio_cp, domicilio_fiscal,
  niv_serie, modalidad, motor, marca_caja, clase, combustible, tipo_caja_transmision,
  peso_vehicular, num_ejes, num_llantas, litros, toneladas, personas,
  alto_m, ancho_m, largo_m, tipo_suspension,
  eje_direccional, eje_motriz, eje_arrastre, permiso_ruta, folio, folio_serie,
  fecha_limite_suspension, tramite, lugar_expedicion, fecha_expedicion,
  tarjeta_circulacion_archivo, tarjeta_circulacion_nombre_original`;

// Genera la cadena de ? del tamaño correcto automáticamente
const PLACEHOLDERS = SQL_COLUMNS.split(',').map(() => '?').join(',');

// ── POST /api/checks ──────────────────────────────────────────────────────────
router.post('/checks', upload.single('tarjetaCirculacion'), async (req, res) => {
  let body;
  try { body = JSON.parse(req.body.payload || '{}'); }
  catch { return res.status(400).json({ error: 'payload no es JSON válido' }); }

  const e = body.encabezado || {};
  const f = body.fiscal || {};
  const piso = body.piso || {};
  if (!e.fecha || !e.hora) {
    return res.status(400).json({ error: 'fecha y hora son obligatorias' });
  }

  const archivo = req.file ? `/uploads/${req.file.filename}` : null;
  const archivoNombre = req.file ? req.file.originalname : null;
  const llantas = Array.isArray(body.llantas) ? body.llantas : [];
  const componentes = Array.isArray(body.componentes) ? body.componentes : [];
  const marcas = Array.isArray(body.marcas) ? body.marcas : [];

  const conn = dbPromesa;
  try {
    const [result] = await conn.execute(
      `INSERT INTO checks (${SQL_COLUMNS}) VALUES (${PLACEHOLDERS})`,
      buildValues(e, f, piso, body, archivo, archivoNombre)
    );
    const checkId = result.insertId;

    for (const l of llantas) {
      if (!l.posicion || !ESTADOS_VALIDOS.includes(l.estado)) continue;
      await conn.execute(
        `INSERT INTO llantas (check_id,posicion,cantidad,estado,observaciones) VALUES (?,?,?,?,?)`,
        [checkId, l.posicion, l.cantidad || 1, l.estado, l.observaciones || null]
      );
    }
    for (const c of componentes) {
      if (!c.componente || !ESTADOS_VALIDOS.includes(c.estado)) continue;
      await conn.execute(
        `INSERT INTO componentes (check_id,componente,estado,observaciones) VALUES (?,?,?,?)`,
        [checkId, c.componente, c.estado, c.observaciones || null]
      );
    }
    for (const m of marcas) {
      if (!VISTAS_VALIDAS.includes(m.vista) || !TIPOS_DANO_VALIDOS.includes(m.tipoDano)) continue;
      await conn.execute(
        `INSERT INTO marcas_dano (check_id,vista,pos_x,pos_y,tipo_dano,descripcion) VALUES (?,?,?,?,?,?)`,
        [checkId, m.vista, m.x, m.y, m.tipoDano, m.descripcion || null]
      );
    }

    res.status(201).json({ id: checkId, mensaje: 'Check guardado correctamente' });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error(err);
    res.status(500).json({ error: 'Error al guardar', detalle: err.message });
  }
});

// ── PUT /api/checks/:id ───────────────────────────────────────────────────────
router.put('/checks/:id', upload.single('tarjetaCirculacion'), async (req, res) => {
  const id = req.params.id;
  let body;
  try { body = JSON.parse(req.body.payload || '{}'); }
  catch { return res.status(400).json({ error: 'payload no es JSON válido' }); }

  const e = body.encabezado || {};
  const f = body.fiscal || {};
  const piso = body.piso || {};
  if (!e.fecha || !e.hora) {
    return res.status(400).json({ error: 'fecha y hora son obligatorias' });
  }

  const llantas = Array.isArray(body.llantas) ? body.llantas : [];
  const componentes = Array.isArray(body.componentes) ? body.componentes : [];
  const marcas = Array.isArray(body.marcas) ? body.marcas : [];

  const conn = dbPromesa;
  try {
    const [[existe]] = await conn.query(
      `SELECT id, tarjeta_circulacion_archivo FROM checks WHERE id=?`, [id]
    );
    if (!existe) return res.status(404).json({ error: 'Check no encontrado' });

    // Conservar archivo previo si no se sube uno nuevo
    const archivo = req.file ? `/uploads/${req.file.filename}` : existe.tarjeta_circulacion_archivo;
    const archivoNombre = req.file ? req.file.originalname : null;

    // Construir SET dinámico (solo actualizamos nombre si hay archivo nuevo)
    const setClause = SQL_COLUMNS
      .split(',')
      .map(c => `${c.trim()}=?`)
      .join(', ')
      .replace(
        'tarjeta_circulacion_nombre_original=?',
        req.file ? 'tarjeta_circulacion_nombre_original=?' : 'tarjeta_circulacion_nombre_original=tarjeta_circulacion_nombre_original'
      );

    const valoresCompletos = buildValues(e, f, piso, body, archivo, archivoNombre);
    const vals = valoresCompletos.filter((_, i) => {
      // último índice = tarjeta_circulacion_nombre_original
      if (i === valoresCompletos.length - 1 && !req.file) return false;
      return true;
    });

    await conn.execute(`UPDATE checks SET ${setClause} WHERE id=?`, [...vals, id]);

    // Reemplazar tablas hijas
    await conn.execute(`DELETE FROM llantas     WHERE check_id=?`, [id]);
    await conn.execute(`DELETE FROM componentes  WHERE check_id=?`, [id]);
    await conn.execute(`DELETE FROM marcas_dano  WHERE check_id=?`, [id]);

    for (const l of llantas) {
      if (!l.posicion || !ESTADOS_VALIDOS.includes(l.estado)) continue;
      await conn.execute(
        `INSERT INTO llantas (check_id,posicion,cantidad,estado,observaciones) VALUES (?,?,?,?,?)`,
        [id, l.posicion, l.cantidad || 1, l.estado, l.observaciones || null]
      );
    }
    for (const c of componentes) {
      if (!c.componente || !ESTADOS_VALIDOS.includes(c.estado)) continue;
      await conn.execute(
        `INSERT INTO componentes (check_id,componente,estado,observaciones) VALUES (?,?,?,?)`,
        [id, c.componente, c.estado, c.observaciones || null]
      );
    }
    for (const m of marcas) {
      if (!VISTAS_VALIDAS.includes(m.vista) || !TIPOS_DANO_VALIDOS.includes(m.tipoDano)) continue;
      await conn.execute(
        `INSERT INTO marcas_dano (check_id,vista,pos_x,pos_y,tipo_dano,descripcion) VALUES (?,?,?,?,?,?)`,
        [id, m.vista, m.x, m.y, m.tipoDano, m.descripcion || null]
      );
    }

    res.json({ id: Number(id), mensaje: 'Check actualizado correctamente' });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar', detalle: err.message });
  }
});

// ── GET /api/checks  — lista con búsqueda por placa, NIV/serie, folio tarjeta ─
router.get('/checks', async (req, res) => {
  const { q } = req.query;
  let sql = `
    SELECT id, fecha, hora, no_economico, placa, niv_serie,
           folio_serie AS num_tarjeta_circulacion,
           inspector, dictamen_general,
           tarjeta_circulacion_archivo, tarjeta_circulacion_nombre_original,
           creado_en
    FROM checks
    WHERE 1=1`;
  const params = [];

  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    sql += ` AND (placa LIKE ? OR niv_serie LIKE ? OR folio_serie LIKE ?)`;
    params.push(like, like, like);
  }

  sql += ` ORDER BY id DESC LIMIT 200`;
  try {
    const [rows] = await dbPromesa.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/checks/:id  — detalle completo ───────────────────────────────────
router.get('/checks/:id', async (req, res) => {
  try {
    const [[check]] = await dbPromesa.query(`SELECT * FROM checks WHERE id=?`, [req.params.id]);
    if (!check) return res.status(404).json({ error: 'No encontrado' });
    const [llantas] = await dbPromesa.query(`SELECT * FROM llantas     WHERE check_id=?`, [req.params.id]);
    const [componentes] = await dbPromesa.query(`SELECT * FROM componentes  WHERE check_id=?`, [req.params.id]);
    const [marcas] = await dbPromesa.query(`SELECT * FROM marcas_dano  WHERE check_id=?`, [req.params.id]);
    res.json({ check, llantas, componentes, marcas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/checks/:id ────────────────────────────────────────────────────
router.delete('/checks/:id', async (req, res) => {
  try {
    const [[row]] = await dbPromesa.query(
      `SELECT tarjeta_circulacion_archivo FROM checks WHERE id=?`, [req.params.id]
    );
    if (row?.tarjeta_circulacion_archivo) {
      const filePath = path.join(__dirname, '..', row.tarjeta_circulacion_archivo);
      if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});
    }
    await dbPromesa.execute(`DELETE FROM checks WHERE id=?`, [req.params.id]);
    res.json({ mensaje: 'Eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, UPLOADS_DIR };
