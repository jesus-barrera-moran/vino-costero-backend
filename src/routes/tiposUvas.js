const express = require('express');
const router = express.Router();
const { connectWithConnector } = require('../database/connector');

// Ruta para registrar un nuevo tipo de uva
router.post('/', async (req, res) => {
    const { nombre, descripcion, ph, temperatura, humedad, tiempoCosecha, parcelas } = req.body;

    const pool = await connectWithConnector('vino_costero_negocio');
    const client = await pool.connect();

    try {
        // Iniciar la transacción
        await client.query('BEGIN');

        // Insertar el nuevo tipo de uva en la tabla tipos_uvas
        const result = await client.query(
            `INSERT INTO tipos_uvas (nombre_uva, descripcion_uva, requisito_ph_tierra, 
                                     requisito_condiciones_humedad, requisito_condiciones_temperatura, tiempo_cosecha, fecha_creacion)
             VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id_tipo_uva`,
            [nombre, descripcion, ph, humedad, temperatura, tiempoCosecha]
        );

        const idTipoUva = result.rows[0].id_tipo_uva;

        // Asignar el nuevo tipo de uva a las parcelas seleccionadas
        await Promise.all(parcelas.map(async (idParcela) => {
            // Verificar si la parcela tiene una siembra activa sin tipo de uva asignado (id_tipo_uva IS NULL)
            const siembraActivaResult = await client.query(
                `SELECT id_siembra 
                 FROM siembras 
                 WHERE id_parcela = $1 AND id_estado_siembra = 1 AND id_tipo_uva IS NULL`,
                [idParcela]
            );

            const siembraActiva = siembraActivaResult.rows[0];

            // Si la siembra activa existe y no tiene tipo de uva asignado, actualizarla con el nuevo tipo de uva
            if (siembraActiva) {
                await client.query(
                    `UPDATE siembras 
                     SET id_tipo_uva = $1 
                     WHERE id_siembra = $2`,
                    [idTipoUva, siembraActiva.id_siembra]
                );
            } else {
                // Si la parcela no cumple con las condiciones, devolver un error
                throw new Error(`La parcela ${idParcela} no tiene una siembra activa sin tipo de uva asignado.`);
            }
        }));

        // Si todo es exitoso, confirmamos la transacción
        await client.query('COMMIT');
        client.release();

        res.status(201).json({
            message: 'Tipo de uva registrado y asignado a las siembras correspondientes exitosamente.'
        });
    } catch (error) {
        // En caso de error, revertimos la transacción
        await client.query('ROLLBACK');
        client.release();
        console.error('Error al registrar el tipo de uva:', error.message);
        res.status(400).json({ error: 'Error al registrar el tipo de uva: ' + error.message });
    }
});

// Ruta para modificar un tipo de uva existente
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, ph, temperatura, humedad, tiempoCosecha, parcelas } = req.body;

    const pool = await connectWithConnector('vino_costero_negocio');
    const client = await pool.connect();
    try {
        // Iniciar la transacción
        await client.query('BEGIN');

        // Actualizar el tipo de uva
        await client.query(
            `UPDATE tipos_uvas 
             SET nombre_uva = $1, descripcion_uva = $2, requisito_ph_tierra = $3, 
                 requisito_condiciones_humedad = $4, requisito_condiciones_temperatura = $5, tiempo_cosecha = $6
             WHERE id_tipo_uva = $7`,
            [nombre, descripcion, ph, humedad, temperatura, tiempoCosecha, id]
        );

        // Confirmar la transacción
        await client.query('COMMIT');
        client.release();

        res.status(200).json({
            message: 'Tipo de uva actualizado exitosamente.'
        });
    } catch (error) {
        // Revertir la transacción en caso de error
        await client.query('ROLLBACK');
        client.release();
        console.error('Error al actualizar el tipo de uva:', error.message);
        res.status(400).json({ error: 'Error al actualizar el tipo de uva: ' + error.message });
    }
});

// Ruta para obtener un tipo de uva por ID
router.get('/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Obtener los detalles del tipo de uva por ID
        const uvaResult = await client.query(
            `SELECT id_tipo_uva, nombre_uva, descripcion_uva, requisito_ph_tierra AS requisito_ph, 
                    requisito_condiciones_humedad AS requisito_humedad, 
                    requisito_condiciones_temperatura AS requisito_temperatura, tiempo_cosecha
             FROM tipos_uvas 
             WHERE id_tipo_uva = $1`,
            [id]
        );

        if (uvaResult.rows.length === 0) {
            return res.status(404).send('Tipo de uva no encontrado');
        }

        const tipoUva = uvaResult.rows[0];

        // Obtener las parcelas donde está plantada esta uva
        const parcelasResult = await client.query(
            `SELECT p.nombre_parcela 
             FROM siembras s
             JOIN parcelas p ON s.id_parcela = p.id_parcela
             WHERE s.id_tipo_uva = $1`,
            [id]
        );

        const parcelas = parcelasResult.rows.map(parcela => parcela.nombre_parcela);

        client.release();

        // Enviar la respuesta con los detalles del tipo de uva y las parcelas asociadas
        res.status(200).json({
            id: tipoUva.id_tipo_uva,
            nombre: tipoUva.nombre_uva,
            descripcion: tipoUva.descripcion_uva,
            requisito_ph: tipoUva.requisito_ph,
            requisito_temperatura: tipoUva.requisito_temperatura,
            requisito_humedad: tipoUva.requisito_humedad,
            tiempo_cosecha: tipoUva.tiempo_cosecha,
            parcelas: parcelas
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
