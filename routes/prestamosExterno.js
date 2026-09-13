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

// El interés (periodicidad SEMANAL/MENSUAL y tasa 3%/10% pactadas por
// préstamo) vive en utils/interesExterno.js, compartido con
// routes/reportes.js para que ambos muestren el mismo saldo.
const {
  PERIODICIDADES_VALIDAS,
  TASAS_VALIDAS,
  normalizaPeriodicidad,
  normalizaTasa,
  conInteresAlDia,
} = require('../utils/interesExterno');

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
  const { folio, id_externo, monto_prestamo, periodicidad, tasa_interes, username } = req.body;

  if (!folio || !id_externo || !monto_prestamo) {
    return res.status(400).json({ error: 'Faltan parametros obligatorios para procesar el prestamo.' });
  }

  const montoNuevo = parseFloat(monto_prestamo);
  if (!(montoNuevo > 0)) {
    return res.status(400).json({ error: 'El monto del prestamo debe ser mayor a 0.' });
  }

  if (!PERIODICIDADES_VALIDAS.includes(String(periodicidad || '').toUpperCase())) {
    return res.status(400).json({ error: 'La periodicidad del interes debe ser SEMANAL o MENSUAL.' });
  }
  if (!TASAS_VALIDAS.includes(parseFloat(tasa_interes))) {
    return res.status(400).json({ error: 'La tasa de interes debe ser 3% o 10%.' });
  }

  const periodicidadNueva = normalizaPeriodicidad(periodicidad);
  const tasaNueva = normalizaTasa(tasa_interes);

  try {
    // El saldo que se arrastra al unificar ya trae el interés devengado
    // hasta hoy con la periodicidad/tasa CON LAS QUE SE PACTÓ cada
    // préstamo anterior; de ahí en adelante corre la nueva.
    const [activos] = await dbPromesa.query(
      `SELECT R.ID_PRESTAMO, R.FOLIO, R.MONTO_PRESTAMO, R.PERIODICIDAD, R.TASA_INTERES,
              (R.MONTO_PRESTAMO + COALESCE(G.INTERES_ACUMULADO, 0) - COALESCE(G.MONTO_ABONADO, 0)) AS SALDO_BASE,
              COALESCE(G.ULTIMO_MOVIMIENTO, R.FECHA_CREACION) AS FECHA_ULTIMO_MOVIMIENTO
         FROM reg_prestamos_externos R
         LEFT JOIN (
             SELECT ID_PRESTAMO,
                    SUM(MONTO_ABONO) AS MONTO_ABONADO,
                    SUM(INTERES) AS INTERES_ACUMULADO,
                    MAX(FECHA_CREACION) AS ULTIMO_MOVIMIENTO
               FROM abono_prestamos_externos
              GROUP BY ID_PRESTAMO
         ) G ON G.ID_PRESTAMO = R.ID_PRESTAMO
        WHERE R.ID_EXTERNO = ? AND R.ESTATUS = 1`,
      [id_externo]
    );

    const pendientes = activos.map(conInteresAlDia).filter(p => p.MONTO_RESTANTE > 0);
    const restanteAnterior = pendientes.reduce((acc, p) => acc + p.MONTO_RESTANTE, 0);
    const foliosAnteriores = pendientes.map(p => p.FOLIO);
    const unificado = restanteAnterior > 0;
    const montoTotal = unificado ? (restanteAnterior + montoNuevo) : montoNuevo;

    // Antes de cerrarlos, se capitaliza en el historial el interés que el
    // préstamo anterior alcanzó a devengar: si no se registra, el saldo
    // que se arrastra al préstamo nuevo no cuadraría contra su ledger.
    for (const p of pendientes) {
      if (p.INTERES_PENDIENTE > 0) {
        await dbPromesa.query(
          `INSERT INTO abono_prestamos_externos (ID_PRESTAMO, MONTO_ABONO, INTERES, PERIODOS, MONTO_RESTANTE, USUARIO, FECHA_CREACION, FOLIO)
           VALUES (?, 0, ?, ?, ?, ?, NOW(), ?)`,
          [p.ID_PRESTAMO, p.INTERES_PENDIENTE, p.PERIODOS_PENDIENTES, p.MONTO_RESTANTE, username || 'Sistema', `INTERES-${Date.now()}-${p.ID_PRESTAMO}`]
        );
      }
    }

    if (activos.length > 0) {
      const idsCerrar = activos.map(p => p.ID_PRESTAMO);
      await dbPromesa.query(
        `UPDATE reg_prestamos_externos SET ESTATUS = 0 WHERE ID_PRESTAMO IN (?)`,
        [idsCerrar]
      );
    }

    const [result] = await dbPromesa.query(
      `INSERT INTO reg_prestamos_externos (FOLIO, ID_EXTERNO, MONTO_PRESTAMO, PERIODICIDAD, TASA_INTERES, ESTATUS, USUARIO, FECHA_CREACION)
       VALUES (?, ?, ?, ?, ?, 1, ?, NOW())`,
      [folio, id_externo, montoTotal, periodicidadNueva, tasaNueva, username || 'Sistema']
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
      monto_total: montoTotal,
      periodicidad: periodicidadNueva,
      tasa_interes: tasaNueva
    });
  } catch (err) {
    console.error('Error de base de datos en registro de prestamos externos: ', err);
    res.status(500).json({ error: 'Error interno del servidor al insertar el prestamo.' });
  }
});

