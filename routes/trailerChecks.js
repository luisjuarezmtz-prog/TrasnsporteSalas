// routes/trailerChecks.js — Check de Unidad (Tracto Camión), FORM-CTC-01
//
// Mismo espíritu que routes/checks.js (el check de la caja seca), pero
// para el tracto: los puntos a revisar van agrupados por vista y el
// encabezado lleva operador y origen/destino en vez de los datos de
// piso de la caja.
//
// El catálogo de vistas y puntos vive en utils/checkTracto.js y se
// sirve por HTTP para que la pantalla no tenga su propia copia.
'use strict';

const express = require('express');
const router = express.Router();
const { dbPromesa } = require('../config/db');
const {
  VISTAS,
  VISTA_LABEL,
  COMPONENTES_POR_VISTA,
  ESTADOS_VALIDOS,
  TIPOS_DANO_VALIDOS,
  ESTADOS_GENERALES,
  componenteValido,
} = require('../utils/checkTracto');

// --- CATÁLOGO PARA LA PANTALLA ---
router.get('/trailer-checks/catalogo', (_req, res) => {
  res.json({
    success: true,
    vistas: VISTAS,
    vistaLabel: VISTA_LABEL,
    componentesPorVista: COMPONENTES_POR_VISTA,
    estados: ESTADOS_VALIDOS,
    tiposDano: TIPOS_DANO_VALIDOS,
    estadosGenerales: ESTADOS_GENERALES,
  });
});

// Deja solo los renglones que el formato contempla y con estado válido;
// los puntos que el inspector no marcó simplemente no se guardan.
function componentesLimpios(componentes) {
  if (!Array.isArray(componentes)) return [];
  return componentes
    .filter(c => c && VISTAS.includes(c.vista) && componenteValido(c.vista, c.componente))
    .filter(c => ESTADOS_VALIDOS.includes(c.estado))
    .map(c => [c.vista, c.componente, c.estado, (c.observaciones || '').trim() || null]);
}

function marcasLimpias(marcas) {
  if (!Array.isArray(marcas)) return [];
  return marcas
    .filter(m => m && VISTAS.includes(m.vista) && TIPOS_DANO_VALIDOS.includes(m.tipoDano))
    .filter(m => Number.isFinite(Number(m.x)) && Number.isFinite(Number(m.y)))
    .map(m => [m.vista, Number(m.x), Number(m.y), m.tipoDano, (m.descripcion || '').trim() || null]);
}

// Reescribe hijos en bloque: es más simple y seguro que diferenciar
// altas/bajas/cambios renglón por renglón, y el volumen es chico.
async function guardarHijos(conexion, idCheck, body) {
  const componentes = componentesLimpios(body.componentes);
  const marcas = marcasLimpias(body.marcas);

  await conexion.query('DELETE FROM trailer_check_componentes WHERE ID_CHECK = ?', [idCheck]);
  await conexion.query('DELETE FROM trailer_check_marcas_dano WHERE ID_CHECK = ?', [idCheck]);

  if (componentes.length) {
    await conexion.query(
      'INSERT INTO trailer_check_componentes (ID_CHECK, VISTA, COMPONENTE, ESTADO, OBSERVACIONES) VALUES ?',
      [componentes.map(c => [idCheck, ...c])]
    );
  }
  if (marcas.length) {
    await conexion.query(
      'INSERT INTO trailer_check_marcas_dano (ID_CHECK, VISTA, POS_X, POS_Y, TIPO_DANO, DESCRIPCION) VALUES ?',
      [marcas.map(m => [idCheck, ...m])]
    );
  }
}

function validarEncabezado(body) {
  if (!body.fecha) return 'La fecha es obligatoria.';
  if (!String(body.unidadPlacas || '').trim()) return 'La unidad / placas es obligatoria.';
  if (body.estadoGeneral && !ESTADOS_GENERALES.includes(body.estadoGeneral)) {
    return 'El estado general de la unidad no es válido.';
  }
  return null;
}

function valoresEncabezado(body) {
  return [
    body.idTrailer || null,
    body.fecha,
    String(body.unidadPlacas).trim(),
    (body.operador || '').trim() || null,
    (body.origenDestino || '').trim() || null,
    body.estadoGeneral || null,
    (body.observaciones || '').trim() || null,
  ];
}

