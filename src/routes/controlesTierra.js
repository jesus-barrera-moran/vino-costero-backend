const express = require('express');
const router = express.Router();
const { connectWithConnector } = require('../database/connector');
const { verificarToken, verificarRol } = require('../middlewares/authMiddleware');

// Ruta para registrar un nuevo control de tierra
router.post('/:id_parcela', verificarToken, verificarRol([1, 3]), async (req, res) => {
    const { id_parcela } = req.params;
    const { ph_tierra, condiciones_humedad, condiciones_temperatura, observaciones } = req.body;

    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Verificar que la parcela tenga dimensiones asociadas
        const dimensionesResult = await client.query(
            `SELECT COUNT(*) 
             FROM dimensiones_parcelas 
             WHERE id_parcela = $1`,
            [id_parcela]
        );

        if (dimensionesResult.rows[0].count == 0) {
            return res.status(400).send('No se pueden registrar controles de tierra sin dimensiones asociadas.');
        }

        // Registrar el nuevo control de tierra
        await client.query(
            `INSERT INTO controles_tierra (id_parcela, ph_tierra, condiciones_humedad, condiciones_temperatura, observaciones, fecha_creacion) 
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [id_parcela, ph_tierra, condiciones_humedad, condiciones_temperatura, observaciones]
        );

        client.release();

        res.status(201).json({
            mensaje: 'Control de tierra registrado exitosamente',
        });
    } catch (error) {
        console.error('Error al registrar control de tierra:', error);
        res.status(500).send('Error al registrar control de tierra');
    }
});

// Obtener controles de tierra de cada parcela
router.get('/', verificarToken, verificarRol([1, 3, 5]), async (req, res) => {
    try {
        const pool = await connectWithConnector('vino_costero_negocio');
        const client = await pool.connect();

        // Obtener todas las parcelas
        const parcelasResult = await client.query(
            `SELECT p.id_parcela, p.nombre_parcela
             FROM parcelas p`
        );
        const parcelas = parcelasResult.rows;

        // Para cada parcela, obtener el último control y el historial de controles
        const parcelasDetalles = await Promise.all(parcelas.map(async (parcela) => {
            // Obtener el último control de tierra de la parcela
            const ultimoControlResult = await client.query(
                `SELECT ph_tierra, condiciones_humedad, condiciones_temperatura, observaciones, fecha_creacion
                 FROM controles_tierra
                 WHERE id_parcela = $1
                 ORDER BY fecha_creacion DESC LIMIT 1`,
                [parcela.id_parcela]
            );
            const ultimoControl = ultimoControlResult.rows[0] || null;

            // Obtener el historial completo de controles de tierra de la parcela
            const historialControlesResult = await client.query(
                `SELECT ph_tierra, condiciones_humedad, condiciones_temperatura, observaciones, fecha_creacion
                 FROM controles_tierra
                 WHERE id_parcela = $1
                 ORDER BY fecha_creacion DESC`,
                [parcela.id_parcela]
            );
            const historialControles = historialControlesResult.rows;

            return {
                id: parcela.id_parcela,
                nombre: parcela.nombre_parcela,
                ultimoControlTierra: ultimoControl
                    ? {
                        ph: ultimoControl.ph_tierra,
                        humedad: ultimoControl.condiciones_humedad,
                        temperatura: ultimoControl.condiciones_temperatura,
                        observaciones: ultimoControl.observaciones,
                        fecha: ultimoControl.fecha_creacion,
                    }
                    : 'No hay controles de tierra recientes',
                controlesTierra: historialControles.map((control) => ({
                    ph: control.ph_tierra,
                    humedad: control.condiciones_humedad,
                    temperatura: control.condiciones_temperatura,
                    observaciones: control.observaciones,
                    fecha: control.fecha_creacion,
                })),
            };
        }));

        client.release();

        res.status(200).json(parcelasDetalles);
    } catch (error) {
        console.error('Error al obtener controles de tierra:', error);
        res.status(500).send('Error al obtener los controles de tierra');
    }
});

module.exports = router;
