const express = require('express');
const router = express.Router();
const { connectWithConnector } = require('../database/connector');
const { verificarToken, verificarRol } = require('../middlewares/authMiddleware');

// Ruta para crear una nueva parcela
router.post('/', verificarToken, verificarRol([1, 3]), async (req, res) => {
    const { 
        nombre_parcela, 
        ubicacion_descripcion, 
        ubicacion_longitud, 
        ubicacion_latitud, 
        id_estado_parcela, 
        dimensiones, 
        control_tierra 
    } = req.body;

    try {
        // Validación de campos requeridos
        if (!nombre_parcela || !ubicacion_descripcion || !ubicacion_longitud || !ubicacion_latitud || !id_estado_parcela) {
            return res.status(400).send({ message: 'Hubo un error al procesar la solicitud' });
        }

        // Validación de rango de longitud y latitud
        const longitud = parseFloat(ubicacion_longitud);
        const latitud = parseFloat(ubicacion_latitud);
        if (isNaN(longitud) || longitud < -180 || longitud > 180) {
            return res.status(400).send({ message: 'Hubo un error al procesar la solicitud' });
        }
        if (isNaN(latitud) || latitud < -90 || latitud > 90) {
            return res.status(400).send({ message: 'Hubo un error al procesar la solicitud' });
        }

        // Validación de dimensiones
        if (dimensiones) {
            const { superficie, longitud, anchura, pendiente } = dimensiones;

            if (superficie <= 0) {
                return res.status(400).send({ message: 'Hubo un error al procesar la solicitud' });
            }
            if (longitud <= 0) {
                return res.status(400).send({ message: 'Hubo un error al procesar la solicitud' });
            }
            if (anchura <= 0) {
                return res.status(400).send({ message: 'Hubo un error al procesar la solicitud' });
            }
            if (pendiente < 0 || pendiente > 100) {
                return res.status(400).send({ message: 'Hubo un error al procesar la solicitud' });
            }
        }

        // Validación de control de tierra
        if (control_tierra) {
            const { ph, humedad, temperatura } = control_tierra;

            if (ph < 0 || ph > 14) {
                return res.status(400).send({ message: 'Hubo un error al procesar la solicitud' });
            }
            if (humedad < 0 || humedad > 100) {
                return res.status(400).send({ message: 'Hubo un error al procesar la solicitud' });
            }
            if (temperatura < -50 || temperatura > 100) {
                return res.status(400).send({ message: 'Hubo un error al procesar la solicitud' });
            }
        }

        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Iniciar transacción
        await client.query('BEGIN');

        // Verificar si el nombre de la parcela ya existe
        const nombreParcelaResult = await client.query(
            `SELECT COUNT(*) FROM parcelas WHERE nombre_parcela = $1`,
            [nombre_parcela]
        );

        if (parseInt(nombreParcelaResult.rows[0].count) > 0) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(400).send({ message: 'Hubo un error al procesar la solicitud' });
        }

        // Crear la parcela
        const parcelaResult = await client.query(
            `INSERT INTO parcelas (nombre_parcela, ubicacion_descripcion, ubicacion_longitud, ubicacion_latitud, id_estado_parcela, fecha_creacion) 
             VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id_parcela`,
            [nombre_parcela, ubicacion_descripcion, ubicacion_longitud, ubicacion_latitud, id_estado_parcela]
        );
        const id_parcela = parcelaResult.rows[0].id_parcela;

        // Crear las dimensiones de la parcela
        await client.query(
            `INSERT INTO dimensiones_parcelas (id_parcela, superficie, longitud, anchura, pendiente, fecha_creacion) 
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [id_parcela, dimensiones.superficie, dimensiones.longitud, dimensiones.anchura, dimensiones.pendiente]
        );

        // Crear el primer control de tierra
        await client.query(
            `INSERT INTO controles_tierra (id_parcela, ph_tierra, condiciones_humedad, condiciones_temperatura, observaciones, fecha_creacion) 
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [id_parcela, control_tierra.ph, control_tierra.humedad, control_tierra.temperatura, control_tierra.observaciones]
        );

        // Confirmar la transacción
        await client.query('COMMIT');
        client.release();

        res.status(201).send({ message: 'Parcela creada exitosamente' });
    } catch (error) {
        console.error('Error al crear la parcela:', error);
        
        // Rollback en caso de error
        if (client) {
            await client.query('ROLLBACK');
            client.release();
        }

        res.status(500).send({ message: 'Hubo un error al procesar la solicitud' });
    }
});

