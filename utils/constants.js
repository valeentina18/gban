// Constantes para el bot GBAN

// Tiempos y límites
const APPROVAL_TIMEOUT = 15 * 60 * 1000; // 15 minutos para aprobar un desbaneo
const MIN_UPDATE_INTERVAL = 3000; // Mínimo 3 segundos entre actualizaciones de mensajes
const BAN_DELAY = 100; // Delay de 100ms entre cada ban para evitar límites de Telegram
const DB_QUERY_TIMEOUT = 30000; // 30 segundos de timeout para consultas a la BD
const BAN_OPERATION_TIMEOUT = 10000; // 10 segundos de timeout para operaciones de ban

// Mensajes de error comunes
const ERRORS = {
  NO_PERMISSION: '⛔ No tienes permiso para usar este comando.',
  DB_ERROR: '❌ Error al consultar la base de datos.',
  USER_NOT_FOUND: '❌ No se encontró el usuario especificado.',
  CHAT_NOT_FOUND: '❌ No se encontró ningún grupo/canal con ese ID en la base de datos.',
  FOUNDER_PROTECTED: '❌ No puedo ejecutar esa acción sobre un founder.\n¡Los founders están protegidos!',
  ALREADY_BANNED: '❌ Este usuario ya tiene un gban activo.',
  PENDING_BAN_EXISTS: '❌ Este usuario ya tiene un gban pendiente.',
  NO_BAN_FOUND: 'ℹ️ El usuario no tiene un gban registrado ni pendiente.',
  INVALID_USAGE: '❌ Uso incorrecto del comando.'
};

// Mensajes de éxito comunes
const SUCCESS = {
  BAN_COMPLETED: '✅ Gban completado exitosamente',
  UNBAN_COMPLETED: '✅ Usuario desbaneado de todos los grupos',
  CHAT_REMOVED: '✅ Grupo/canal eliminado correctamente',
  CHANNEL_ADDED: '✅ Canal de logs añadido correctamente',
  CHANNEL_REMOVED: '✅ Canal de logs eliminado correctamente',
  UPDATE_SUCCESS: '✅ Motivo de gban actualizado correctamente'
};

// Mensajes informativos
const INFO = {
  PROCESSING: '⏳ Procesando...',
  QUEUED: '⏳ Añadido a la cola de procesamiento...',
  APPROVAL_REQUIRED: '⏳ Se requiere aprobación para desbaneo',
  PENDING_EXECUTION: 'Este gban se ejecutará cuando el usuario envíe un mensaje'
};

// Hashtags para logs
const HASHTAGS = {
  BAN: '#BAN',
  UNBAN: '#UNBAN',
  MULTIGBAN: '#MULTIGBAN',
  AUTOBAN: '#AUTOBAN',
  AUTOBAN_MESSAGE: '#AUTOBAN_MESSAGE',
  GBAN_PENDIENTE: '#GBAN_PENDIENTE',
  GBAN_EJECUTADO: '#GBAN_EJECUTADO',
  SOLICITUD_UNBAN: '#SOLICITUD_UNBAN',
  CANCELACION_UNBAN: '#CANCELACION_UNBAN',
  UPDATE_GBAN: '#UPDATE_GBAN',
  RETRY_GBAN_EXITOSO: '#RETRY_GBAN_EXITOSO',
  RETRY_GBAN_FALLIDO: '#RETRY_GBAN_FALLIDO',
  NUEVO_CHAT: '#NUEVO_CHAT',
  CHAT_ELIMINADO: '#CHAT_ELIMINADO',
  ENLACE_GENERADO: '#ENLACE_GENERADO',
  CANAL_LOGS_AÑADIDO: '#CANAL_LOGS_AÑADIDO'
};

// Emojis comunes
const EMOJI = {
  BAN: '🚨',
  UNBAN: '🔓',
  INFO: 'ℹ️',
  SUCCESS: '✅',
  ERROR: '❌',
  WARNING: '⚠️',
  PROCESSING: '⏳',
  SHIELD: '🛡️',
  BOOK: '📚',
  STATS: '📈',
  CHAT: '💬',
  LOG: '📝',
  AUTOBAN: '🚫',
  NEW: '📥',
  DELETE: '🗑️',
  LINK: '🔗',
  BELL: '🔔',
  UPDATE: '🔄',
  RETRY: '🔄'
};

module.exports = {
  APPROVAL_TIMEOUT,
  MIN_UPDATE_INTERVAL,
  BAN_DELAY,
  DB_QUERY_TIMEOUT,
  BAN_OPERATION_TIMEOUT,
  ERRORS,
  SUCCESS,
  INFO,
  HASHTAGS,
  EMOJI
};
