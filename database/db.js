// Módulo de gestión de base de datos para el bot GBAN

const sqlite3 = require('sqlite3').verbose();

let db = null;

/**
 * Inicializa la conexión a la base de datos
 * @returns {Promise<sqlite3.Database>} Instancia de la base de datos
 */
function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database('gban_bot.db', (err) => {
      if (err) {
        console.error('Error al conectar con la base de datos:', err);
        reject(err);
      } else {
        console.log('Conectado a la base de datos SQLite.');
        createTables()
          .then(() => resolve(db))
          .catch(reject);
      }
    });
  });
}

/**
 * Crea las tablas necesarias en la base de datos
 */
function createTables() {
  return Promise.all([
    runQuery(`CREATE TABLE IF NOT EXISTS gbans (
      user_id TEXT,
      reason TEXT,
      banned_by TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    runQuery(`CREATE TABLE IF NOT EXISTS chats (
      chat_id TEXT PRIMARY KEY,
      chat_name TEXT
    )`),
    runQuery(`CREATE TABLE IF NOT EXISTS pending_gbans (
      user_id TEXT PRIMARY KEY,
      reason TEXT,
      banned_by TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    runQuery(`CREATE TABLE IF NOT EXISTS log_channels (
      channel_id TEXT PRIMARY KEY,
      channel_name TEXT,
      added_by TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`)
  ]);
}

/**
 * Ejecuta una consulta SQL sin retornar resultados
 * @param {string} sql - Consulta SQL
 * @param {Array} params - Parámetros de la consulta
 * @returns {Promise<void>}
 */
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

/**
 * Ejecuta una consulta SQL y retorna una fila
 * @param {string} sql - Consulta SQL
 * @param {Array} params - Parámetros de la consulta
 * @returns {Promise<object|null>}
 */
function getOne(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

/**
 * Ejecuta una consulta SQL y retorna todas las filas
 * @param {string} sql - Consulta SQL
 * @param {Array} params - Parámetros de la consulta
 * @returns {Promise<Array>}
 */
function getAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * Obtiene la instancia de la base de datos
 * @returns {sqlite3.Database}
 */
function getDatabase() {
  return db;
}

module.exports = {
  initDatabase,
  runQuery,
  getOne,
  getAll,
  getDatabase
};
