const express = require('express');
const app = express();
const authRoutes = require('./src/routes/auth');
const parcelasRoutes = require('./src/routes/parcelas');
const dimensionesRoutes = require('./src/routes/dimensiones');
const controlesTierraRoutes = require('./src/routes/controlesTierra');
const tiposUvasRoutes = require('./src/routes/tiposUvas');
const siembrasRoutes = require('./src/routes/siembras');

const cors = require('cors');

// Configurar CORS para permitir solicitudes del frontend
const FRONTEND_HOST = process.env.FRONTEND_HOST || 'http://localhost:3001'
app.use(cors({
    origin: FRONTEND_HOST, // Cambia esto al puerto donde corre tu frontend
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));

// Middleware para analizar JSON
app.use(express.json());

// Usar las rutas de autenticación
app.use('/auth', authRoutes);

// Usar las rutas de parcelas
app.use('/parcelas', parcelasRoutes);

// Usar las rutas de dimensiones
app.use('/dimensiones', dimensionesRoutes);

// Usar las rutas de controles de tierra
app.use('/controlesTierra', controlesTierraRoutes);

// Usar las rutas de tipos de uvas
app.use('/tiposUvas', tiposUvasRoutes);

// Usar las rutas de siembras
app.use('/siembras', siembrasRoutes);

// Servidor escuchando en el puerto 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
