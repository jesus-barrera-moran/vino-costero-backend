const express = require('express');
const router = express.Router();
const { connectWithConnector } = require('../database/connector');

// Ruta para registrar un nuevo control de tierra
router.post('/', async (req, res) => {
    const { id_parcela, ph_tierra, condiciones_humedad, condiciones_temperatura, observaciones } = req.body;

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

module.exports = router;
