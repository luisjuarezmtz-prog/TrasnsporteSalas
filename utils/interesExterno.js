// utils/interesExterno.js — Cálculo del interés de los préstamos de
// Personal Externo.
//
// Cada préstamo se pacta con una periodicidad (SEMANAL o MENSUAL) y una
// tasa (3% o 10%) por periodo, guardadas en reg_prestamos_externos
// (ver migrations/Server/2026_09_prestamos_externos_periodicidad.sql).
//
// El saldo crece SOLO CON EL PASO DEL TIEMPO: por cada periodo completo
// transcurrido desde el último movimiento se devenga `tasa` sobre el
// saldo vigente. El interés se guarda (se capitaliza) al registrar un
// abono; entre abonos se calcula al vuelo para mostrar el saldo real.
//
// El "último movimiento" es la fecha del último renglón de
// abono_prestamos_externos, que siempre existe: el trigger
// after_reg_prestamos_externos_insert siembra un abono en cero con la
// fecha de creación del préstamo.
//
// Se usa desde routes/prestamosExterno.js (consulta y registro de
// abonos) y desde routes/reportes.js, para que ambos muestren el mismo
// saldo.
'use strict';

const PERIODICIDADES_VALIDAS = ['SEMANAL', 'MENSUAL'];
const TASAS_VALIDAS = [3, 10];

function normalizaPeriodicidad(valor) {
  const periodicidad = String(valor || '').trim().toUpperCase();
  return PERIODICIDADES_VALIDAS.includes(periodicidad) ? periodicidad : 'SEMANAL';
}

function normalizaTasa(valor) {
  const tasa = parseFloat(valor);
  return TASAS_VALIDAS.includes(tasa) ? tasa : 3;
}

// Periodos COMPLETOS transcurridos entre dos fechas. Los meses se cuentan
// por calendario (del 15 de enero al 15 de febrero = 1 mes) y las semanas
// por bloques de 7 días. Un periodo a medias todavía no se cobra.
function periodosTranscurridos(desde, hasta, periodicidad) {
  const inicio = new Date(desde);
  const fin = new Date(hasta);
  if (isNaN(inicio) || isNaN(fin) || fin <= inicio) return 0;

  if (periodicidad === 'MENSUAL') {
    let meses = (fin.getFullYear() - inicio.getFullYear()) * 12 + (fin.getMonth() - inicio.getMonth());
    if (fin.getDate() < inicio.getDate()) meses--;
    return Math.max(0, meses);
  }

  const dias = Math.floor((fin - inicio) / 86400000);
  return Math.max(0, Math.floor(dias / 7));
}

// Interés devengado y todavía no capitalizado, a la fecha indicada.
// Devuelve también los periodos para poder explicarlo en pantalla.
function interesDevengado(saldoBase, periodicidad, tasa, fechaUltimoMovimiento, hasta = new Date()) {
  const periodos = periodosTranscurridos(fechaUltimoMovimiento, hasta, periodicidad);
  if (saldoBase <= 0 || periodos <= 0) return { periodos: 0, interes: 0 };
  return { periodos, interes: Math.round(saldoBase * (tasa / 100) * periodos) };
}

// Toma una fila con SALDO_BASE / PERIODICIDAD / TASA_INTERES /
// FECHA_ULTIMO_MOVIMIENTO y le agrega el interés devengado a hoy.
function conInteresAlDia(fila) {
  const saldoBase = parseFloat(fila.SALDO_BASE) || 0;
  const periodicidad = normalizaPeriodicidad(fila.PERIODICIDAD);
  const tasa = normalizaTasa(fila.TASA_INTERES);
  const { periodos, interes } = interesDevengado(saldoBase, periodicidad, tasa, fila.FECHA_ULTIMO_MOVIMIENTO);

  return {
    ...fila,
    PERIODICIDAD: periodicidad,
    TASA_INTERES: tasa,
    SALDO_BASE: saldoBase,
    PERIODOS_PENDIENTES: periodos,
    INTERES_PENDIENTE: interes,
    MONTO_RESTANTE: saldoBase + interes
  };
}

module.exports = {
  PERIODICIDADES_VALIDAS,
  TASAS_VALIDAS,
  normalizaPeriodicidad,
  normalizaTasa,
  periodosTranscurridos,
  interesDevengado,
  conInteresAlDia,
};
