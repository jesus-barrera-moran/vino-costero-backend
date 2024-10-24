const express = require('express');
const router = express.Router();
const { connectWithConnector } = require('../database/connector');
const { verificarToken, verificarRol } = require('../middlewares/authMiddleware');

// Ruta para registrar una nueva siembra en una parcela
router.post('/', verificarToken, verificarRol([1, 2, 3, 4]), async (req, res) => {
    const { id_parcela, id_tipo_uva, fecha_plantacion, cantidad_plantas, tecnica_siembra, observaciones_siembra } = req.body;

    try {
        // Validación de los datos de entrada
        if (
            !id_parcela || !id_tipo_uva || !fecha_plantacion || !cantidad_plantas || !tecnica_siembra || 
            cantidad_plantas <= 0
        ) {
            return res.status(400).json({ message: 'Error al registrar la siembra' });
        }

        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Verificar que la parcela tenga dimensiones asociadas
        const dimensionesResult = await client.query(
            `SELECT COUNT(*) AS total 
             FROM dimensiones_parcelas 
             WHERE id_parcela = $1`,
            [id_parcela]
        );

        if (dimensionesResult.rows[0].total == 0) {
            client.release();
            return res.status(400).json({ message: 'Error al registrar la siembra' });
        }

        // Verificar que no haya siembras activas en la parcela
        const siembrasActivasResult = await client.query(
            `SELECT COUNT(*) AS total 
             FROM siembras 
             WHERE id_parcela = $1 AND id_estado_siembra = 1`, // Siembra activa
            [id_parcela]
        );

        if (siembrasActivasResult.rows[0].total > 0) {
            client.release();
            return res.status(400).json({ message: 'Error al registrar la siembra' });
        }

        // Verificar que haya controles de tierra en la parcela
        const controlesTierraResult = await client.query(
            `SELECT COUNT(*) AS total 
             FROM controles_tierra 
             WHERE id_parcela = $1`,
            [id_parcela]
        );

        if (controlesTierraResult.rows[0].total == 0) {
            client.release();
            return res.status(400).json({ message: 'Error al registrar la siembra' });
        }

        // Registrar la nueva siembra
        await client.query(
            `INSERT INTO siembras (id_parcela, id_tipo_uva, fecha_plantacion, cantidad_plantas, tecnica_siembra, observaciones_siembra, id_estado_siembra, fecha_creacion) 
             VALUES ($1, $2, $3, $4, $5, $6, 1, NOW())`,
            [id_parcela, id_tipo_uva, fecha_plantacion, cantidad_plantas, tecnica_siembra, observaciones_siembra]
        );

        client.release();

        res.status(201).json({
            mensaje: 'Siembra registrada exitosamente'
        });
    } catch (error) {
        console.error('Error al registrar la siembra:', error);
        res.status(500).json({ message: 'Error al registrar la siembra' });
    }
});

// Ruta para modificar una siembra existente
router.put('/:id', verificarToken, verificarRol([1, 2, 3, 4]), async (req, res) => {
    const { id } = req.params;
    const { fecha_plantacion, cantidad_plantas, tecnica_siembra, observaciones_siembra } = req.body;

    try {
        // Validación de los datos de entrada
        if (
            !fecha_plantacion || !cantidad_plantas || !tecnica_siembra || 
            cantidad_plantas <= 0
        ) {
            return res.status(400).json({ message: 'Error al modificar los datos de siembra' });
        }

        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Actualizar los datos de la siembra
        await client.query(
            `UPDATE siembras 
             SET cantidad_plantas = $1, tecnica_siembra = $2, observaciones_siembra = $3, fecha_plantacion = $4 
             WHERE id_siembra = $5`,
            [cantidad_plantas, tecnica_siembra, observaciones_siembra, fecha_plantacion, id]
        );

        client.release();
        res.status(200).json({ message: 'Datos de siembra actualizados exitosamente' });
    } catch (error) {
        console.error('Error al modificar los datos de siembra:', error);
        res.status(500).json({ message: 'Error al modificar los datos de siembra' });
    }
});

