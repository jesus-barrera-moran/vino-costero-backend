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

// Obtener dimensiones actuales e historial de cada parcela
router.get('/', async (req, res) => {
    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Obtener todas las parcelas con las dimensiones actuales (la más reciente por cada parcela)
        const parcelasResult = await client.query(
            `SELECT p.id_parcela, p.nombre_parcela, 
                    dp.superficie, dp.longitud, dp.anchura, dp.pendiente, dp.fecha_creacion
             FROM parcelas p
             JOIN dimensiones_parcelas dp ON p.id_parcela = dp.id_parcela
             WHERE dp.fecha_creacion = (
                SELECT MAX(dp2.fecha_creacion)
                FROM dimensiones_parcelas dp2
                WHERE dp2.id_parcela = dp.id_parcela
             )`
        );

        const parcelas = parcelasResult.rows;

        // Obtener el historial de dimensiones para cada parcela
        const parcelasDetalles = await Promise.all(parcelas.map(async (parcela) => {
            const historialDimensionesResult = await client.query(
                `SELECT superficie, longitud, anchura, pendiente, fecha_creacion
                 FROM dimensiones_parcelas
                 WHERE id_parcela = $1
                 ORDER BY fecha_creacion DESC`,
                [parcela.id_parcela]
            );

            const historialDimensiones = historialDimensionesResult.rows;

            return {
                id: parcela.id_parcela,
                nombre: parcela.nombre_parcela,
                dimensionesActuales: {
                    superficie: parcela.superficie,
                    longitud: parcela.longitud,
                    anchura: parcela.anchura,
                    pendiente: parcela.pendiente,
                    fecha: parcela.fecha_creacion,
                },
                historialDimensiones: historialDimensiones.map((dimension) => ({
                    superficie: dimension.superficie,
                    longitud: dimension.longitud,
                    anchura: dimension.anchura,
                    pendiente: dimension.pendiente,
                    fecha: dimension.fecha_creacion,
                })),
            };
        }));

        client.release();

        res.status(200).json(parcelasDetalles);
    } catch (error) {
        console.error('Error al obtener dimensiones de parcelas:', error);
        res.status(500).send('Error al obtener las dimensiones de las parcelas');
    }
});

module.exports = router;
