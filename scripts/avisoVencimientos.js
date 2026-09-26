#!/usr/bin/env node
// scripts/avisoVencimientos.js — Aviso diario de vencimientos por correo.
//
// Pensado para correrse desde el cron de Hostinger, no desde el propio
// servidor web: un cron externo sobrevive a los reinicios del App
// Manager, cosa que un temporizador dentro del proceso no haría.
//
// Programarlo en Hostinger (hPanel -> Cron Jobs), por ejemplo a las 8am:
//
//     0 8 * * *  cd /home/u385690885/domains/transportesalas.com.mx/public_html && node scripts/avisoVencimientos.js
//
// Acepta los días de aviso como argumento (default 30):
//     node scripts/avisoVencimientos.js 15
'use strict';

require('dotenv').config();

const { enviarAvisoVencimientos } = require('../utils/correoVencimientos');
const { db } = require('../config/db');

(async () => {
  const dias = parseInt(process.argv[2], 10);

  try {
    const resultado = await enviarAvisoVencimientos({
      diasAviso: Number.isInteger(dias) && dias > 0 ? dias : undefined,
    });

    console.log(resultado.enviado
      ? `Aviso enviado: ${resultado.resumen.vencidos} vencido(s), ${resultado.resumen.porVencer} por vencer.`
      : resultado.motivo);

    process.exitCode = 0;
  } catch (err) {
    // El cron debe terminar en error para que quede rastro en el log si
    // el SMTP o la base fallan.
    console.error('Error al enviar el aviso de vencimientos:', err.message);
    process.exitCode = 1;
  } finally {
    db.end(() => {});
  }
})();
