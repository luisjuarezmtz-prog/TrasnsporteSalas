// utils/amortizacionSeguro.js — Plan de pagos de una póliza de seguro.
//
// Regla del cliente: se captura el valor total del seguro, el plazo en
// meses y el PRIMER PAGO a mano (suele ser un enganche distinto al
// resto). Lo que queda se amortiza en partes iguales entre los meses
// restantes.
//
// El redondeo se acumula en el último pago para que la suma del plan
// cuadre exactamente contra el valor de la póliza: repartir centavos
// parejo dejaría diferencias de unos pesos contra lo que cobra la
// aseguradora.
'use strict';

// Suma meses cuidando el fin de mes: 31-ene + 1 mes debe caer en el
// último día de febrero, no "resbalar" al 2 o 3 de marzo como haría
// Date.setMonth por sí solo.
function sumarMeses(fechaISO, meses) {
  const [anio, mes, dia] = String(fechaISO).split('-').map(Number);
  const base = new Date(Date.UTC(anio, mes - 1 + meses, 1));
  const ultimoDia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(dia, ultimoDia));
  return base.toISOString().split('T')[0];
}

function aCentavos(valor) {
  return Math.round(Number(valor) * 100);
}

// Devuelve { error } o { pagos: [{ numero, fecha, monto }] }.
function calcularPlanPagos({ valorSeguro, primerPago, plazoMeses, fechaPrimerPago }) {
  const valor = aCentavos(valorSeguro);
  const enganche = aCentavos(primerPago || 0);
  const plazo = parseInt(plazoMeses, 10);

  if (!Number.isFinite(valor) || valor <= 0) return { error: 'El valor del seguro debe ser mayor a 0.' };
  if (!Number.isFinite(enganche) || enganche < 0) return { error: 'El primer pago no puede ser negativo.' };
  if (!Number.isInteger(plazo) || plazo < 1) return { error: 'El plazo debe ser de al menos 1 mes.' };
  if (enganche > valor) return { error: 'El primer pago no puede ser mayor al valor del seguro.' };
  if (!fechaPrimerPago) return { error: 'La fecha del primer pago es obligatoria.' };

  const restante = valor - enganche;

  // Con plazo de 1 mes el primer pago tiene que liquidar la póliza.
  if (plazo === 1) {
    if (restante !== 0) {
      return { error: 'Con plazo de 1 mes, el primer pago debe ser igual al valor del seguro.' };
    }
    return { pagos: [{ numero: 1, fecha: fechaPrimerPago, monto: valor / 100 }] };
  }

  // Si el primer pago ya liquidó todo, no tiene caso generar mensualidades en cero.
  if (restante === 0) {
    return { pagos: [{ numero: 1, fecha: fechaPrimerPago, monto: valor / 100 }] };
  }

  // Sin enganche no hay "primer pago distinto": se reparte todo parejo
  // entre los meses del plazo, en vez de dejar un primer pago en cero.
  const hayEnganche = enganche > 0;
  const mensualidades = hayEnganche ? plazo - 1 : plazo;
  const cuota = Math.floor(restante / mensualidades);
  const sobrante = restante - cuota * mensualidades;

  const pagos = hayEnganche ? [{ numero: 1, fecha: fechaPrimerPago, monto: enganche / 100 }] : [];
  for (let i = 0; i < mensualidades; i++) {
    // El sobrante del redondeo se va todo al último pago.
    const montoCentavos = i === mensualidades - 1 ? cuota + sobrante : cuota;
    pagos.push({
      numero: pagos.length + 1,
      // Con enganche las mensualidades arrancan un mes después; sin él,
      // la primera cae en la misma fecha capturada.
      fecha: sumarMeses(fechaPrimerPago, hayEnganche ? i + 1 : i),
      monto: montoCentavos / 100,
    });
  }

  return { pagos };
}

module.exports = { calcularPlanPagos, sumarMeses };
