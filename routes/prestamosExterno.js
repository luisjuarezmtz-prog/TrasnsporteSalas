// routes/prestamosExterno.js -- Prestamos a Personal Externo
//
// Mismo patrón que routes/prestamos.js (empleados), con una diferencia:
// los préstamos de empleados se abonan automáticamente al procesar
// nómina (routes/nomina.js), pero Personal Externo no tiene nómina, así
// que aquí se agrega POST /prestamos-externos/:id/abono para registrar
// pagos manualmente.
'use strict';

const express = require('express');
const router = express.Router();
const { db, dbPromesa } = require('../config/db');

// --- GENERAR FOLIO AUTOMATICO PARA PRESTAMOS ---
router.get('/prestamos-externos/nuevo-folio', (req, res) => {
  db.query('SELECT MAX(ID_PRESTAMO) as ultimoId FROM reg_prestamos_externos', (err, results) => {
    if (err) return res.status(500).json({ error: 'Error al calcular consecutivo de folio' });

    const siguienteId = (results[0].ultimoId || 0) + 1;
    const folioAutogenerado = `PREXT-${String(siguienteId).padStart(5, '0')}`;

    res.json({ folio: folioAutogenerado });
  });
});

// --- REGISTRAR EL PRESTAMO (UNIFICANDO CON UNO ACTIVO SI EXISTE) ---
// Misma lógica que routes/prestamos.js: POST /prestamos.
router.post('/prestamos-externos', async (req, res) => {
  const { folio, id_externo, monto_prestamo, username } = req.body;

  if (!folio || !id_externo || !monto_prestamo) {
    return res.status(400).json({ error: 'Faltan parametros obligatorios para procesar el prestamo.' });
  }

  const montoNuevo = parseFloat(monto_prestamo);
  if (!(montoNuevo > 0)) {
    return res.status(400).json({ error: 'El monto del prestamo debe ser mayor a 0.' });
  }

  try {
    const [activos] = await dbPromesa.query(
      `SELECT R.ID_PRESTAMO, R.FOLIO, R.MONTO_PRESTAMO,
              (R.MONTO_PRESTAMO + COALESCE(
                (SELECT SUM(AB.INTERES) - SUM(AB.MONTO_ABONO) FROM abono_prestamos_externos AB WHERE AB.ID_PRESTAMO = R.ID_PRESTAMO), 0
              )) AS RESTANTE
         FROM reg_prestamos_externos R
        WHERE R.ID_EXTERNO = ? AND R.ESTATUS = 1`,
      [id_externo]
    );

    const pendientes = activos.filter(p => parseFloat(p.RESTANTE) > 0);
    const restanteAnterior = pendientes.reduce((acc, p) => acc + parseFloat(p.RESTANTE), 0);
    const foliosAnteriores = pendientes.map(p => p.FOLIO);
    const unificado = restanteAnterior > 0;
    const montoTotal = unificado ? (restanteAnterior + montoNuevo) : montoNuevo;

    if (activos.length > 0) {
      const idsCerrar = activos.map(p => p.ID_PRESTAMO);
      await dbPromesa.query(
        `UPDATE reg_prestamos_externos SET ESTATUS = 0 WHERE ID_PRESTAMO IN (?)`,
        [idsCerrar]
      );
    }

    const [result] = await dbPromesa.query(
      `INSERT INTO reg_prestamos_externos (FOLIO, ID_EXTERNO, MONTO_PRESTAMO, ESTATUS, USUARIO, FECHA_CREACION)
       VALUES (?, ?, ?, 1, ?, NOW())`,
      [folio, id_externo, montoTotal, username || 'Sistema']
    );

    const mensajeUnificado = 'Prestamo unificado con el/los folio(s) ' + foliosAnteriores.join(', ') +
      '. Saldo anterior $' + restanteAnterior.toFixed(2) +
      ' + nuevo prestamo $' + montoNuevo.toFixed(2) +
      ' = total $' + montoTotal.toFixed(2) + '.';

    res.json({
      success: true,
      message: unificado ? mensajeUnificado : 'El prestamo se ha guardado de forma exitosa.',
      id_prestamo: result.insertId,
      unificado,
      folios_anteriores: foliosAnteriores,
      monto_restante_anterior: restanteAnterior,
      monto_nuevo: montoNuevo,
      monto_total: montoTotal
    });
  } catch (err) {
    console.error('Error de base de datos en registro de prestamos externos: ', err);
    res.status(500).json({ error: 'Error interno del servidor al insertar el prestamo.' });
  }
});