// --- ALTA ---
router.post('/trailer-checks', async (req, res) => {
  const error = validarEncabezado(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  const conexion = await dbPromesa.getConnection();
  try {
    await conexion.beginTransaction();

    const [resultado] = await conexion.query(
      `INSERT INTO trailer_checks
         (ID_TRAILER, FECHA, UNIDAD_PLACAS, OPERADOR, ORIGEN_DESTINO, ESTADO_GENERAL, OBSERVACIONES, USUARIO)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [...valoresEncabezado(req.body), (req.body.usuario || 'Sistema').slice(0, 30)]
    );

    await guardarHijos(conexion, resultado.insertId, req.body);
    await conexion.commit();

    res.json({ success: true, message: 'Check guardado correctamente.', id_check: resultado.insertId });
  } catch (err) {
    await conexion.rollback();
    console.error('Error al guardar el check de tracto:', err);
    res.status(500).json({ success: false, message: 'Error al guardar el check.' });
  } finally {
    conexion.release();
  }
});

// --- CAMBIO ---
router.put('/trailer-checks/:id', async (req, res) => {
  const error = validarEncabezado(req.body);
  if (error) return res.status(400).json({ success: false, message: error });

  const conexion = await dbPromesa.getConnection();
  try {
    await conexion.beginTransaction();

    const [resultado] = await conexion.query(
      `UPDATE trailer_checks
          SET ID_TRAILER = ?, FECHA = ?, UNIDAD_PLACAS = ?, OPERADOR = ?,
              ORIGEN_DESTINO = ?, ESTADO_GENERAL = ?, OBSERVACIONES = ?
        WHERE ID_CHECK = ?`,
      [...valoresEncabezado(req.body), req.params.id]
    );

    if (resultado.affectedRows === 0) {
      await conexion.rollback();
      return res.status(404).json({ success: false, message: 'Check no encontrado.' });
    }

    await guardarHijos(conexion, req.params.id, req.body);
    await conexion.commit();

    res.json({ success: true, message: 'Check actualizado correctamente.' });
  } catch (err) {
    await conexion.rollback();
    console.error('Error al actualizar el check de tracto:', err);
    res.status(500).json({ success: false, message: 'Error al actualizar el check.' });
  } finally {
    conexion.release();
  }
});

// --- LISTADO (con filtros opcionales de fecha y unidad) ---
router.get('/trailer-checks', async (req, res) => {
  const { fechaInicio, fechaFin, unidad } = req.query;

  const condiciones = [];
  const params = [];
  if (fechaInicio && fechaFin) {
    condiciones.push('c.FECHA BETWEEN ? AND ?');
    params.push(fechaInicio, fechaFin);
  }
  if (unidad) {
    condiciones.push('c.UNIDAD_PLACAS LIKE ?');
    params.push(`%${unidad}%`);
  }
  const whereSql = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  try {
    const [filas] = await dbPromesa.query(
      `SELECT c.ID_CHECK, c.ID_TRAILER, c.FECHA, c.UNIDAD_PLACAS, c.OPERADOR,
              c.ORIGEN_DESTINO, c.ESTADO_GENERAL, c.USUARIO, c.CREATION_DATE,
              t.NO_ECONOMICO,
              (SELECT COUNT(*) FROM trailer_check_marcas_dano m WHERE m.ID_CHECK = c.ID_CHECK) AS TOTAL_DANOS
         FROM trailer_checks c
         LEFT JOIN trailers t ON t.ID_TRAILER = c.ID_TRAILER
         ${whereSql}
        ORDER BY c.FECHA DESC, c.ID_CHECK DESC`,
      params
    );
    res.json({ success: true, data: filas });
  } catch (err) {
    console.error('Error al consultar checks de tracto:', err);
    res.status(500).json({ success: false, message: 'Error al consultar los checks.' });
  }
});

// --- DETALLE ---
router.get('/trailer-checks/:id', async (req, res) => {
  try {
    const [[check]] = await dbPromesa.query('SELECT * FROM trailer_checks WHERE ID_CHECK = ?', [req.params.id]);
    if (!check) return res.status(404).json({ success: false, message: 'Check no encontrado.' });

    const [componentes] = await dbPromesa.query(
      'SELECT VISTA, COMPONENTE, ESTADO, OBSERVACIONES FROM trailer_check_componentes WHERE ID_CHECK = ?',
      [req.params.id]
    );
    const [marcas] = await dbPromesa.query(
      'SELECT VISTA, POS_X, POS_Y, TIPO_DANO, DESCRIPCION FROM trailer_check_marcas_dano WHERE ID_CHECK = ?',
      [req.params.id]
    );

    res.json({ success: true, data: { ...check, componentes, marcas } });
  } catch (err) {
    console.error('Error al consultar el check de tracto:', err);
    res.status(500).json({ success: false, message: 'Error al consultar el check.' });
  }
});

// --- BAJA ---
// Los hijos se van solos por ON DELETE CASCADE.
router.delete('/trailer-checks/:id', async (req, res) => {
  try {
    const [resultado] = await dbPromesa.query('DELETE FROM trailer_checks WHERE ID_CHECK = ?', [req.params.id]);
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Check no encontrado.' });
    }
    res.json({ success: true, message: 'Check eliminado correctamente.' });
  } catch (err) {
    console.error('Error al eliminar el check de tracto:', err);
    res.status(500).json({ success: false, message: 'Error al eliminar el check.' });
  }
});

module.exports = router;
