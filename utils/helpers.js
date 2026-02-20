// Funciones auxiliares para el bot GBAN

/**
 * Escapa caracteres especiales de HTML
 * @param {string} text - Texto a escapar
 * @returns {string} Texto escapado
 */
function escapeHTML(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escapa caracteres especiales de Markdown
 * @param {string} text - Texto a escapar
 * @returns {string} Texto escapado
 */
function escapeMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\~/g, '\\~')
    .replace(/\`/g, '\\`')
    .replace(/\>/g, '\\>')
    .replace(/\#/g, '\\#')
    .replace(/\+/g, '\\+')
    .replace(/\-/g, '\\-')
    .replace(/\=/g, '\\=')
    .replace(/\|/g, '\\|')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\./g, '\\.')
    .replace(/\!/g, '\\!');
}

/**
 * Formatea una fecha a hora de Uruguay (UTC-3)
 * @param {Date|string} date - Fecha a formatear
 * @returns {string} Fecha formateada
 */
function formatDateUY(date) {
  const fecha = new Date(date);

  // Ajustar a hora de Uruguay (UTC-3)
  const fechaUY = new Date(fecha.getTime() - (3 * 60 * 60 * 1000));

  return fechaUY.toLocaleString('es', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

/**
 * Formatea una fecha corta
 * @param {Date|string} date - Fecha a formatear
 * @returns {string} Fecha formateada
 */
function formatDateShort(date) {
  const fecha = new Date(date);
  return fecha.toLocaleString('es', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  });
}

/**
 * Calcula el intervalo de actualización adaptativo según la cantidad de chats
 * @param {number} totalChats - Número total de chats
 * @returns {number} Intervalo de actualización
 */
function calculateUpdateInterval(totalChats) {
  // Base: actualizar cada 10 chats
  let interval = 10;

  // Aumentar el intervalo según la cantidad de chats
  if (totalChats > 100) interval = 20;
  if (totalChats > 200) interval = 30;
  if (totalChats > 500) interval = 50;
  if (totalChats > 1000) interval = 100;
  if (totalChats > 2000) interval = 200;
  if (totalChats > 5000) interval = 500;

  return interval;
}

/**
 * Resuelve un ID de usuario o username a información del usuario
 * @param {object} bot - Instancia del bot de Telegraf
 * @param {string} identifier - ID o username (@username)
 * @returns {Promise<object|null>} Información del usuario o null
 */
async function resolveUser(bot, identifier) {
  try {
    // Si comienza con "@" intentamos resolver el username
    if (identifier.startsWith('@')) {
      const user = await bot.telegram.getChat(identifier);
      return {
        id: String(user.id),
        username: user.username || null,
        first_name: user.first_name || 'Sin nombre'
      };
    }

    // Si no es un username, asumimos que es un ID
    const user = await bot.telegram.getChat(identifier);
    return {
      id: identifier,
      username: user.username || null,
      first_name: user.first_name || 'Sin nombre'
    };
  } catch (err) {
    console.error(`Error al resolver el identificador "${identifier}":`, err.message);
    return null;
  }
}

module.exports = {
  escapeHTML,
  escapeMarkdown,
  formatDateUY,
  formatDateShort,
  calculateUpdateInterval,
  resolveUser
};