// --- CONSULTA DE PRESTAMOS EN TIEMPO REAL ---
router.get('/prestamos-externos-consulta', (req, res) => {
  const query = `
SELECT
    R.ID_PRESTAMO,
    R.FOLIO,
    CONCAT(P.FIRST_NAME, ' ', P.PARENTAL_LAST) AS EXTERNO,
    R.MONTO_PRESTAMO AS MONTO_PRESTAMO,
    COALESCE(G.MONTO_ABONADO, 0) AS MONTO_ABONADO,
    (R.MONTO_PRESTAMO + COALESCE(G.INTERES_ACUMULADO, 0) - COALESCE(G.MONTO_ABONADO, 0)) AS MONTO_RESTANTE
FROM reg_prestamos_externos R
LEFT JOIN personal_externo P ON P.ID_EXTERNO = R.ID_EXTERNO
LEFT JOIN (
    SELECT
        AB.ID_PRESTAMO,
        SUM(AB.MONTO_ABONO) AS MONTO_ABONADO,
        SUM(AB.INTERES) AS INTERES_ACUMULADO
    FROM abono_prestamos_externos AB
    GROUP BY AB.ID_PRESTAMO
) G ON G.ID_PRESTAMO = R.ID_PRESTAMO
WHERE R.ESTATUS = 1
ORDER BY R.ID_PRESTAMO DESC;`;

  db.query(query, (err, results) => {
    if (err) {
      console.error('ERROR REAL EN MYSQL:', err.message);
      return res.status(500).json({ error: `Error en Base de Datos: ${err.message}` });
    }
    res.json(results);
  });
});

// --- REGISTRAR UN ABONO MANUAL (Personal Externo no tiene nómina) ---
// A diferencia de empleados (donde el interés es solo un renglón
// informativo en la nómina, revisarnomina.html), aquí el interés SÍ se
// suma al saldo del préstamo: cada abono primero le agrega el 3% de
// interés al saldo pendiente y luego resta el monto abonado.
const TASA_INTERES_EXTERNO = 0.03;

