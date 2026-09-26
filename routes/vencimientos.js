// routes/vencimientos.js — Panel de vencimientos de la flotilla y su
// aviso por correo.
//
// El cálculo vive en utils/vencimientos.js, compartido con el script
// scripts/avisoVencimientos.js que corre por cron, para que el correo
// diga exactamente lo mismo que la pantalla.
'use strict';

const express = require('express');
const router = express.Router();
const { obtenerVencimientos } = require('../utils/vencimientos');
const { enviarAvisoVencimientos } = require('../utils/correoVencimientos');

router.get('/vencimientos', async (req, res) => {
  const diasAviso = parseInt(req.query.dias, 10);
  try {
    const datos = await obtenerVencimientos({
      diasAviso: Number.isInteger(diasAviso) && diasAviso > 0 ? diasAviso : undefined,
      soloPendientes: req.query.soloPendientes === '1',
    });
    res.json({ success: true, ...datos });
  } catch (err) {
    console.error('Error al consultar vencimientos:', err);
    res.status(500).json({ success: false, message: 'Error al consultar los vencimientos.' });
  }
});

// Envío manual, para probar sin esperar al cron. El correo automático
// lo dispara scripts/avisoVencimientos.js.
router.post('/vencimientos/enviar-correo', async (req, res) => {
  const diasAviso = parseInt(req.body.dias, 10);
  try {
    const resultado = await enviarAvisoVencimientos({
      diasAviso: Number.isInteger(diasAviso) && diasAviso > 0 ? diasAviso : undefined,
    });

    if (!resultado.enviado) {
      return res.json({ success: true, enviado: false, message: resultado.motivo });
    }
    res.json({ success: true, enviado: true, message: `Aviso enviado con ${resultado.total} pendiente(s).` });
  } catch (err) {
    console.error('Error al enviar el aviso de vencimientos:', err);
    res.status(500).json({ success: false, message: `No se pudo enviar el correo: ${err.message}` });
  }
});

module.exports = router;
