const express = require('express');
const router = express.Router();
const { connectWithConnector } = require('../database/connector'); // Ajusta el path si es necesario

// Ruta para registrar dimensiones para una parcela
router.post('/', async (req, res) => {
    const { id_parcela, superficie, longitud, anchura, pendiente } = req.body;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Verificar si la parcela tiene siembras activas
        const siembrasActivas = await client.query(
            `SELECT COUNT(*) 
             FROM siembras 
             WHERE id_parcela = $1 AND id_estado_siembra = 1`, // Siembra activa
            [id_parcela]
        );

        if (siembrasActivas.rows[0].count > 0) {
            return res.status(400).send('La parcela tiene siembras activas. No se pueden registrar nuevas dimensiones.');
        }

        // Insertar las nuevas dimensiones
        await client.query(
            `INSERT INTO dimensiones_parcelas (id_parcela, superficie, longitud, anchura, pendiente, fecha_creacion) 
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [id_parcela, superficie, longitud, anchura, pendiente]
        );

        client.release();
        res.status(201).send('Dimensiones registradas exitosamente');
    } catch (error) {
        console.error('Error al registrar dimensiones:', error);
        res.status(500).send('Error al registrar dimensiones');
    }
});

module.exports = router;
