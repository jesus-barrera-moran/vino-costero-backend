require('dotenv').config(); // Load environment variables from .env
const { Connector } = require('@google-cloud/cloud-sql-connector');
const { Pool } = require('pg');

const instanceConnectionName = process.env.DATABASE_INSTANCE_CONNECTION_NAME;
const dbUser = process.env.DATABASE_INSTANCE_USER;
const dbPass = process.env.DATABASE_INSTANCE_PASSWORD;
const dbHost = process.env.DATABASE_INSTANCE_HOST;
const ipType = process.env.PRIVATE_IP === 'true' ? 'PRIVATE' : 'PUBLIC';

async function connectWithConnector(dbName) {
    const connector = new Connector();

    const clientOpts = await connector.getOptions({
        instanceConnectionName,
        ipType,
        dbUser,
        dbPassword: dbPass,
    });

    // Create a connection pool
    const pool = new Pool({
        user: dbUser,
        password: dbPass,
        host: dbHost,  // Cambiar de '::1' a '127.0.0.1'
        database: dbName,
        port: 5432,
        ssl: clientOpts.ssl || false,  // Usa SSL solo si es necesario
    });

    return pool;
}

module.exports = { connectWithConnector };
 