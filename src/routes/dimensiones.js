const express = require('express');
const router = express.Router();
const { connectWithConnector } = require('../database/connector');
const { verificarToken, verificarRol } = require('../middlewares/authMiddleware');

// Ruta para registrar dimensiones para una parcela
router.post('/:id_parcela', verificarToken, verificarRol([1, 3]), async (req, res) => {
    const { id_parcela } = req.params;
    const { superficie, longitud, anchura, pendiente } = req.body;

    try {
        // Validación de dimensiones
        if (
            !superficie || !longitud || !anchura || !pendiente || 
            superficie <= 0 || longitud <= 0 || anchura <= 0 || 
            pendiente < 0 || pendiente > 100
        ) {
            return res.status(400).send({ message: 'Error al actualizar las dimensiones' });
        }

        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Verificar si la parcela tiene siembras activas
        const siembrasActivas = await client.query(
            `SELECT COUNT(*) 
             FROM siembras 
             WHERE id_parcela = $1 AND id_estado_siembra = 1`, // Siembra activa
            [id_parcela]
        );

        if (parseInt(siembrasActivas.rows[0].count) > 0) {
            client.release();
            return res.status(400).send({ message: 'Error al actualizar las dimensiones' });
        }

        // Insertar las nuevas dimensiones
        await client.query(
            `INSERT INTO dimensiones_parcelas (id_parcela, superficie, longitud, anchura, pendiente, fecha_creacion) 
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [id_parcela, superficie, longitud, anchura, pendiente]
        );

        client.release();
        res.status(201).send({ 
            id_parcela,
            superficie,
            longitud,
            anchura,
            pendiente
        });
    } catch (error) {
        console.error('Error al registrar dimensiones:', error);
        res.status(500).send({ message: 'Error al actualizar las dimensiones' });
    }
});

// Obtener dimensiones actuales e historial de cada parcela
router.get('/', verificarToken, verificarRol([1, 3, 5]), async (req, res) => {
    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Obtener las dimensiones actuales (la más reciente por cada parcela)
        const parcelasResult = await client.query(
            `SELECT DISTINCT ON (p.id_parcela) p.id_parcela, p.nombre_parcela, 
                    dp.superficie, dp.longitud, dp.anchura, dp.pendiente, dp.fecha_creacion
             FROM parcelas p
             JOIN dimensiones_parcelas dp ON p.id_parcela = dp.id_parcela
             ORDER BY p.id_parcela, dp.fecha_creacion DESC`
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

// Ruta para actualizar (crear un nuevo registro) las dimensiones de una parcela
router.put('/:id_parcela', verificarToken, verificarRol([1, 3]), async (req, res) => {
    const { id_parcela } = req.params;
    const { superficie, longitud, anchura, pendiente } = req.body;

    try {
        // Validación de los valores de las dimensiones
        if (
            !superficie || !longitud || !anchura || !pendiente ||
            superficie <= 0 || longitud <= 0 || anchura <= 0 || 
            pendiente < 0 || pendiente > 100
        ) {
            return res.status(400).send({ message: 'Error al actualizar las dimensiones' });
        }

        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Verificar si la parcela tiene siembras activas
        const siembrasActivas = await client.query(
            `SELECT COUNT(*) 
             FROM siembras 
             WHERE id_parcela = $1 AND id_estado_siembra = 1`, // Siembra activa
            [id_parcela]
        );

        if (parseInt(siembrasActivas.rows[0].count) > 0) {
            client.release();
            return res.status(400).send({ message: 'Error al actualizar las dimensiones' });
        }

        // Insertar el nuevo registro de dimensiones
        const insertDimensionQuery = `
            INSERT INTO dimensiones_parcelas (id_parcela, superficie, longitud, anchura, pendiente, fecha_creacion) 
            VALUES ($1, $2, $3, $4, $5, NOW())
            RETURNING id_dimension_parcela, fecha_creacion;
        `;
        const result = await client.query(insertDimensionQuery, [id_parcela, superficie, longitud, anchura, pendiente]);

        client.release();

        // Responder con los detalles de la nueva dimensión creada
        res.status(201).json({
            id_parcela,
            superficie,
            longitud,
            anchura,
            pendiente,
            fecha_creacion: result.rows[0].fecha_creacion,
        });
    } catch (error) {
        console.error('Error al registrar las nuevas dimensiones:', error);
        res.status(500).send({ message: 'Error al actualizar las dimensiones' });
    }
});

module.exports = router;