// Ruta para obtener la última siembra activa por ID de parcela
router.get('/:id_parcela', verificarToken, verificarRol([1, 2, 3, 4, 5]), async (req, res) => {
    const { id_parcela } = req.params;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Consultar la última siembra activa por ID de parcela
        const siembraResult = await client.query(
            `SELECT s.id_siembra, s.id_parcela, tu.nombre_uva, es.nombre_estado AS estado, 
                    s.fecha_plantacion, s.cantidad_plantas, s.tecnica_siembra, s.observaciones_siembra
             FROM siembras s
             JOIN estados_siembras es ON s.id_estado_siembra = es.id_estado_siembra
             LEFT JOIN tipos_uvas tu ON s.id_tipo_uva = tu.id_tipo_uva
             WHERE s.id_parcela = $1
               AND es.nombre_estado = 'Activo' -- Filtrar solo las siembras con estado activo
             ORDER BY s.fecha_creacion DESC
             LIMIT 1`, // Selecciona la siembra más reciente (última siembra activa)
            [id_parcela]
        );

        // Si no se encuentra ninguna siembra activa, devolver un error
        if (siembraResult.rows.length === 0) {
            return res.status(404).json({ error: 'No se encontró ninguna siembra activa para esta parcela' });
        }

        // Obtener el resultado de la consulta
        const siembra = siembraResult.rows[0];

        // Estructura de la respuesta
        const siembraData = {
            id: siembra.id_siembra,
            id_parcela: siembra.id_parcela,
            tipo_uva: siembra.nombre_uva || 'Sin asignar',
            estado: siembra.estado,
            fecha_plantacion: siembra.fecha_plantacion,
            cantidad_plantas: siembra.cantidad_plantas,
            tecnica_siembra: siembra.tecnica_siembra,
            observaciones_siembra: siembra.observaciones_siembra || 'Sin observaciones',
        };

        client.release();

        // Enviar la siembra como respuesta
        res.status(200).json(siembraData);
    } catch (error) {
        console.error('Error al obtener la última siembra activa por ID de parcela:', error);
        res.status(500).json({ error: 'Error al obtener la siembra' });
    }
});

// Obtener solo parcelas con siembras actuales o historial de siembras
router.get('/', verificarToken, verificarRol([1, 2, 3, 4, 5]), async (req, res) => {
    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Obtener solo parcelas que tengan siembras registradas
        const parcelasResult = await client.query(
            `SELECT DISTINCT p.id_parcela, p.nombre_parcela
             FROM parcelas p
             JOIN siembras s ON p.id_parcela = s.id_parcela`
        );
        const parcelas = parcelasResult.rows;

        // Para cada parcela, obtener la siembra actual y el historial de siembras
        const parcelasDetalles = await Promise.all(parcelas.map(async (parcela) => {
            // Obtener la siembra actual (la más reciente) de la parcela
            const siembraActualResult = await client.query(
                `SELECT tu.nombre_uva, s.fecha_creacion, s.cantidad_plantas, s.tecnica_siembra, s.observaciones_siembra
                 FROM siembras s
                 LEFT JOIN tipos_uvas tu ON s.id_tipo_uva = tu.id_tipo_uva
                 WHERE s.id_parcela = $1
                 ORDER BY s.fecha_creacion DESC LIMIT 1`,
                [parcela.id_parcela]
            );
            const siembraActual = siembraActualResult.rows[0] || null;

            // Obtener el historial completo de siembras de la parcela
            const historialSiembrasResult = await client.query(
                `SELECT tu.nombre_uva, s.fecha_creacion, s.cantidad_plantas, s.tecnica_siembra, s.observaciones_siembra
                 FROM siembras s
                 LEFT JOIN tipos_uvas tu ON s.id_tipo_uva = tu.id_tipo_uva
                 WHERE s.id_parcela = $1
                 ORDER BY s.fecha_creacion DESC`,
                [parcela.id_parcela]
            );
            const historialSiembras = historialSiembrasResult.rows;

            return {
                id: parcela.id_parcela,
                nombre: parcela.nombre_parcela,
                siembraActual: siembraActual
                    ? {
                        tipoUva: siembraActual.nombre_uva,
                        fechaCreacion: siembraActual.fecha_creacion,
                        cantidadPlantas: siembraActual.cantidad_plantas,
                        tecnica: siembraActual.tecnica_siembra,
                        observaciones: siembraActual.observaciones_siembra,
                    }
                    : null,
                historialSiembras: historialSiembras.map((siembra) => ({
                    tipoUva: siembra.nombre_uva,
                    fechaCreacion: siembra.fecha_creacion,
                    cantidadPlantas: siembra.cantidad_plantas,
                    tecnica: siembra.tecnica_siembra,
                    observaciones: siembra.observaciones_siembra,
                })),
            };
        }));

        client.release();

        res.status(200).json(parcelasDetalles);
    } catch (error) {
        console.error('Error al obtener las siembras:', error);
        res.status(500).send('Error al obtener las siembras');
    }
});

module.exports = router;
