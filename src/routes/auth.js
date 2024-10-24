const express = require('express');
const router = express.Router();
const { verificarToken, verificarRol, verificarPertenencia } = require('../middlewares/authMiddleware');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt'); // Importar bcrypt
const CryptoJS = require('crypto-js'); // Importar CryptoJS para la desencriptación
const { SECRET_KEY } = require('../config/config');
const { connectWithConnector } = require('../database/connector');

// Clave de desencriptación (debe ser la misma usada en el frontend)
const ENCRYPTION_KEY = 'tuClaveSecreta';

// Función para desencriptar texto usando CryptoJS
const decryptText = (encryptedText) => {
  const bytes = CryptoJS.AES.decrypt(encryptedText, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
};

// Ruta para login (genera el token JWT)
router.post('/login', async (req, res) => {
  let { username, password } = req.body;
  let client;

  try {
    // Desencriptar las credenciales recibidas del frontend
    const decryptedUsername = decryptText(username);
    const decryptedPassword = decryptText(password);

    const pool = await connectWithConnector('vino_costero_usuarios');
    client = await pool.connect();

    // Obtener los detalles del usuario, incluyendo su contraseña y rol
    const userResult = await client.query(
      `SELECT contrasena, usuario, habilitado
       FROM usuarios
       WHERE usuario = $1`,
      [decryptedUsername]
    );

    // Verificar si el usuario fue encontrado
    if (userResult.rows.length === 0) {
      client.release();
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    // Verificar si el usuario está habilitado
    if (userResult.rows[0]?.habilitado === false) {
      client.release();
      return res.status(401).json({ error: 'Usuario deshabilitado' });
    }

    const user = userResult.rows[0];

    // Comparar la contraseña desencriptada con la contraseña encriptada almacenada usando bcrypt
    const validPassword = await bcrypt.compare(decryptedPassword, user.contrasena);

    if (!validPassword) {
      client.release();
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // Obtener los roles del usuario
    const userRoles = await client.query(
      `SELECT r.id_rol as role
       FROM usuarios u
       LEFT JOIN usuarios_roles ur ON u.id_usuario = ur.id_usuario
       LEFT JOIN roles r ON ur.id_rol = r.id_rol
       WHERE u.usuario = $1`,
      [decryptedUsername]
    );

    const roles = userRoles.rows.map(row => row.role);

    // Si la contraseña es válida, generar el token JWT
    const token = jwt.sign({ username: user.usuario, roles }, SECRET_KEY, { expiresIn: '1h' });

    client.release();
    return res.json({ token, username: decryptedUsername, roles });

  } catch (error) {
    console.error('Error al autenticar usuario:', error);
    if (client) client.release();
    res.status(500).send('Error al autenticar usuario');
  }
});

// Ruta para registro de usuarios
router.post('/register', verificarToken, verificarRol([1]), async (req, res) => {
  const { username, password, nombre, apellido, correo, roles } = req.body;
  let client;

  try {
    // Validación de campos requeridos
    if (!username || !password || !nombre || !apellido || !correo || !roles.length) {
      return res.status(400).json({ message: 'Error al registrar el usuario' });
    }

    // Validación del formato del correo electrónico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(correo)) {
      return res.status(400).json({ message: 'Error al registrar el usuario' });
    }

    // Desencriptar la contraseña recibida
    const decryptedPassword = decryptText(password); // Usar la función de desencriptación

    const pool = await connectWithConnector('vino_costero_usuarios');
    client = await pool.connect();

    // Iniciar transacción
    await client.query('BEGIN');

    // Verificar si el nombre de usuario ya existe
    const usuarioExiste = await client.query(
      `SELECT COUNT(*) AS total 
       FROM usuarios 
       WHERE usuario = $1`,
      [username]
    );

    if (parseInt(usuarioExiste.rows[0].total) > 0) {
      client.release();
      return res.status(400).json({ message: 'El nombre de usuario ya está en uso' });
    }

    // Verificar si el correo electrónico ya existe
    const correoExiste = await client.query(
      `SELECT COUNT(*) AS total 
       FROM usuarios 
       WHERE correo = $1`,
      [correo]
    );

    if (parseInt(correoExiste.rows[0].total) > 0) {
      client.release();
      return res.status(400).json({ message: 'El correo electrónico ya está en uso' });
    }

    // Encriptar la contraseña
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(decryptedPassword, saltRounds);

    // Insertar el nuevo usuario en la tabla "usuarios"
    const result = await client.query(
      `INSERT INTO usuarios (usuario, nombre, apellido, correo, contrasena, fecha_creacion, habilitado) 
       VALUES ($1, $2, $3, $4, $5, NOW(), true) RETURNING id_usuario`,
      [username, nombre, apellido, correo, hashedPassword]
    );

    const newUserId = result.rows[0].id_usuario; // Obtener el id del usuario recién creado

    // Verificar si el rol existe
    for (const role of roles) {
      const rolResult = await client.query(
        `SELECT id_rol 
         FROM roles 
         WHERE id_rol = $1`,
        [role]
      );

      if (rolResult.rows.length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ message: 'Rol no válido' });
      }
    }

    for (const roleId of roles) {
      // Insertar en la tabla "usuarios_roles"
      await client.query(
        `INSERT INTO usuarios_roles (id_usuario, id_rol, fecha_creacion) 
         VALUES ($1, $2, NOW())`,
        [newUserId, roleId]
      );
    }

    // Generar un token JWT para el nuevo usuario
    const token = jwt.sign({ username, roles }, SECRET_KEY, { expiresIn: '1h' });

    // Confirmar la transacción
    await client.query('COMMIT');
    client.release();

    return res.status(201).json({ token, username, roles });

  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    console.error('Error al crear el usuario:', error);
    res.status(500).json({ message: 'Error al registrar el usuario' });
  }
});

