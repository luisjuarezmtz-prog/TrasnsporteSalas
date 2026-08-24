// server.js — Punto de entrada de la aplicación (Transportes Salas)
'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Solo se sirve la carpeta public/ (HTML, CSS, JS del cliente e imágenes).
// El código del servidor (config/, routes/, .env) ya NO es accesible por HTTP.
app.use(express.static(path.join(__dirname, 'public')));

// Archivos subidos (tarjetas de circulación, etc.)
const { UPLOADS_DIR } = require('./routes/checks');
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Rutas de la API, agrupadas por dominio ────────────────────────────────
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/catalogos'));
app.use('/api', require('./routes/empleados'));
app.use('/api', require('./routes/personalExterno'));
app.use('/api', require('./routes/prestamosExterno'));
app.use('/api', require('./routes/cajaAhorroExterno'));
app.use('/api', require('./routes/roles'));
app.use('/api', require('./routes/usuarios'));
app.use('/api', require('./routes/viajes'));
app.use('/api', require('./routes/movimientos'));
app.use('/api', require('./routes/tarimas'));
app.use('/api', require('./routes/nomina'));
app.use('/api', require('./routes/prestamos'));
app.use('/api', require('./routes/cajaAhorro'));
app.use('/api', require('./routes/cxc'));
app.use('/api', require('./routes/proveedores'));
app.use('/api', require('./routes/catalogosAdmin'));
app.use('/api', require('./routes/checks').router);

// Ruta heredada que el frontend original llama sin el prefijo /api
app.use('/', require('./routes/nomina').rootRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor activo en http://localhost:${PORT}`));
