const express = require('express');
const router = express.Router();
const { connectWithConnector } = require('../database/connector');

// Ruta para registrar un nuevo tipo de uva
router.post('/', async (req, res) => {
    const { nombre_uva, descripcion_uva, requisito_ph_tierra, requisito_condiciones_humedad, requisito_condiciones_temperatura, tiempo_cosecha, parcelas } = req.body;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Iniciar una transacción
        await client.query('BEGIN');

        // Registrar el nuevo tipo de uva
        const uvaResult = await client.query(
            `INSERT INTO tipos_uvas (nombre_uva, descripcion_uva, requisito_ph_tierra, requisito_condiciones_humedad, requisito_condiciones_temperatura, tiempo_cosecha, fecha_creacion) 
             VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id_tipo_uva`,
            [nombre_uva, descripcion_uva, requisito_ph_tierra, requisito_condiciones_humedad, requisito_condiciones_temperatura, tiempo_cosecha]
        );

        const id_tipo_uva = uvaResult.rows[0].id_tipo_uva;

        // Si se especifican parcelas, asignar el tipo de uva a las siembras activas de cada parcela
        if (parcelas && parcelas.length > 0) {
            for (const id_parcela of parcelas) {
                // Verificar si hay una siembra activa en la parcela (una siembra sin fecha de finalización o similar)
                const siembraActivaResult = await client.query(
                    `SELECT id_siembra 
                     FROM siembras 
                     WHERE id_parcela = $1 AND id_tipo_uva IS NULL AND id_estado_siembra = 1`, // Si la parcela no tiene un tipo de uva asignado aún
                    [id_parcela]
                );

                if (siembraActivaResult.rows.length > 0) {
                    const id_siembra = siembraActivaResult.rows[0].id_siembra;

                    // Asignar el nuevo tipo de uva a la siembra activa
                    await client.query(
                        `UPDATE siembras 
                         SET id_tipo_uva = $1 
                         WHERE id_siembra = $2`,
                        [id_tipo_uva, id_siembra]
                    );
                }
            }

            // Confirmar la transacción
            await client.query('COMMIT');

            res.status(201).json({
                mensaje: 'Tipo de uva registrado exitosamente y asignado a las siembras activas',
                id_tipo_uva
            });
        } else {
            // Confirmar la transacción si no hay parcelas
            await client.query('COMMIT');

            res.status(201).json({
                mensaje: 'Tipo de uva registrado exitosamente',
                id_tipo_uva
            });
        }

        client.release();
    } catch (error) {
        // Rollback en caso de error
        await client.query('ROLLBACK');
        console.error('Error al registrar el tipo de uva:', error);
        res.status(500).send('Error al registrar el tipo de uva');
    }
});

// Ruta para modificar un tipo de uva existente
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre_uva, descripcion_uva, requisito_ph_tierra, requisito_condiciones_humedad, requisito_condiciones_temperatura, tiempo_cosecha } = req.body;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Actualizar el tipo de uva
        await client.query(
            `UPDATE tipos_uvas 
             SET nombre_uva = $1, descripcion_uva = $2, requisito_ph_tierra = $3, requisito_condiciones_humedad = $4, requisito_condiciones_temperatura = $5, tiempo_cosecha = $6
             WHERE id_tipo_uva = $7`,
            [nombre_uva, descripcion_uva, requisito_ph_tierra, requisito_condiciones_humedad, requisito_condiciones_temperatura, tiempo_cosecha, id]
        );

        client.release();
        res.status(200).send('Tipo de uva actualizado exitosamente');
    } catch (error) {
        console.error('Error al modificar el tipo de uva:', error);
        res.status(500).send('Error al modificar el tipo de uva');
    }
});

