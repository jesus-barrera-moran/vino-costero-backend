const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verificarToken } = require('../middlewares/authMiddleware');

// Ruta para login (genera el token JWT)
router.post('/login', authController.login);

// Ruta para registro de usuarios
router.post('/register', authController.register);

// Ruta protegida (requiere token JWT)
router.get('/datos', verificarToken, (req, res) => {
  res.json({ usuario: req.user });
});

module.exports = router;