router.post('/prestamos-externos/:id/abono', async (req, res) => {
  const { id } = req.params;
  const monto = parseFloat(req.body.monto);
  const username = req.body.username || 'Sistema';

  if (!(monto > 0)) {
    return res.status(400).json({ success: false, message: 'El monto del abono debe ser mayor a 0.' });
  }

  try {
    const [[prestamo]] = await dbPromesa.query(
      `SELECT R.ID_PRESTAMO, R.ESTATUS,
              (R.MONTO_PRESTAMO - COALESCE(
                (SELECT SUM(AB.MONTO_ABONO) FROM abono_prestamos_externos AB WHERE AB.ID_PRESTAMO = R.ID_PRESTAMO), 0
              )) AS RESTANTE
         FROM reg_prestamos_externos R
        WHERE R.ID_PRESTAMO = ?`,
      [id]
    );

    if (!prestamo) return res.status(404).json({ success: false, message: 'Préstamo no encontrado.' });
    if (parseInt(prestamo.ESTATUS) !== 1) {
      return res.status(400).json({ success: false, message: 'Este préstamo ya está cerrado.' });
    }

    const restanteActual = parseFloat(prestamo.RESTANTE) || 0;
    const interes = Math.round(restanteActual * TASA_INTERES_EXTERNO);
    const restanteConInteres = restanteActual + interes;

    if (monto > restanteConInteres) {
      return res.status(400).json({ success: false, message: `El abono no puede ser mayor al saldo con interés ($${restanteConInteres.toFixed(2)}).` });
    }

    const montoRestante = restanteConInteres - monto;
    const folioAbono = `ABONO-${Date.now()}`;

    await dbPromesa.query(
      `INSERT INTO abono_prestamos_externos (ID_PRESTAMO, MONTO_ABONO, INTERES, MONTO_RESTANTE, USUARIO, FECHA_CREACION, FOLIO)
       VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
      [id, monto, interes, montoRestante, username, folioAbono]
    );

    res.json({
      success: true,
      message: montoRestante === 0 ? 'Abono registrado. El préstamo quedó liquidado.' : 'Abono registrado correctamente.',
      interes,
      monto_restante: montoRestante
    });
  } catch (err) {
    console.error('Error al registrar abono de personal externo:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor al registrar el abono.' });
  }
});

// --- HISTORIAL COMPLETO DE UN PRESTAMO (PRESTAMOS OTORGADOS + ABONOS) ---
router.get('/abonos-externos', async (req, res) => {
  const idPrestamo = req.query.id_prestamo;

  if (!idPrestamo) {
    return res.status(400).json({ error: 'Falta el parametro id_prestamo' });
  }

  try {
    const [[prestamo]] = await dbPromesa.query(
      'SELECT ID_EXTERNO FROM reg_prestamos_externos WHERE ID_PRESTAMO = ?',
      [idPrestamo]
    );

    if (!prestamo) {
      return res.status(404).json({ error: 'Prestamo no encontrado' });
    }

    const [prestamosExterno] = await dbPromesa.query(
      `SELECT ID_PRESTAMO, FOLIO, MONTO_PRESTAMO, ESTATUS, USUARIO, FECHA_CREACION
         FROM reg_prestamos_externos
        WHERE ID_EXTERNO = ?
        ORDER BY ID_PRESTAMO ASC`,
      [prestamo.ID_EXTERNO]
    );

    const idsPrestamos = prestamosExterno.map(p => p.ID_PRESTAMO);

    const [abonosAgrupados] = idsPrestamos.length
      ? await dbPromesa.query(
          `SELECT ID_PRESTAMO, COALESCE(SUM(MONTO_ABONO), 0) AS ABONADO, COALESCE(SUM(INTERES), 0) AS INTERES_ACUMULADO
             FROM abono_prestamos_externos
            WHERE ID_PRESTAMO IN (?)
            GROUP BY ID_PRESTAMO`,
          [idsPrestamos]
        )
      : [[]];
    const abonadoPorPrestamo = new Map(
      abonosAgrupados.map(a => [a.ID_PRESTAMO, parseFloat(a.ABONADO) || 0])
    );
    const interesPorPrestamo = new Map(
      abonosAgrupados.map(a => [a.ID_PRESTAMO, parseFloat(a.INTERES_ACUMULADO) || 0])
    );

    const eventosPrestamo = prestamosExterno.map((p, i) => {
      const montoTotal = parseFloat(p.MONTO_PRESTAMO) || 0;
      let montoNuevo = montoTotal;

      if (i > 0) {
        const anterior = prestamosExterno[i - 1];
        const restanteAnterior = (parseFloat(anterior.MONTO_PRESTAMO) || 0) +
          (interesPorPrestamo.get(anterior.ID_PRESTAMO) || 0) -
          (abonadoPorPrestamo.get(anterior.ID_PRESTAMO) || 0);

        if (restanteAnterior > 0 && restanteAnterior < montoTotal) {
          montoNuevo = montoTotal - restanteAnterior;
        }
      }

      return {
        TIPO: 'PRESTAMO',
        ID: p.ID_PRESTAMO,
        FOLIO: p.FOLIO,
        ESTATUS: p.ESTATUS,
        MONTO: montoNuevo,
        MONTO_RESTANTE: montoTotal,
        USUARIO: p.USUARIO,
        FECHA_CREACION: p.FECHA_CREACION
      };
    });

    const [abonosRaw] = idsPrestamos.length
      ? await dbPromesa.query(
          `SELECT AB.ID_ABONO AS ID, R.FOLIO, R.ESTATUS, AB.MONTO_ABONO AS MONTO, AB.INTERES,
                  AB.MONTO_RESTANTE, AB.USUARIO, AB.FECHA_CREACION
             FROM abono_prestamos_externos AB
             INNER JOIN reg_prestamos_externos R ON R.ID_PRESTAMO = AB.ID_PRESTAMO
            WHERE R.ID_EXTERNO = ?`,
          [prestamo.ID_EXTERNO]
        )
      : [[]];
    const eventosAbono = abonosRaw.map(a => ({ ...a, TIPO: 'ABONO' }));

    const eventos = [...eventosPrestamo, ...eventosAbono].sort((a, b) => {
      const fa = new Date(a.FECHA_CREACION).getTime();
      const fb = new Date(b.FECHA_CREACION).getTime();
      if (fa !== fb) return fa - fb;
      return a.TIPO === 'PRESTAMO' ? -1 : 1;
    });

    res.json(eventos);
  } catch (err) {
    console.error('ERROR MYSQL EN ABONOS EXTERNOS:', err.message);
    res.status(500).json({ error: `Error en Base de Datos: ${err.message}` });
  }
});

module.exports = router;