// Ruta para ver los detalles de un tipo de uva
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Obtener los detalles del tipo de uva
        const uvaResult = await client.query(
            `SELECT nombre_uva, descripcion_uva, requisito_ph_tierra, requisito_condiciones_humedad, requisito_condiciones_temperatura, tiempo_cosecha 
             FROM tipos_uvas 
             WHERE id_tipo_uva = $1`,
            [id]
        );

        if (uvaResult.rows.length === 0) {
            return res.status(404).send('Tipo de uva no encontrado');
        }

        // Obtener las parcelas donde está plantada esta uva
        const parcelasResult = await client.query(
            `SELECT p.id_parcela, p.nombre_parcela, dp.superficie, dp.longitud, dp.anchura, dp.pendiente
             FROM siembras s
             JOIN parcelas p ON s.id_parcela = p.id_parcela
             LEFT JOIN dimensiones_parcelas dp ON p.id_parcela = dp.id_parcela
             WHERE s.id_tipo_uva = $1`,
            [id]
        );

        // Obtener los controles de tierra de cada parcela
        const controles = [];
        for (const parcela of parcelasResult.rows) {
            const controlResult = await client.query(
                `SELECT fecha_creacion, ph_tierra, condiciones_humedad, condiciones_temperatura 
                 FROM controles_tierra 
                 WHERE id_parcela = $1
                 ORDER BY fecha_creacion DESC LIMIT 1`,
                [parcela.id_parcela]
            );

            controles.push({
                parcela,
                ultimo_control: controlResult.rows[0] || 'No se encontraron controles de tierra'
            });
        }

        client.release();

        res.status(200).json({
            tipo_uva: uvaResult.rows[0],
            parcelas: controles
        });
    } catch (error) {
        console.error('Error al obtener el tipo de uva:', error);
        res.status(500).send('Error al obtener el tipo de uva');
    }
});

// Obtener tipos de uva y parcelas asociadas
router.get('/', async (req, res) => {
    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Obtener todos los tipos de uva
        const tiposUvaResult = await client.query(
            `SELECT tu.id_tipo_uva, tu.nombre_uva, tu.descripcion_uva, 
                    tu.requisito_ph_tierra, tu.requisito_condiciones_humedad, 
                    tu.requisito_condiciones_temperatura, tu.tiempo_cosecha
             FROM tipos_uvas tu`
        );
        const tiposUva = tiposUvaResult.rows;

        // Para cada tipo de uva, obtener las parcelas asociadas
        const tiposUvaDetalles = await Promise.all(tiposUva.map(async (uva) => {
            // Obtener las parcelas donde se ha sembrado este tipo de uva
            const parcelasResult = await client.query(
                `SELECT p.id_parcela, p.nombre_parcela, 
                        dp.superficie, dp.longitud, dp.anchura, dp.pendiente,
                        s.cantidad_plantas, s.tecnica_siembra, s.observaciones_siembra, 
                        ct.ph_tierra, ct.condiciones_humedad, ct.condiciones_temperatura, ct.observaciones AS observaciones_control
                 FROM parcelas p
                 JOIN siembras s ON p.id_parcela = s.id_parcela
                 LEFT JOIN dimensiones_parcelas dp ON p.id_parcela = dp.id_parcela
                 LEFT JOIN controles_tierra ct ON p.id_parcela = ct.id_parcela
                 WHERE s.id_tipo_uva = $1
                 ORDER BY ct.fecha_creacion DESC LIMIT 1`,
                [uva.id_tipo_uva]
            );

            const parcelas = parcelasResult.rows;

            return {
                id: uva.id_tipo_uva,
                nombre: uva.nombre_uva,
                descripcion: uva.descripcion_uva,
                ph_requerido: uva.requisito_ph_tierra,
                humedad_requerida: uva.requisito_condiciones_humedad,
                temperatura_requerida: uva.requisito_condiciones_temperatura,
                tiempoCosecha: uva.tiempo_cosecha,
                parcelas: parcelas.map((parcela) => ({
                    id: parcela.id_parcela,
                    nombre: parcela.nombre_parcela,
                    dimensiones: {
                        superficie: parcela.superficie,
                        longitud: parcela.longitud,
                        anchura: parcela.anchura,
                        pendiente: parcela.pendiente,
                    },
                    siembraActual: {
                        cantidad_plantas: parcela.cantidad_plantas,
                        tecnica_siembra: parcela.tecnica_siembra,
                        observaciones: parcela.observaciones_siembra,
                    },
                    controlTierra: {
                        ph: parcela.ph_tierra,
                        humedad: parcela.condiciones_humedad,
                        temperatura: parcela.condiciones_temperatura,
                        observaciones: parcela.observaciones_control,
                    },
                })),
            };
        }));

        client.release();

        res.status(200).json(tiposUvaDetalles);
    } catch (error) {
        console.error('Error al obtener los tipos de uva:', error);
        res.status(500).send('Error al obtener los tipos de uva');
    }
});

module.exports = router;