// Ruta para modificar una parcela existente
router.put('/:id', verificarToken, verificarRol([1, 3]), async (req, res) => {
    const { id } = req.params;
    const { nombre_parcela, ubicacion_descripcion, ubicacion_longitud, ubicacion_latitud, id_estado_parcela, dimensiones } = req.body;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Iniciar la transacción
        await client.query('BEGIN');

        // Actualizar los datos de la parcela
        await client.query(
            `UPDATE parcelas 
             SET nombre_parcela = $1, ubicacion_descripcion = $2, ubicacion_longitud = $3, ubicacion_latitud = $4, id_estado_parcela = $5
             WHERE id_parcela = $6`,
            [nombre_parcela, ubicacion_descripcion, ubicacion_longitud, ubicacion_latitud, id_estado_parcela, id]
        );

        // Obtener las dimensiones actuales de la parcela
        const dimensionesActualesResult = await client.query(
            `SELECT superficie, longitud, anchura, pendiente
             FROM dimensiones_parcelas
             WHERE id_parcela = $1
             ORDER BY fecha_creacion DESC
             LIMIT 1`,
            [id]
        );

        const dimensionesActuales = dimensionesActualesResult.rows[0];

        // Comparar las dimensiones actuales con las nuevas dimensiones
        const dimensionesHanCambiado = 
            dimensionesActuales.superficie !== dimensiones.superficie ||
            dimensionesActuales.longitud !== dimensiones.longitud ||
            dimensionesActuales.anchura !== dimensiones.anchura ||
            dimensionesActuales.pendiente !== dimensiones.pendiente;

        if (dimensionesHanCambiado) {
            // Insertar las nuevas dimensiones si han cambiado
            await client.query(
                `INSERT INTO dimensiones_parcelas (id_parcela, superficie, longitud, anchura, pendiente, fecha_creacion)
                 VALUES ($1, $2, $3, $4, $5, NOW()::timestamp(0))`,
                [id, dimensiones.superficie, dimensiones.longitud, dimensiones.anchura, dimensiones.pendiente]
            );
        }

        // Confirmar la transacción
        await client.query('COMMIT');
        client.release();

        res.status(200).send('Parcela y dimensiones actualizadas exitosamente');
    } catch (error) {
        console.error('Error al modificar la parcela y las dimensiones:', error);
        await client.query('ROLLBACK'); // En caso de error, hacer rollback
        res.status(500).send('Error al modificar la parcela y las dimensiones');
    }
});

// Obtener los detalles de una parcela por ID
router.get('/:id', verificarToken, verificarRol([1, 3, 5]), async (req, res) => {
    const { id } = req.params;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Obtener la parcela por ID
        const parcelaResult = await client.query(
            `SELECT p.id_parcela, p.nombre_parcela, p.ubicacion_descripcion, p.ubicacion_latitud, p.ubicacion_longitud, ep.nombre_estado,
                    dp.superficie, dp.longitud, dp.anchura, dp.pendiente
             FROM parcelas p
             LEFT JOIN estados_parcelas ep ON p.id_estado_parcela = ep.id_estado_parcela
             LEFT JOIN dimensiones_parcelas dp ON p.id_parcela = dp.id_parcela
             WHERE p.id_parcela = $1
             ORDER BY dp.fecha_creacion DESC LIMIT 1`,
            [id]
        );

        const parcela = parcelaResult.rows[0];

        if (!parcela) {
            return res.status(404).json({ error: 'Parcela no encontrada' });
        }

        // Obtener la siembra activa (si existe)
        const siembraResult = await client.query(
            `SELECT s.cantidad_plantas, tu.nombre_uva, s.tecnica_siembra, s.observaciones_siembra, es.nombre_estado AS estado_siembra
             FROM siembras s
             LEFT JOIN tipos_uvas tu ON s.id_tipo_uva = tu.id_tipo_uva
             LEFT JOIN estados_siembras es ON s.id_estado_siembra = es.id_estado_siembra
             WHERE s.id_parcela = $1
             ORDER BY s.fecha_creacion DESC LIMIT 1`,
            [id]
        );

        const siembraActiva = siembraResult.rows[0] || null;

        client.release();

        res.status(200).json({
            id: parcela.id_parcela,
            nombre: parcela.nombre_parcela,
            longitud: parcela.ubicacion_longitud,
            latitud: parcela.ubicacion_latitud,
            ubicacion: parcela.ubicacion_descripcion,
            estado: parcela.nombre_estado,
            dimensiones: {
                superficie: parcela.superficie,
                longitud: parcela.longitud,
                anchura: parcela.anchura,
                pendiente: parcela.pendiente,
            },
            siembra_activa: siembraActiva
                ? {
                    tipoUva: siembraActiva.nombre_uva,
                    cantidadPlantas: siembraActiva.cantidad_plantas,
                    tecnica: siembraActiva.tecnica_siembra,
                    observaciones: siembraActiva.observaciones_siembra,
                    estado: siembraActiva.estado_siembra,
                }
                : null,
        });
    } catch (error) {
        console.error('Error al obtener la parcela por ID:', error);
        res.status(500).send('Error al obtener los detalles de la parcela');
    }
});