// Endpoint para obtener la lista de usuarios con su último rol
router.get('/usuarios', verificarToken, verificarRol([1, 5]), async (req, res) => {
  let client;

  try {
    const pool = await connectWithConnector('vino_costero_usuarios');
    client = await pool.connect();

    // Consultar la información de los usuarios junto con su último rol
    const usuariosResult = await client.query(`
      SELECT DISTINCT ON (u.id_usuario) u.id_usuario, u.usuario, u.correo, u.habilitado, r.id_rol as rol
      FROM usuarios u
      LEFT JOIN usuarios_roles ur ON u.id_usuario = ur.id_usuario
      LEFT JOIN roles r ON ur.id_rol = r.id_rol
      ORDER BY u.id_usuario, ur.fecha_creacion DESC, ur.id_rol DESC
    `);

    if (usuariosResult.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'No se encontraron usuarios' });
    }

    const usuarios = usuariosResult.rows;
    client.release();

    // Retornar la lista de usuarios con su último rol
    return res.status(200).json(usuarios);

  } catch (error) {
    console.error('Error al obtener la lista de usuarios:', error);
    if (client) client.release();
    return res.status(500).send('Error al obtener la lista de usuarios');
  }
});

router.put('/manage/:id', verificarToken, verificarRol([1]), async (req, res) => {
  const { id } = req.params; // ID del usuario a actualizar
  const { rol, habilitado } = req.body; // Datos a actualizar (roles y habilitado)
  let client;

  try {
    const pool = await connectWithConnector('vino_costero_usuarios');
    client = await pool.connect();

    // Iniciar transacción
    await client.query('BEGIN');

    // Verificar si el usuario existe
    const usuarioExiste = await client.query(
      `SELECT * 
       FROM usuarios 
       WHERE id_usuario = $1`,
      [id]
    );

    if (usuarioExiste.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Actualizar el estado del usuario (habilitado/deshabilitado)
    await client.query(
      `UPDATE usuarios 
       SET habilitado = $1 
       WHERE id_usuario = $2`,
      [habilitado, id]
    );

    // Obtener el ID del rol desde el nombre del rol
    const rolResult = await client.query(
      `SELECT id_rol 
       FROM roles 
       WHERE nombre = $1`,
      [rol]
    );

    if (rolResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ error: 'Rol no válido' });
    }

    const idRol = rolResult.rows[0].id_rol;

    // Actualizar la relación usuario-rol en la tabla "usuario_roles"
    await client.query(
      `UPDATE usuario_roles 
       SET id_rol = $1 
       WHERE id_usuario = $2`,
      [idRol, id]
    );

    // Confirmar la transacción
    await client.query('COMMIT');
    client.release();

    return res.status(200).json({ mensaje: 'Usuario actualizado exitosamente' });

  } catch (error) {
    console.error('Error al actualizar el usuario:', error);
    await client.query('ROLLBACK');
    res.status(500).send('Error al actualizar el usuario');
  }
});

