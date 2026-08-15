// routes/prestamos.js -- Prestamos a empleados
'use strict';

const express = require('express');
const router = express.Router();
const { db, dbPromesa } = require('../config/db');

// --- RUTA 26: GENERAR FOLIO AUTOMATICO PARA PRESTAMOS ---
router.get('/prestamos/nuevo-folio', (req, res) => {
  db.query('SELECT MAX(ID_PRESTAMO) as ultimoId FROM reg_prestamos', (err, results) => {
    if (err) return res.status(500).json({ error: 'Error al calcular consecutivo de folio' });

    const siguienteId = (results[0].ultimoId || 0) + 1;
    const folioAutogenerado = `PREST-${String(siguienteId).padStart(5, '0')}`;

    res.json({ folio: folioAutogenerado });
  });
});

// --- RUTA 27: REGISTRAR EL PRESTAMO (UNIFICANDO CON UNO ACTIVO SI EXISTE) ---
// Si el empleado ya tiene uno o mas prestamos activos (ESTATUS = 1) con saldo
// pendiente, el nuevo prestamo NO se guarda como un registro aparte: se cierran
// los prestamos anteriores (ESTATUS = 0) y se crea un unico registro nuevo cuyo
// MONTO_PRESTAMO es la suma del saldo pendiente anterior + el monto recien
// solicitado. Asi el saldo ya abonado queda descontado y todo lo pendiente
// queda unificado en un solo prestamo activo por empleado.
router.post('/prestamos', async (req, res) => {
  const { folio, id_empleado, monto_prestamo, username } = req.body;

  if (!folio || !id_empleado || !monto_prestamo) {
    return res.status(400).json({ error: 'Faltan parametros obligatorios para procesar el prestamo.' });
  }

  const montoNuevo = parseFloat(monto_prestamo);
  if (!(montoNuevo > 0)) {
    return res.status(400).json({ error: 'El monto del prestamo debe ser mayor a 0.' });
  }

  try {
    // 1. Prestamos activos del empleado, con su saldo pendiente calculado
    //    en vivo (monto original - suma de abonos ya registrados).
    const [activos] = await dbPromesa.query(
      `SELECT R.ID_PRESTAMO, R.FOLIO, R.MONTO_PRESTAMO,
              (R.MONTO_PRESTAMO - COALESCE(
                (SELECT SUM(AB.MONTO_ABONO) FROM abono_prestamos AB WHERE AB.ID_PRESTAMO = R.ID_PRESTAMO), 0
              )) AS RESTANTE
         FROM reg_prestamos R
        WHERE R.ID_EMPLEADO = ? AND R.ESTATUS = 1`,
      [id_empleado]
    );

    const pendientes = activos.filter(p => parseFloat(p.RESTANTE) > 0);
    const restanteAnterior = pendientes.reduce((acc, p) => acc + parseFloat(p.RESTANTE), 0);
    const foliosAnteriores = pendientes.map(p => p.FOLIO);
    const unificado = restanteAnterior > 0;
    const montoTotal = unificado ? (restanteAnterior + montoNuevo) : montoNuevo;

    // 2. Cerrar TODOS los prestamos activos previos del empleado (tengan o no
    //    saldo pendiente). Antes solo se cerraban los que tenian saldo > 0,
    //    y un prestamo viejo ya totalmente pagado (RESTANTE = 0) se quedaba
    //    con ESTATUS = 1 para siempre ("zombie"). Eso provocaba que un mismo
    //    empleado tuviera 2 o 3 filas con ESTATUS = 1 en reg_prestamos, y
    //    cualquier pantalla que una nomina/consulta con el prestamo activo
    //    por empleado terminaba duplicando o triplicando esas filas. Ahora
    //    se cierra cualquier prestamo activo anterior al crear uno nuevo, asi
    //    solo queda UNO activo por empleado en todo momento.
    if (activos.length > 0) {
      const idsCerrar = activos.map(p => p.ID_PRESTAMO);
      await dbPromesa.query(
        `UPDATE reg_prestamos SET ESTATUS = 0 WHERE ID_PRESTAMO IN (?)`,
        [idsCerrar]
      );
    }

    // 3. Registrar el prestamo: monto unificado si aplica, o el monto simple.
    const [result] = await dbPromesa.query(
      `INSERT INTO reg_prestamos (FOLIO, ID_EMPLEADO, MONTO_PRESTAMO,ESTATUS,USUARIO, FECHA_CREACION)
       VALUES (?, ?, ?, 1,?, NOW())`,
      [folio, id_empleado, montoTotal, username || 'Sistema']
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
    console.error('Error de base de datos en registro de prestamos: ', err);
    res.status(500).json({ error: 'Error interno del servidor al insertar el prestamo.' });
  }
});

// --- CONSULTA DE PRESTAMOS EN TIEMPO REAL ---
// Solo muestra prestamos activos (ESTATUS = 1). Los que quedaron unificados
// dentro de uno nuevo se marcan ESTATUS = 0 y dejan de aparecer aqui, aunque
// su historial de abonos sigue existiendo en la base de datos.
// MONTO_RESTANTE se calcula en vivo (monto - abonado) en lugar de depender de
// un valor guardado por abono, asi siempre refleja el saldo real, incluso
// despues de una unificacion.
router.get('/prestamosconsulta', (req, res) => {
  const query = `
SELECT
    R.ID_PRESTAMO,
    R.FOLIO,
    CONCAT(E.FIRST_NAME, ' ', E.PARENTAL_LAST) AS EMPLEADO,
    R.MONTO_PRESTAMO AS MONTO_PRESTAMO,
    COALESCE(G.MONTO_ABONADO, 0) AS MONTO_ABONADO,
    (R.MONTO_PRESTAMO - COALESCE(G.MONTO_ABONADO, 0)) AS MONTO_RESTANTE
FROM reg_prestamos R
LEFT JOIN employees E ON E.ID_EMPLOYEE = R.ID_EMPLEADO
LEFT JOIN (
    SELECT
        AB.ID_PRESTAMO,
        SUM(AB.MONTO_ABONO) AS MONTO_ABONADO
    FROM abono_prestamos AB
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

// --- HISTORIAL COMPLETO DE UN PRESTAMO (PRESTAMOS OTORGADOS + ABONOS) ---
// Se pide un id_prestamo (el prestamo activo actual), pero el historial
// devuelto es el de TODA la cadena de prestamos de ese empleado (incluyendo
// el/los prestamo(s) anterior(es) ya cerrados por unificacion), combinando
// dos tipos de eventos en una sola linea de tiempo:
//   - TIPO 'PRESTAMO': cada vez que se otorgo/unifico un prestamo. El MONTO
//     mostrado es el monto NUEVO realmente entregado en ese momento (no el
//     total ya unificado), calculado restando el saldo pendiente del
//     prestamo inmediatamente anterior de ese empleado. MONTO_RESTANTE es el
//     saldo total que queda activo justo despues de otorgarlo (anterior +
//     nuevo), para poder ver la suma completa.
//   - TIPO 'ABONO': cada pago/descuento aplicado al prestamo (dinero que
//     regresa), igual que antes.
// Asi el historial queda completo: se ve el prestamo inicial, los abonos
// hechos, y cuando se otorgo un nuevo prestamo (unificado o no) con su
// monto real y el nuevo total resultante.
router.get('/abonos', async (req, res) => {
  const idPrestamo = req.query.id_prestamo;

  if (!idPrestamo) {
    return res.status(400).json({ error: 'Falta el parametro id_prestamo' });
  }

  try {
    const [[prestamo]] = await dbPromesa.query(
      'SELECT ID_EMPLEADO FROM reg_prestamos WHERE ID_PRESTAMO = ?',
      [idPrestamo]
    );

    if (!prestamo) {
      return res.status(404).json({ error: 'Prestamo no encontrado' });
    }

    // Todos los prestamos (otorgamientos) de este empleado, en orden cronologico.
    const [prestamosEmpleado] = await dbPromesa.query(
      `SELECT ID_PRESTAMO, FOLIO, MONTO_PRESTAMO, ESTATUS, USUARIO, FECHA_CREACION
         FROM reg_prestamos
        WHERE ID_EMPLEADO = ?
        ORDER BY ID_PRESTAMO ASC`,
      [prestamo.ID_EMPLEADO]
    );

    const idsPrestamos = prestamosEmpleado.map(p => p.ID_PRESTAMO);

    // Total abonado a cada prestamo (para saber su saldo final al cerrarse).
    const [abonosAgrupados] = idsPrestamos.length
      ? await dbPromesa.query(
          `SELECT ID_PRESTAMO, COALESCE(SUM(MONTO_ABONO), 0) AS ABONADO
             FROM abono_prestamos
            WHERE ID_PRESTAMO IN (?)
            GROUP BY ID_PRESTAMO`,
          [idsPrestamos]
        )
      : [[]];
    const abonadoPorPrestamo = new Map(
      abonosAgrupados.map(a => [a.ID_PRESTAMO, parseFloat(a.ABONADO) || 0])
    );

    // Eventos de tipo PRESTAMO: monto nuevo real (no el total unificado).
    const eventosPrestamo = prestamosEmpleado.map((p, i) => {
      const montoTotal = parseFloat(p.MONTO_PRESTAMO) || 0;
      let montoNuevo = montoTotal;

      if (i > 0) {
        const anterior = prestamosEmpleado[i - 1];
        const restanteAnterior = (parseFloat(anterior.MONTO_PRESTAMO) || 0) -
          (abonadoPorPrestamo.get(anterior.ID_PRESTAMO) || 0);

        // Solo se resta si el anterior de verdad tenia saldo pendiente y ese
        // saldo cabe dentro del monto total (evita numeros negativos raros
        // con datos historicos que no pasaron por la unificacion).
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

    // Eventos de tipo ABONO: igual que antes.
    const [abonosRaw] = idsPrestamos.length
      ? await dbPromesa.query(
          `SELECT AB.ID_ABONO AS ID, R.FOLIO, R.ESTATUS, AB.MONTO_ABONO AS MONTO,
                  AB.MONTO_RESTANTE, AB.USUARIO, AB.FECHA_CREACION
             FROM abono_prestamos AB
             INNER JOIN reg_prestamos R ON R.ID_PRESTAMO = AB.ID_PRESTAMO
            WHERE R.ID_EMPLEADO = ?`,
          [prestamo.ID_EMPLEADO]
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
    console.error('ERROR MYSQL EN ABONOS:', err.message);
    res.status(500).json({ error: `Error en Base de Datos: ${err.message}` });
  }
});

module.exports = router;
