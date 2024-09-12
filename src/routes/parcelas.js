const express = require('express');
const router = express.Router();
const { connectWithConnector } = require('../database/connector');
const { verificarToken, verificarRol } = require('../middlewares/authMiddleware');

// Ruta para crear una nueva parcela
router.post('/', async (req, res) => {
    const { nombre_parcela, ubicacion_geografica, id_estado_parcela, superficie, longitud, anchura, pendiente, ph_tierra, condiciones_humedad, condiciones_temperatura, observaciones } = req.body;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Iniciar transacción
        await client.query('BEGIN');

        // Crear la parcela
        const parcelaResult = await client.query(
            `INSERT INTO parcelas (nombre_parcela, ubicacion_geografica, id_estado_parcela, fecha_creacion) 
             VALUES ($1, $2, $3, NOW()) RETURNING id_parcela`,
            [nombre_parcela, ubicacion_geografica, id_estado_parcela]
        );
        const id_parcela = parcelaResult.rows[0].id_parcela;

        // Crear las dimensiones de la parcela
        await client.query(
            `INSERT INTO dimensiones_parcelas (id_parcela, superficie, longitud, anchura, pendiente, fecha_creacion) 
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [id_parcela, superficie, longitud, anchura, pendiente]
        );

        // Crear el primer control de tierra
        await client.query(
            `INSERT INTO controles_tierra (id_parcela, ph_tierra, condiciones_humedad, condiciones_temperatura, observaciones, fecha_creacion) 
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [id_parcela, ph_tierra, condiciones_humedad, condiciones_temperatura, observaciones]
        );

        // Confirmar la transacción
        await client.query('COMMIT');
        client.release();

        res.status(201).send('Parcela creada exitosamente');
    } catch (error) {
        console.error('Error al crear la parcela:', error);
        await client.query('ROLLBACK');
        res.status(500).send('Error al crear la parcela');
    }
});

// Ruta para modificar una parcela existente
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre_parcela, ubicacion_geografica, id_estado_parcela } = req.body;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Actualizar los datos de la parcela
        await client.query(
            `UPDATE parcelas 
             SET nombre_parcela = $1, ubicacion_geografica = $2, id_estado_parcela = $3 
             WHERE id_parcela = $4`,
            [nombre_parcela, ubicacion_geografica, id_estado_parcela, id]
        );

        client.release();
        res.status(200).send('Parcela actualizada exitosamente');
    } catch (error) {
        console.error('Error al modificar la parcela:', error);
        res.status(500).send('Error al modificar la parcela');
    }
});

// Ruta para ver los detalles de una parcela
router.get('/:id', verificarToken, verificarRol([1,4]), async (req, res) => {
    const { id } = req.params;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Obtener los detalles de la parcela y sus dimensiones
        const parcelaResult = await client.query(
            `SELECT p.nombre_parcela, p.ubicacion_geografica, ep.nombre_estado, 
                    dp.superficie, dp.longitud, dp.anchura, dp.pendiente 
             FROM parcelas p
             LEFT JOIN estados_parcelas ep ON p.id_estado_parcela = ep.id_estado_parcela
             LEFT JOIN dimensiones_parcelas dp ON p.id_parcela = dp.id_parcela
             WHERE p.id_parcela = $1`,
            [id]
        );

        if (parcelaResult.rows.length === 0) {
            return res.status(404).send('Parcela no encontrada');
        }

        const dimensionesResult = await client.query(
            `SELECT superficie
             FROM dimensiones_parcelas 
             WHERE id_parcela = $1`,
            [id]
        );

        // Obtener las siembras asociadas y el tipo de uva plantada
        const siembrasResult = await client.query(
            `SELECT s.cantidad_plantas, tu.nombre_uva 
             FROM siembras s
             JOIN tipos_uvas tu ON s.id_tipo_uva = tu.id_tipo_uva
             WHERE s.id_parcela = $1`,
            [id]
        );

        // Obtener el último control de tierra
        const controlResult = await client.query(
            `SELECT fecha_creacion, ph_tierra, condiciones_humedad, condiciones_temperatura, observaciones
             FROM controles_tierra 
             WHERE id_parcela = $1
             ORDER BY fecha_creacion DESC LIMIT 1`,
            [id]
        );

        // Calcular el porcentaje plantado de la parcela
        const cantidadPlantasTotal = siembrasResult.rows.reduce((sum, siembra) => sum + siembra.cantidad_plantas, 0);
        const superficieParcela = dimensionesResult.rows[0]?.superficie || 0;
        const porcentajePlantado = (cantidadPlantasTotal / superficieParcela) * 100;

        client.release();

        res.status(200).json({
            parcela: dimensionesResult.rows[0],
            siembras: siembrasResult.rows,
            ultimo_control: controlResult.rows[0],
            porcentaje_plantado: `${porcentajePlantado.toFixed(2)}%`
        });
    } catch (error) {
        console.error('Error al obtener los detalles de la parcela:', error);
        res.status(500).send('Error al obtener los detalles de la parcela');
    }
});

// Ruta para obtener todas las parcelas
router.get('/', async (req, res) => {
    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Obtener todas las parcelas con sus dimensiones
        const parcelasResult = await client.query(
            `SELECT p.id_parcela, p.nombre_parcela, p.ubicacion_geografica, ep.nombre_estado, 
                    dp.superficie, dp.longitud, dp.anchura, dp.pendiente
             FROM parcelas p
             LEFT JOIN estados_parcelas ep ON p.id_estado_parcela = ep.id_estado_parcela
             LEFT JOIN dimensiones_parcelas dp ON p.id_parcela = dp.id_parcela`
        );

        const parcelas = parcelasResult.rows;

        // Recorrer cada parcela para obtener la información adicional
        const parcelasDetalles = await Promise.all(parcelas.map(async (parcela) => {
            // Obtener las siembras asociadas y el tipo de uva plantada
            const siembrasResult = await client.query(
                `SELECT s.cantidad_plantas, tu.nombre_uva 
                 FROM siembras s
                 JOIN tipos_uvas tu ON s.id_tipo_uva = tu.id_tipo_uva
                 WHERE s.id_parcela = $1`,
                [parcela.id_parcela]
            );

            // Obtener el último control de tierra
            const controlResult = await client.query(
                `SELECT fecha_creacion, ph_tierra, condiciones_humedad, condiciones_temperatura 
                 FROM controles_tierra 
                 WHERE id_parcela = $1
                 ORDER BY fecha_creacion DESC LIMIT 1`,
                [parcela.id_parcela]
            );

            // Calcular el porcentaje plantado de la parcela
            const cantidadPlantasTotal = siembrasResult.rows.reduce((sum, siembra) => sum + siembra.cantidad_plantas, 0);
            const superficieParcela = parcela.superficie || 0;
            const porcentajePlantado = (cantidadPlantasTotal / superficieParcela) * 100;

            return {
                parcela,
                siembras: siembrasResult.rows,
                ultimo_control: controlResult.rows[0] || 'No se encontraron controles de tierra',
                porcentaje_plantado: `${porcentajePlantado.toFixed(2)}%`
            };
        }));

        client.release();

        res.status(200).json(parcelasDetalles);
    } catch (error) {
        console.error('Error al obtener todas las parcelas:', error);
        res.status(500).send('Error al obtener las parcelas');
    }
});

module.exports = router;