router.put('/update/:username', verificarToken, verificarPertenencia, async (req, res) => {
  const { username } = req.params;
  const { nombre, apellido, correo, contrasena } = req.body;
  let client;

  try {
    // Validación de campos requeridos
    if (!nombre || !apellido || !correo) {
      return res.status(400).json({ message: 'Error al actualizar el usuario' });
    }

    // Validación del formato del correo electrónico
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(correo)) {
      return res.status(400).json({ message: 'Error al actualizar el usuario' });
    }

    const pool = await connectWithConnector('vino_costero_usuarios');
    client = await pool.connect();

    // Iniciar transacción
    await client.query('BEGIN');

    // Verificar si el usuario existe
    const usuarioExiste = await client.query(
      `SELECT * 
       FROM usuarios 
       WHERE usuario = $1`,
      [username]
    );

    if (usuarioExiste.rows.length === 0) {
      client.release();
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Si se proporciona una nueva contraseña, encriptarla
    let hashedPassword = usuarioExiste.rows[0].contrasena; // Mantener la contraseña anterior si no se actualiza
    if (contrasena) {
      const saltRounds = 10;
      hashedPassword = await bcrypt.hash(contrasena, saltRounds);
    }

    // Actualizar los datos del usuario
    await client.query(
      `UPDATE usuarios 
       SET nombre = $1, apellido = $2, correo = $3, contrasena = $4 
       WHERE usuario = $5`,
      [nombre, apellido, correo, hashedPassword, username]
    );

    // Confirmar la transacción
    await client.query('COMMIT');
    client.release();

    return res.status(200).json({ message: 'Usuario actualizado exitosamente' });

  } catch (error) {
    console.error('Error al actualizar el perfil del usuario:', error);
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    res.status(500).json({ message: 'Error al actualizar el usuario' });
  }
});

// Endpoint para actualizar múltiples usuarios
router.put('/usuarios/batch', verificarToken, verificarRol([1]), async (req, res) => {
  const { usuarios } = req.body; // Array de usuarios con sus cambios
  let client;

  try {
    const pool = await connectWithConnector('vino_costero_usuarios');
    client = await pool.connect();
    await client.query('BEGIN'); // Iniciar transacción

    // Iterar sobre cada usuario y aplicar los cambios
    for (const usuario of usuarios) {
      const { id_usuario, rol, habilitado } = usuario;

      // Actualizar el estado (habilitado/deshabilitado) si está presente en el payload
      if (habilitado !== undefined) {
        await client.query(
          `UPDATE usuarios SET habilitado = $1 WHERE id_usuario = $2`,
          [habilitado, id_usuario]
        );
      }

      // Actualizar el rol si está presente en el payload
      if (rol !== undefined) {
        const rolResult = await client.query(
          `SELECT id_rol FROM roles WHERE id_rol = $1`,
          [rol]
        );

        if (rolResult.rows.length === 0) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(400).json({ error: `Rol no válido para el usuario ${id_usuario}` });
        }

        // Actualizar la relación usuario-rol en la tabla "usuario_roles"
        await client.query(
          `UPDATE usuarios_roles SET id_rol = $1 WHERE id_usuario = $2`,
          [rol, id_usuario]
        );
      }
    }

    await client.query('COMMIT'); // Confirmar la transacción
    client.release();
    return res.status(200).json({ mensaje: 'Usuarios actualizados exitosamente' });

  } catch (error) {
    console.error('Error al actualizar los usuarios:', error);
    await client.query('ROLLBACK');
    if (client) client.release();
    return res.status(500).send('Error al actualizar los usuarios');
  }
});