// Obtener todas las parcelas con sus detalles
router.get('/', verificarToken, verificarRol([1, 3, 5]), async (req, res) => {
    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Obtener todas las parcelas con estado y dimensiones (seleccionando solo las más recientes)
        const parcelasResult = await client.query(
            `SELECT p.id_parcela, p.nombre_parcela, p.ubicacion_descripcion, p.ubicacion_latitud, p.ubicacion_longitud, ep.nombre_estado, 
                    dp.superficie, dp.longitud, dp.anchura, dp.pendiente
             FROM parcelas p
             LEFT JOIN estados_parcelas ep ON p.id_estado_parcela = ep.id_estado_parcela
             LEFT JOIN (
               SELECT DISTINCT ON (id_parcela) id_parcela, superficie, longitud, anchura, pendiente
               FROM dimensiones_parcelas
               ORDER BY id_parcela, fecha_creacion DESC  -- Selecciona la dimensión más reciente por parcela
             ) dp ON p.id_parcela = dp.id_parcela`
        );

        const parcelas = parcelasResult.rows;

        // Para cada parcela, obtener siembras y control de tierra
        const parcelasDetalles = await Promise.all(parcelas.map(async (parcela) => {
            // Obtener la siembra activa, si existe
            const siembrasResult = await client.query(
                `SELECT s.cantidad_plantas, s.tecnica_siembra, s.observaciones_siembra, es.nombre_estado AS estado_siembra, 
                        tu.nombre_uva, s.fecha_plantacion
                 FROM siembras s
                 LEFT JOIN tipos_uvas tu ON s.id_tipo_uva = tu.id_tipo_uva
                 LEFT JOIN estados_siembras es ON s.id_estado_siembra = es.id_estado_siembra
                 WHERE s.id_parcela = $1 AND s.id_estado_siembra = 1
                 ORDER BY s.fecha_creacion DESC LIMIT 1`,
                [parcela.id_parcela]
            );

            const siembraActiva = siembrasResult.rows[0] || null;

            // Obtener el último control de tierra, si existe
            const controlResult = await client.query(
                `SELECT ph_tierra, condiciones_humedad, condiciones_temperatura, observaciones, fecha_creacion
                 FROM controles_tierra
                 WHERE id_parcela = $1
                 ORDER BY fecha_creacion DESC LIMIT 1`,
                [parcela.id_parcela]
            );

            const controlTierra = controlResult.rows[0] || null;

            return {
                id: parcela.id_parcela,
                nombre: parcela.nombre_parcela,
                longitud: parcela.ubicacion_longitud,
                latitud: parcela.ubicacion_latitud,
                ubicacion: parcela.ubicacion_descripcion,
                estado: parcela.nombre_estado,
                dimensiones: {
                    superficie: parcela.superficie,
                    longitud: parcela.longitud,
                    anchura: parcela.anchura,
                    pendiente: parcela.pendiente,
                },
                siembra_activa: siembraActiva
                    ? {
                        tipo_uva: siembraActiva.nombre_uva,
                        fecha_plantacion: siembraActiva.fecha_plantacion,
                        cantidad_plantas: siembraActiva.cantidad_plantas,
                        tecnica: siembraActiva.tecnica_siembra,
                        observaciones: siembraActiva.observaciones_siembra,
                        estado: siembraActiva.estado_siembra,
                    }
                    : null,
                control_tierra: controlTierra
                    ? {
                        ph: controlTierra.ph_tierra,
                        humedad: controlTierra.condiciones_humedad,
                        temperatura: controlTierra.condiciones_temperatura,
                        observaciones: controlTierra.observaciones,
                    }
                    : null,
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
