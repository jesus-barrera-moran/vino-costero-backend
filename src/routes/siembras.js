const express = require('express');
const router = express.Router();
const { connectWithConnector } = require('../database/connector');

// Ruta para registrar una nueva siembra en una parcela
router.post('/', async (req, res) => {
    const { id_parcela, id_tipo_uva, cantidad_plantas, tecnica_siembra, observaciones_siembra } = req.body;

    try {
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
            return res.status(400).send('No se puede registrar la siembra. La parcela no tiene dimensiones asociadas.');
        }

        // Verificar que no haya siembras activas en la parcela
        const siembrasActivasResult = await client.query(
            `SELECT COUNT(*) AS total 
             FROM siembras 
             WHERE id_parcela = $1 AND id_estado_siembra = 1`, // Siembra activa
            [id_parcela]
        );

        if (siembrasActivasResult.rows[0].total > 0) {
            return res.status(400).send('No se puede registrar la siembra. La parcela ya tiene siembras activas.');
        }

        // Verificar que haya controles de tierra en la parcela
        const controlesTierraResult = await client.query(
            `SELECT COUNT(*) AS total 
                FROM controles_tierra 
                WHERE id_parcela = $1`,
            [id_parcela]
        );

        if (controlesTierraResult.rows[0].total > 0) {
            return res.status(400).send('No se puede registrar la siembra. La parcela no tiene controles de tierra.');
        }

        // Registrar la nueva siembra
        await client.query(
            `INSERT INTO siembras (id_parcela, id_tipo_uva, cantidad_plantas, tecnica_siembra, observaciones_siembra, fecha_creacion) 
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [id_parcela, id_tipo_uva, cantidad_plantas, tecnica_siembra, observaciones_siembra]
        );

        client.release();

        res.status(201).json({
            mensaje: 'Siembra registrada exitosamente'
        });
    } catch (error) {
        console.error('Error al registrar la siembra:', error);
        res.status(500).send('Error al registrar la siembra');
    }
});

// Ruta para modificar una siembra existente
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { cantidad_plantas, tecnica_siembra, observaciones_siembra } = req.body;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Actualizar los datos de la siembra
        await client.query(
            `UPDATE siembras 
             SET cantidad_plantas = $1, tecnica_siembra = $2, observaciones_siembra = $3 
             WHERE id_siembra = $4`,
            [cantidad_plantas, tecnica_siembra, observaciones_siembra, id]
        );

        client.release();
        res.status(200).send('Datos de siembra actualizados exitosamente');
    } catch (error) {
        console.error('Error al modificar los datos de siembra:', error);
        res.status(500).send('Error al modificar los datos de siembra');
    }
});

// Ruta para ver los detalles de una siembra
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Obtener los detalles de la siembra
        const siembraResult = await client.query(
            `SELECT s.cantidad_plantas, s.tecnica_siembra, s.observaciones_siembra, tu.nombre_uva, 
                    p.nombre_parcela, p.ubicacion_geografica, dp.superficie, dp.longitud, dp.anchura, dp.pendiente
             FROM siembras s
             JOIN tipos_uvas tu ON s.id_tipo_uva = tu.id_tipo_uva
             JOIN parcelas p ON s.id_parcela = p.id_parcela
             LEFT JOIN dimensiones_parcelas dp ON p.id_parcela = dp.id_parcela
             WHERE s.id_siembra = $1`,
            [id]
        );

        if (siembraResult.rows.length === 0) {
            return res.status(404).send('Siembra no encontrada');
        }

        // Obtener el último control de tierra
        const controlResult = await client.query(
            `SELECT fecha_creacion, ph_tierra, condiciones_humedad, condiciones_temperatura 
             FROM controles_tierra 
             WHERE id_parcela = $1
             ORDER BY fecha_creacion DESC LIMIT 1`,
            [siembraResult.rows[0].id_parcela]
        );

        client.release();

        res.status(200).json({
            siembra: siembraResult.rows[0],
            ultimo_control: controlResult.rows[0] || 'No se encontraron controles de tierra'
        });
    } catch (error) {
        console.error('Error al obtener los detalles de la siembra:', error);
        res.status(500).send('Error al obtener los detalles de la siembra');
    }
});

// Obtener siembras actuales e historial de cada parcela
router.get('/', async (req, res) => {
    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Obtener todas las parcelas
        const parcelasResult = await client.query(
            `SELECT p.id_parcela, p.nombre_parcela
             FROM parcelas p`
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
                    : 'No hay siembra actual',
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