// Ruta para obtener un usuario por su ID
router.get('/usuarios/:username', verificarToken, verificarPertenencia, async (req, res) => {
  const { username } = req.params;
  let client;

  try {
    const pool = await connectWithConnector('vino_costero_usuarios');
    client = await pool.connect();

    // Consultar la información del usuario
    const userResult = await client.query(
      `SELECT id_usuario, usuario, nombre, apellido, correo, habilitado
       FROM usuarios
       WHERE usuario = $1`,
      [username]
    );

    if (userResult.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const userRols = await client.query(
      `SELECT ur.id_rol as rol
       FROM usuarios_roles ur
       LEFT JOIN usuarios u ON ur.id_usuario = u.id_usuario
       WHERE u.usuario = $1`,
      [username]
    );

    if (userRols.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Roles no encontrados' });
    }

    const roles = userRols.rows.map(row => row.rol);

    const usuario = { ...userResult.rows[0], roles };
    client.release();

    // Retornar los datos del usuario
    return res.status(200).json(usuario);
  } catch (error) {
    console.error('Error al obtener el usuario:', error);
    if (client) {
      client.release();
    }
    res.status(500).send('Error al obtener el usuario');
  }
});

// Endpoint para actualizar el rol de un usuario
router.put('/usuarios/:id/rol', verificarToken, verificarRol([1]), async (req, res) => {
  const { id } = req.params;
  const { rol } = req.body; // El rol que vamos a asignar
  let client;

  try {
    const pool = await connectWithConnector('vino_costero_usuarios');
    client = await pool.connect();

    // Verificar si el usuario existe
    const usuarioExiste = await client.query(
      `SELECT * FROM usuarios WHERE id_usuario = $1`, 
      [id]
    );

    if (usuarioExiste.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Verificar si el rol existe
    const rolResult = await client.query(
      `SELECT id_rol FROM roles WHERE id_rol = $1`,
      [rol]
    );

    if (rolResult.rows.length === 0) {
      client.release();
      return res.status(400).json({ error: 'Rol no válido' });
    }

    const idRol = rolResult.rows[0].id_rol;

    // Actualizar el rol del usuario en la tabla "usuario_roles"
    await client.query(
      `UPDATE usuarios_roles SET id_rol = $1 WHERE id_usuario = $2`,
      [idRol, id]
    );

    client.release();
    return res.status(200).json({ mensaje: 'Rol actualizado exitosamente' });

  } catch (error) {
    console.error('Error al actualizar el rol:', error);
    if (client) client.release();
    return res.status(500).send('Error al actualizar el rol');
  }
});

// Endpoint para actualizar el estado del usuario
router.put('/usuarios/:id/habilitar', verificarToken, verificarRol([1]), async (req, res) => {
  const { id } = req.params;
  const { habilitado } = req.body; // El estado habilitado (true/false)
  let client;

  try {
    const pool = await connectWithConnector('vino_costero_usuarios');
    client = await pool.connect();

    // Verificar si el usuario existe
    const usuarioExiste = await client.query(
      `SELECT * FROM usuarios WHERE id_usuario = $1`, 
      [id]
    );

    if (usuarioExiste.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Actualizar el estado (habilitado/deshabilitado) del usuario
    await client.query(
      `UPDATE usuarios SET habilitado = $1 WHERE id_usuario = $2`,
      [habilitado, id]
    );

    client.release();
    return res.status(200).json({ mensaje: 'Estado actualizado exitosamente' });

  } catch (error) {
    console.error('Error al actualizar el estado:', error);
    if (client) client.release();
    return res.status(500).send('Error al actualizar el estado');
  }
});

module.exports = router;
