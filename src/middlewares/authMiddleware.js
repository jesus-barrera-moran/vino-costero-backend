const jwt = require('jsonwebtoken');
const { SECRET_KEY } = require('../config/config');

// Middleware para verificar el JWT
exports.verificarToken = (req, res, next) => {
  const token = req.headers['authorization'];

  if (!token) {
    return res.status(403).json({ error: 'Token no proporcionado' });
  }

  try {
    // Verificar el token
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded; // Añadir los datos del usuario a la solicitud
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// Middleware para verificar el rol del usuario
exports.verificarRol = (rolesPermitidos) => {
  return (req, res, next) => {
    if (!req.user || !req.user.roles.some(role => rolesPermitidos.includes(role))) {
      return res.status(403).json({ error: 'Acceso denegado, rol insuficiente' });
    }
    next(); // Continuar si el usuario tiene el rol correcto
  };
};