// --- CONSULTA DE PRESTAMOS EN TIEMPO REAL ---
// MONTO_RESTANTE ya incluye el interés devengado a la fecha de consulta,
// no solo el que se capitalizó en los abonos: el saldo sube solo con que
// pase una semana / un mes, según lo pactado en el préstamo.
router.get('/prestamos-externos-consulta', (req, res) => {
  const query = `
SELECT
    R.ID_PRESTAMO,
    R.FOLIO,
    CONCAT(P.FIRST_NAME, ' ', P.PARENTAL_LAST) AS EXTERNO,
    R.MONTO_PRESTAMO AS MONTO_PRESTAMO,
    R.PERIODICIDAD,
    R.TASA_INTERES,
    COALESCE(G.MONTO_ABONADO, 0) AS MONTO_ABONADO,
    COALESCE(G.INTERES_ACUMULADO, 0) AS INTERES_ACUMULADO,
    (R.MONTO_PRESTAMO + COALESCE(G.INTERES_ACUMULADO, 0) - COALESCE(G.MONTO_ABONADO, 0)) AS SALDO_BASE,
    COALESCE(G.ULTIMO_MOVIMIENTO, R.FECHA_CREACION) AS FECHA_ULTIMO_MOVIMIENTO
FROM reg_prestamos_externos R
LEFT JOIN personal_externo P ON P.ID_EXTERNO = R.ID_EXTERNO
LEFT JOIN (
    SELECT
        AB.ID_PRESTAMO,
        SUM(AB.MONTO_ABONO) AS MONTO_ABONADO,
        SUM(AB.INTERES) AS INTERES_ACUMULADO,
        MAX(AB.FECHA_CREACION) AS ULTIMO_MOVIMIENTO
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
    res.json(results.map(conInteresAlDia));
  });
});

// --- REGISTRAR UN ABONO MANUAL (Personal Externo no tiene nómina) ---
// A diferencia de empleados (donde el interés es solo un renglón
// informativo en la nómina, revisarnomina.html), aquí el interés SÍ se
// suma al saldo del préstamo: al abonar primero se capitaliza el interés
// devengado desde el último movimiento (un periodo completo por cada
// semana o mes transcurrido, a la tasa pactada) y luego se resta el
// monto abonado. Un periodo a medias no se cobra y su cuenta arranca de
// nuevo desde la fecha de este abono.
router.post('/prestamos-externos/:id/abono', async (req, res) => {
  const { id } = req.params;
  const monto = parseFloat(req.body.monto);
  const username = req.body.username || 'Sistema';

  if (!(monto > 0)) {
    return res.status(400).json({ success: false, message: 'El monto del abono debe ser mayor a 0.' });
  }

  try {
    const [[prestamo]] = await dbPromesa.query(
      `SELECT R.ID_PRESTAMO, R.ESTATUS, R.PERIODICIDAD, R.TASA_INTERES,
              (R.MONTO_PRESTAMO + COALESCE(G.INTERES_ACUMULADO, 0) - COALESCE(G.MONTO_ABONADO, 0)) AS SALDO_BASE,
              COALESCE(G.ULTIMO_MOVIMIENTO, R.FECHA_CREACION) AS FECHA_ULTIMO_MOVIMIENTO
         FROM reg_prestamos_externos R
         LEFT JOIN (
             SELECT ID_PRESTAMO,
                    SUM(MONTO_ABONO) AS MONTO_ABONADO,
                    SUM(INTERES) AS INTERES_ACUMULADO,
                    MAX(FECHA_CREACION) AS ULTIMO_MOVIMIENTO
               FROM abono_prestamos_externos
              GROUP BY ID_PRESTAMO
         ) G ON G.ID_PRESTAMO = R.ID_PRESTAMO
        WHERE R.ID_PRESTAMO = ?`,
      [id]
    );

    if (!prestamo) return res.status(404).json({ success: false, message: 'Préstamo no encontrado.' });
    if (parseInt(prestamo.ESTATUS) !== 1) {
      return res.status(400).json({ success: false, message: 'Este préstamo ya está cerrado.' });
    }

    const saldo = conInteresAlDia(prestamo);
    const interes = saldo.INTERES_PENDIENTE;
    const restanteConInteres = saldo.MONTO_RESTANTE;

    if (monto > restanteConInteres) {
      return res.status(400).json({ success: false, message: `El abono no puede ser mayor al saldo con interés ($${restanteConInteres.toFixed(2)}).` });
    }

    const montoRestante = restanteConInteres - monto;
    const folioAbono = `ABONO-${Date.now()}`;

    await dbPromesa.query(
      `INSERT INTO abono_prestamos_externos (ID_PRESTAMO, MONTO_ABONO, INTERES, PERIODOS, MONTO_RESTANTE, USUARIO, FECHA_CREACION, FOLIO)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [id, monto, interes, saldo.PERIODOS_PENDIENTES, montoRestante, username, folioAbono]
    );

    res.json({
      success: true,
      message: montoRestante === 0 ? 'Abono registrado. El préstamo quedó liquidado.' : 'Abono registrado correctamente.',
      interes,
      periodos: saldo.PERIODOS_PENDIENTES,
      periodicidad: saldo.PERIODICIDAD,
      tasa_interes: saldo.TASA_INTERES,
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
      `SELECT ID_PRESTAMO, FOLIO, MONTO_PRESTAMO, PERIODICIDAD, TASA_INTERES, ESTATUS, USUARIO, FECHA_CREACION
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
        PERIODICIDAD: normalizaPeriodicidad(p.PERIODICIDAD),
        TASA_INTERES: normalizaTasa(p.TASA_INTERES),
        USUARIO: p.USUARIO,
        FECHA_CREACION: p.FECHA_CREACION
      };
    });

    const [abonosRaw] = idsPrestamos.length
      ? await dbPromesa.query(
          `SELECT AB.ID_ABONO AS ID, R.FOLIO, R.ESTATUS, AB.MONTO_ABONO AS MONTO, AB.INTERES, AB.PERIODOS,
                  R.PERIODICIDAD, R.TASA_INTERES, AB.MONTO_RESTANTE, AB.USUARIO, AB.FECHA_CREACION
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
