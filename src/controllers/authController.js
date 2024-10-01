const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt'); // Importar bcrypt
const { SECRET_KEY } = require('../config/config');
const { connectWithConnector } = require('../database/connector');

// Función de autenticación (Login)
exports.login = async (req, res) => {
  const { username, password } = req.body;
  let client;

  try {
    const pool = await connectWithConnector('vino_costero_usuarios');
    client = await pool.connect();

    // Obtener los detalles del usuario, incluyendo su contraseña y rol
    const userResult = await client.query(
      `SELECT contrasena, usuario
       FROM usuarios
       WHERE usuario = $1`,
      [username]
    );

    // Verificar si el usuario fue encontrado
    if (userResult.rows.length === 0) {
      client.release();
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const user = userResult.rows[0];

    // Obtener los roles del usuario
    const userRoles = await client.query(
      `SELECT r.id_rol as role
       FROM usuarios u
       LEFT JOIN usuarios_roles ur ON u.id_usuario = ur.id_usuario
       LEFT JOIN roles r ON ur.id_rol = r.id_rol
       WHERE u.usuario = $1`,
      [username]
    );

    const roles = userRoles.rows.map(row => row.role);

    // Verificar la contraseña usando bcrypt
    const validPassword = await bcrypt.compare(password, user.contrasena);

    if (!validPassword) {
      client.release();
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // Si la contraseña es válida, generar el token JWT
    const token = jwt.sign({ username: user.usuario, roles }, SECRET_KEY, { expiresIn: '1h' });

    client.release();
    return res.json({ token, username, roles });

  } catch (error) {
    console.error('Error al autenticar usuario:', error);
    if (client) client.release();
    res.status(500).send('Error al autenticar usuario');
  }
};

// Función para registrar un nuevo usuario
exports.register = async (req, res) => {
  const { username, password, nombre, apellido, correo, roles } = req.body;
  let client;

  try {
    const pool = await connectWithConnector('vino_costero_usuarios');
    client = await pool.connect();

    // Iniciar transacción
    await client.query('BEGIN');

    // Verificar si el usuario ya existe
    const usuarioExiste = await client.query(
      `SELECT COUNT(*) 
       FROM usuarios 
       WHERE usuario = $1`,
      [username]
    );

    if (usuarioExiste.rows[0].count > 0) {
      client.release();
      return res.status(400).json({ error: 'El usuario ya existe' });
    }

    // Encriptar la contraseña
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

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
        return res.status(400).json({ error: 'Rol no válido' });
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
    console.error('Error al crear el usuario:', error);
    await client.query('ROLLBACK');
    res.status(500).send('Error al crear el usuario');
  }
};

// Endpoint para actualizar un usuario existente
exports.manageUser = async (req, res) => {
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
};

// Endpoint para actualizar un usuario existente (nombre, apellido, correo y contraseña)
exports.updateUser = async (req, res) => {
  const { id } = req.params; // ID del usuario a actualizar
  const { nombre, apellido, correo, contrasena } = req.body; // Datos a actualizar
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
       WHERE id_usuario = $5`,
      [nombre, apellido, correo, hashedPassword, id]
    );

    // Confirmar la transacción
    await client.query('COMMIT');
    client.release();

    return res.status(200).json({ mensaje: 'Perfil del usuario actualizado exitosamente' });

  } catch (error) {
    console.error('Error al actualizar el perfil del usuario:', error);
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    res.status(500).send('Error al actualizar el perfil del usuario');
  }
};
