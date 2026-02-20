// Importar las bibliotecas necesarias

require('dotenv').config();

const { Telegraf } = require('telegraf');

const sqlite3 = require('sqlite3').verbose();

// Importar módulos personalizados
const { escapeHTML, escapeMarkdown, formatDateUY, formatDateShort, calculateUpdateInterval, resolveUser } = require('./utils/helpers');
const { APPROVAL_TIMEOUT, MIN_UPDATE_INTERVAL, BAN_DELAY, ERRORS, SUCCESS, INFO, HASHTAGS, EMOJI } = require('./utils/constants');
const dbModule = require('./database/db');



// Configuración del bot y base de datos usando variables de entorno

const BOT_TOKEN = process.env.BOT_TOKEN;

// Cambiar la configuración para soportar múltiples canales de logs

const LOG_CHANNELS = process.env.LOG_CHANNELS ? process.env.LOG_CHANNELS.split(',') : [];

const FOUNDERS = process.env.FOUNDERS.split(','); // IDs de founders separados por comas

const bot = new Telegraf(BOT_TOKEN);

const INACTIVE_CHAT_DAYS = Math.max(parseInt(process.env.INACTIVE_CHAT_DAYS || '30', 10), 1);
const INACTIVE_CHAT_CHECK_HOURS = Math.max(parseInt(process.env.INACTIVE_CHAT_CHECK_HOURS || '12', 10), 1);
const INACTIVE_CHAT_CHECK_INTERVAL = INACTIVE_CHAT_CHECK_HOURS * 60 * 60 * 1000;
const INACTIVITY_WINDOW_MS = INACTIVE_CHAT_DAYS * 24 * 60 * 60 * 1000;



const db = new sqlite3.Database('gban_bot.db', (err) => {

  if (err) console.error('Error al conectar con la base de datos:', err);

  else console.log('Conectado a la base de datos SQLite.');

});



db.run(`CREATE TABLE IF NOT EXISTS gbans (

  user_id TEXT,

  reason TEXT,

  banned_by TEXT,

  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP

)`);



const chatsTableReady = ensureChatsTable();



// Primero, agregar una nueva tabla para GBans pendientes

db.run(`CREATE TABLE IF NOT EXISTS pending_gbans (

  user_id TEXT PRIMARY KEY,

  reason TEXT,

  banned_by TEXT,

  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP

)`);



// Añadir nueva tabla para almacenar los canales de logs

db.run(`CREATE TABLE IF NOT EXISTS log_channels (

  channel_id TEXT PRIMARY KEY,

  channel_name TEXT,

  added_by TEXT,

  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP

)`);



function ensureChatsTable() {

  return new Promise((resolve) => {

    db.run(`CREATE TABLE IF NOT EXISTS chats (

      chat_id TEXT PRIMARY KEY,

      chat_name TEXT,

      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP

    )`, (createErr) => {

      if (createErr) {

        console.error('Error al crear tabla chats:', createErr);

        return resolve();

      }

      db.all('PRAGMA table_info(chats)', (pragmaErr, columns) => {

        if (pragmaErr) {

          console.error('Error al inspeccionar tabla chats:', pragmaErr);

          return resolve();

        }

        const hasLastActivity = columns.some((col) => col.name === 'last_activity');

        const initializeColumn = () => {

          db.run('UPDATE chats SET last_activity = COALESCE(last_activity, CURRENT_TIMESTAMP)', (updateErr) => {

            if (updateErr) {

              console.error('Error al inicializar last_activity:', updateErr);

            }

            resolve();

          });

        };

        if (hasLastActivity) {

          return initializeColumn();

        }

        db.run('ALTER TABLE chats ADD COLUMN last_activity DATETIME', (alterErr) => {

          if (alterErr) {

            console.error('Error al agregar columna last_activity:', alterErr);

            return resolve();

          }

          initializeColumn();

        });

      });

    });

  });

}



// Inicializar los canales de logs desde las variables de entorno

async function initLogChannels() {

  try {

    // Comprobar si ya hay canales registrados en la base de datos

    const channelCount = await new Promise((resolve) => {

      db.get('SELECT COUNT(*) as count FROM log_channels', [], (err, row) => {

        if (err) resolve(0);

        else resolve(row?.count || 0);

      });

    });

    

    // Si no hay canales registrados, insertar los de las variables de entorno

    if (channelCount === 0 && LOG_CHANNELS.length > 0) {

      console.log(`Inicializando ${LOG_CHANNELS.length} canales de logs desde .env`);

      

      for (const channelId of LOG_CHANNELS) {

        try {

          // Intentar obtener información del canal/grupo

          const chatInfo = await bot.telegram.getChat(channelId);

          const channelName = chatInfo.title || chatInfo.username || 'Canal de Logs';

          

          // Insertar en la base de datos

          db.run(

            'INSERT OR IGNORE INTO log_channels (channel_id, channel_name, added_by) VALUES (?, ?, ?)', 

            [channelId, channelName, 'system']

          );

          

          console.log(`Canal de logs registrado: ${channelName} [${channelId}]`);

        } catch (err) {

          console.error(`Error al inicializar canal de logs ${channelId}:`, err.message);

        }

      }

    }

  } catch (error) {

    console.error('Error al inicializar canales de logs:', error);

  }

}



// Verificar si el usuario es un founder

function isFounder(ctx) {

  return FOUNDERS.includes(String(ctx.from.id));

}



// Agregar función helper para verificar si un ID es de un founder

function isUserFounder(userId) {

  return FOUNDERS.includes(String(userId));

}



// Función para enviar mensaje a todos los canales de logs

async function sendToLogChannels(message, options = {}) {

  // Obtener todos los canales de logs de la base de datos

  return new Promise((resolve, reject) => {

    db.all('SELECT channel_id FROM log_channels', [], async (err, rows) => {

      if (err) {

        console.error('Error al obtener canales de logs:', err);

        return resolve(false);

      }

      

      if (rows.length === 0) {

        console.warn('No hay canales de logs configurados');

        return resolve(false);

      }

      

      const results = [];

      for (const row of rows) {

        try {

          const result = await bot.telegram.sendMessage(row.channel_id, message, options);

          results.push({ channelId: row.channel_id, success: true, result });

        } catch (error) {

          console.error(`Error al enviar mensaje al canal ${row.channel_id}:`, error.message);

          results.push({ channelId: row.channel_id, success: false, error: error.message });

        }

      }

      

      resolve(results);

    });

  });

}

async function upsertChat(chatId, chatName = 'Sin Nombre') {

  if (!chatId) return false;

  await chatsTableReady;

  const safeName = chatName || 'Sin Nombre';

  return new Promise((resolve) => {

    db.run(

      'INSERT OR IGNORE INTO chats (chat_id, chat_name, last_activity) VALUES (?, ?, CURRENT_TIMESTAMP)',

      [chatId, safeName],

      (insertErr) => {

        if (insertErr) {

          console.error('Error al insertar chat:', insertErr);

          return resolve(false);

        }

        db.run(

          'UPDATE chats SET chat_name = ?, last_activity = CURRENT_TIMESTAMP WHERE chat_id = ?',

          [safeName, chatId],

          (updateErr) => {

            if (updateErr) {

              console.error('Error al actualizar chat:', updateErr);

              return resolve(false);

            }

            resolve(true);

          }

        );

      }

    );

  });

}

async function removeInactiveChats() {

  await chatsTableReady;

  const cutoffDate = new Date(Date.now() - INACTIVITY_WINDOW_MS);

  const cutoffTimestamp = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');

  const inactiveChats = await new Promise((resolve) => {

    db.all(

      'SELECT chat_id, chat_name, last_activity FROM chats WHERE last_activity IS NULL OR last_activity < ?',

      [cutoffTimestamp],

      (err, rows) => {

        if (err) {

          console.error('Error al buscar chats inactivos:', err);

          return resolve([]);

        }

        resolve(rows || []);

      }

    );

  });

  if (inactiveChats.length === 0) return;

  for (const chat of inactiveChats) {

    await new Promise((resolve) => {

      db.run('DELETE FROM chats WHERE chat_id = ?', [chat.chat_id], (err) => {

        if (err) {

          console.error(`Error al eliminar chat inactivo ${chat.chat_id}:`, err);

        } else {

          console.log(`Chat eliminado por inactividad: ${chat.chat_name || chat.chat_id}`);

        }

        resolve();

      });

    });

    const lastActivity = chat.last_activity || 'Sin registro';

    const message =

      `🗑 #CHAT_INACTIVO\n` +

      `• Nombre: ${chat.chat_name || 'Sin Nombre'}\n` +

      `• ID: ${chat.chat_id}\n` +

      `• Última actividad: ${lastActivity}\n` +

      `• Motivo: Más de ${INACTIVE_CHAT_DAYS} días sin actividad`;

    try {

      await sendToLogChannels(message);

    } catch (error) {

      console.error('Error al notificar chat inactivo:', error);

    }

  }

}



// Comandos para gestionar los canales de logs (solo para founders)

bot.command('addlogchannel', async (ctx) => {

  if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');

  

  const args = ctx.message.text.split(' ').slice(1);

  const channelId = args[0];

  

  if (!channelId) {

    return ctx.reply('Uso: /addlogchannel <channel_id>\n\n🔹 Debes proporcionar el ID del canal o grupo.');

  }

  

  try {

    // Verificar si el bot tiene acceso al canal/grupo

    const chatInfo = await bot.telegram.getChat(channelId);

    const channelName = chatInfo.title || chatInfo.username || 'Sin nombre';

    

    // Insertar en la base de datos

    db.run(

      'INSERT OR REPLACE INTO log_channels (channel_id, channel_name, added_by) VALUES (?, ?, ?)', 

      [channelId, channelName, ctx.from.id],

      async function(err) {

        if (err) {

          console.error('Error al registrar canal de logs:', err);

          return ctx.reply('❌ Error al registrar el canal de logs en la base de datos.');

        }

        

        await ctx.reply(

          `✅ Canal de logs añadido correctamente\n` +

          `• Nombre: ${channelName}\n` +

          `• ID: ${channelId}`

        );

        

        // Enviar mensaje de prueba al canal

        try {

          await bot.telegram.sendMessage(

            channelId,

            `🔔 #CANAL_LOGS_AÑADIDO\n` +

            `• Este canal ha sido configurado como canal de logs\n` +

            `• Añadido por: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>`,

            { parse_mode: 'HTML' }

          );

        } catch (error) {

          await ctx.reply('⚠️ Canal añadido, pero no puedo enviar mensajes. Por favor verifica los permisos.');

        }

      }

    );

  } catch (error) {

    return ctx.reply(

      `❌ Error al añadir el canal: ${error.message}\n\n` +

      `Posibles causas:\n` +

      `• El bot no es miembro del canal/grupo\n` +

      `• El ID proporcionado es incorrecto\n` +

      `• El bot no tiene permisos para enviar mensajes`

    );

  }

});



bot.command('removelogchannel', async (ctx) => {

  if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');

  

  const args = ctx.message.text.split(' ').slice(1);

  const channelId = args[0];

  

  if (!channelId) {

    return ctx.reply('Uso: /removelogchannel <channel_id>\n\n🔹 Debes proporcionar el ID del canal o grupo.');

  }

  

  db.get('SELECT channel_name FROM log_channels WHERE channel_id = ?', [channelId], async (err, row) => {

    if (err) {

      console.error('Error al consultar la base de datos:', err);

      return ctx.reply('❌ Error al consultar la base de datos.');

    }

    

    if (!row) {

      return ctx.reply('❌ No se encontró ningún canal de logs con ese ID.');

    }

    

    db.run('DELETE FROM log_channels WHERE channel_id = ?', [channelId], async (err) => {

      if (err) {

        console.error('Error al eliminar canal de logs:', err);

        return ctx.reply('❌ Error al eliminar el canal de logs de la base de datos.');

      }

      

      await ctx.reply(

        `✅ Canal de logs eliminado correctamente\n` +

        `• Nombre: ${row.channel_name}\n` +

        `• ID: ${channelId}`

      );

    });

  });

});



bot.command('listlogchannels', async (ctx) => {

  if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');

  

  db.all('SELECT channel_id, channel_name, added_by, timestamp FROM log_channels', [], async (err, rows) => {

    if (err) {

      console.error('Error al obtener la lista de canales de logs:', err);

      return ctx.reply('❌ Error al obtener la lista de canales de logs.');

    }

    

    if (rows.length === 0) {

      return ctx.reply('⚠️ No hay canales de logs configurados.');

    }

    

    let message = `📋 <b>Lista de canales de logs:</b>\n\n`;

    for (const row of rows) {

      const date = new Date(row.timestamp);

      const formattedDate = date.toLocaleDateString('es');

      message += `• <b>${escapeHTML(row.channel_name)}</b>\n`;

      message += `  - ID: <code>${row.channel_id}</code>\n`;

      message += `  - Añadido: ${formattedDate}\n\n`;

    }

    

    await ctx.reply(message, { parse_mode: 'HTML' });

  });

});



// Comando /ping

bot.command('ping', async (ctx) => {

  ctx.reply('🏓 ¡Pong! El bot está funcionando correctamente.');

});



// Comando /help para mostrar ayuda sobre el bot

bot.command('help', async (ctx) => {

  // Verificar si el usuario es founder para mostrar comandos adicionales

  const isAdmin = isFounder(ctx);



  let helpMessage = `📚 <b>Comandos del Bot GBAN</b>\n\n`;



  // Comandos disponibles para todos los usuarios

  helpMessage += `<b>🌐 Comandos públicos:</b>\n`;

  helpMessage += `• /ping - Verificar si el bot está en funcionamiento\n`;

  helpMessage += `• /help - Mostrar esta ayuda\n`;



  // Comandos solo para founders

  if (isAdmin) {

    helpMessage += `\n<b>🛡️ Comandos de Moderación:</b>\n`;

    helpMessage += `• /gban &lt;ID|@username&gt; &lt;motivo&gt; - Banear globalmente a un usuario\n`;

    helpMessage += `• /ungban &lt;ID|@username&gt; - Solicitar desbaneo global (requiere aprobación)\n`;

    helpMessage += `• /multigban &lt;ID1 ID2...&gt; - Banear múltiples usuarios (responder a mensaje con motivo)\n`;

    helpMessage += `• /update &lt;ID&gt; &lt;motivo&gt; - Añadir información adicional a un gban\n`;

    helpMessage += `• /retrygban &lt;ID&gt; - Reintentar aplicar un gban pendiente\n\n`;



    helpMessage += `<b>📊 Comandos de Información:</b>\n`;

    helpMessage += `• /ginfo &lt;ID&gt; - Ver información detallada de un gban\n`;

    helpMessage += `• /pendingapprovals - Ver solicitudes de desbaneo pendientes\n`;

    helpMessage += `• /queueinfo - Ver el estado actual de la cola de gbans\n`;

    helpMessage += `• /who - Verificar si eres founder del bot\n\n`;



    helpMessage += `<b>💬 Gestión de Chats:</b>\n`;

    helpMessage += `• /listchats - Ver la lista de grupos/canales registrados\n`;

    helpMessage += `• /drop &lt;ID_CHAT&gt; - Eliminar un grupo/canal de la base de datos\n`;

    helpMessage += `• /generate &lt;ID_CHAT&gt; - Generar enlace de invitación\n\n`;



    helpMessage += `<b>📝 Gestión de Logs:</b>\n`;

    helpMessage += `• /addlogchannel &lt;ID&gt; - Añadir un canal/grupo para logs\n`;

    helpMessage += `• /removelogchannel &lt;ID&gt; - Eliminar un canal/grupo de logs\n`;

    helpMessage += `• /listlogchannels - Ver los canales/grupos configurados\n`;

    helpMessage += `• /cancelunban &lt;ID&gt; - Cancelar una solicitud de desbaneo\n\n`;



    helpMessage += `<b>💡 Notas Importantes:</b>\n`;

    helpMessage += `• El gban puede aplicarse por ID o @username\n`;

    helpMessage += `• Los gbans pendientes se ejecutan automáticamente cuando el usuario envía un mensaje\n`;

    helpMessage += `• Puedes forzar la ejecución con /retrygban\n`;

    helpMessage += `• Los desbaneos requieren aprobación de un segundo founder\n`;

    helpMessage += `• <b>Siempre incluir una razón clara al realizar un gban</b>\n`;

  } else {

    helpMessage += `\n<i>🛡️ Este bot ayuda a mantener los grupos libres de spam y usuarios problemáticos mediante un sistema de baneo global.</i>\n`;

    helpMessage += `<i>Si tienes un grupo con spam, agrega este bot como administrador con permisos para banear usuarios.</i>`;

  }



  // Información general del bot

  helpMessage += `\n<b>📈 Estadísticas del Bot:</b>\n`;



  // Obtener estadísticas de la base de datos

  try {

    const [gbanCount, pendingCount, chatCount] = await Promise.all([

      new Promise((resolve) => {

        db.get('SELECT COUNT(*) as count FROM gbans', [], (err, row) => {

          if (err) resolve(0);

          else resolve(row?.count || 0);

        });

      }),

      new Promise((resolve) => {

        db.get('SELECT COUNT(*) as count FROM pending_gbans', [], (err, row) => {

          if (err) resolve(0);

          else resolve(row?.count || 0);

        });

      }),

      new Promise((resolve) => {

        db.get('SELECT COUNT(*) as count FROM chats', [], (err, row) => {

          if (err) resolve(0);

          else resolve(row?.count || 0);

        });

      })

    ]);



    helpMessage += `• Usuarios baneados: <b>${gbanCount}</b>\n`;

    helpMessage += `• Grupos protegidos: <b>${chatCount}</b>\n`;



    if (isAdmin) {

      helpMessage += `• Gbans pendientes: <b>${pendingCount}</b>\n`;



      // Agregar número de solicitudes de desbaneo pendientes

      const pendingUnbansCount = pendingUnbans.size;

      if (pendingUnbansCount > 0) {

        helpMessage += `• Desbanos pendientes de aprobación: <b>${pendingUnbansCount}</b>\n`;

      }

    }

  } catch (error) {

    console.error('Error al obtener estadísticas:', error);

    helpMessage += `• Error al obtener estadísticas\n`;

  }



  helpMessage += `\n<i>💬 Usa los comandos para gestionar el sistema de gbans de forma segura y eficiente.</i>`;



  await ctx.reply(helpMessage, {

    parse_mode: 'HTML',

    disable_web_page_preview: true

  });

});



// Middleware para registrar grupos al recibir mensajes

bot.on(['channel_post', 'message'], async (ctx, next) => {

  // Solo procesar si es un mensaje nuevo y hay información del chat

  if (!ctx.chat) return next();



  // Solo procesar grupos y canales, ignorar privados

  if (!['group', 'supergroup', 'channel'].includes(ctx.chat.type)) return next();



  // Registrar o actualizar información del chat

  const chatId = String(ctx.chat.id);

  const chatName = ctx.chat.title || 'Sin Nombre';



  const saved = await upsertChat(chatId, chatName);

  if (saved) {

    console.log(`Chat actualizado: ${chatName} [${chatId}]`);

  }



  return next();

});



// Middleware para detectar cuando el bot es agregado o removido de un grupo

bot.on('my_chat_member', async (ctx) => {

  const chat = ctx.chat;

  

  // Ignorar chats privados

  if (!['group', 'supergroup', 'channel'].includes(chat.type)) return;

  

  const newStatus = ctx.update.my_chat_member.new_chat_member.status;



  if (['member', 'administrator'].includes(newStatus)) {

    // Bot fue agregado o promovido

    const chatId = String(chat.id);

    const chatName = chat.title || chat.username || 'Sin Nombre';



    try {

      const saved = await upsertChat(chatId, chatName);

      if (!saved) {

        console.error('No se pudo registrar el chat en la base de datos.');

        return;

      }

      console.log(`Nuevo chat registrado: ${chatName} [${chatId}]`);

      // Notificar en los canales de logs

      try {

        await sendToLogChannels(

          `📥 #NUEVO_CHAT\n` +

          `• Nombre: ${chatName}\n` +

          `• ID: ${chatId}\n` +

          `• Tipo: ${chat.type}`

        );

      } catch (error) {

        console.error('Error al enviar notificación:', error);

      }

    } catch (error) {

      console.error('Error al registrar nuevo chat:', error);

    }

  } else if (newStatus === 'left' || newStatus === 'kicked') {

    // Bot fue removido

    const chatId = String(chat.id);

    db.run('DELETE FROM chats WHERE chat_id = ?', [chatId], (err) => {

      if (err) {

        console.error('Error al eliminar chat:', err);

      } else {

        console.log(`Chat eliminado: ${chat.title || chat.username || chatId}`);

      }

    });

  }

});



// Middleware para detectar usuarios con gban al unirse

bot.on('new_chat_members', async (ctx) => {

  // Ignorar si no es un grupo o supergrupo

  if (!['group', 'supergroup'].includes(ctx.chat.type)) return;

  

  const newMembers = ctx.message.new_chat_members;

  

  for (const member of newMembers) {

    // Verificar si el usuario tiene gban

    db.get('SELECT * FROM gbans WHERE user_id = ?', [member.id], async (err, ban) => {

      if (err) {

        console.error('Error al verificar gban:', err);

        return;

      }



      if (ban) {

        try {

          // Banear al usuario

          await ctx.banChatMember(member.id);

          

          // Notificar en el grupo

          await ctx.reply(

            `⛔️ Usuario ${member.username ? '@' + member.username : member.id} baneado automáticamente.\n` +

            `Razón: Usuario en lista de gbans\n` +

            `Motivo original: ${ban.reason}`

          );

          

          // Registrar en logs

          await sendToLogChannels(

            `🚫 #AUTOBAN\n` +

            `• Usuario: ${member.username ? '@' + member.username : ''} [${member.id}]\n` +

            `• Grupo: ${ctx.chat.title} [${ctx.chat.id}]\n` +

            `• Razón original: ${ban.reason}\n` +

            `#id${member.id}`,

            { parse_mode: 'HTML' }

          );

        } catch (err) {

          console.error('Error al ejecutar autoban:', err);

        }

      }

    });

  }



  // Continuar con el registro normal del chat

  const chatId = String(ctx.chat.id);

  const chatName = ctx.chat.title || ctx.chat.username || 'Sin Nombre';

  

  await upsertChat(chatId, chatName);

});



// Comando /ginfo solo para IDs

bot.command('ginfo', async (ctx) => {

    const args = ctx.message.text.split(' ').slice(1);

    const userId = args[0];

  

    if (!userId || isNaN(userId)) {

      return ctx.reply('Uso: /ginfo <user_id>\n\n🔹 Asegúrate de ingresar un ID válido (solo números).');

    }

  

    // Consultar ambas tablas: gbans y pending_gbans

    const [gbanInfo, pendingInfo] = await Promise.all([

        new Promise((resolve) => {

            db.get('SELECT * FROM gbans WHERE user_id = ?', [userId], (err, row) => {

                if (err) {

                    console.error('Error al consultar la base de datos gbans:', err);

                    resolve(null);

                }

                resolve(row);

            });

        }),

        new Promise((resolve) => {

            db.get('SELECT * FROM pending_gbans WHERE user_id = ?', [userId], (err, row) => {

                if (err) {

                    console.error('Error al consultar la base de datos pending_gbans:', err);

                    resolve(null);

                }

                resolve(row);

            });

        })

    ]);



    if (!gbanInfo && !pendingInfo) {

        return ctx.reply(`ℹ️ El usuario con ID ${userId} no tiene un gban registrado ni pendiente.`);

    }



    // Obtener información adicional del usuario si es posible

    let userInfo;

    try {

        userInfo = await bot.telegram.getChat(userId);

    } catch (err) {

        userInfo = null;

    }

      

    // Crear mensaje enriquecido según si es gban activo o pendiente

    let mensaje;

    

    if (gbanInfo) {

        // Formatear fecha para gban activo
        const fechaFormateada = formatDateUY(gbanInfo.timestamp);



        mensaje = 

            `🚫 <b>Información del Gban (ACTIVO)</b>\n\n` +

            `👤 <b>Usuario:</b> <a href="tg://user?id=${userId}">${escapeHTML(userInfo ? userInfo.first_name || 'Desconocido' : 'Ver perfil')}</a>\n` +

            (userInfo?.username ? `🔹 <b>Username:</b> @${userInfo.username}\n` : '') +

            `🆔 <b>ID:</b> <code>${userId}</code>\n\n` +

            `📝 <b>Razón:</b> <code>${escapeHTML(gbanInfo.reason)}</code>\n` +

            `⏱️ <b>Fecha:</b> <code>${fechaFormateada}</code>\n` +

            `👮 <b>Baneado por:</b> <a href="tg://user?id=${gbanInfo.banned_by}">Ver perfil</a>\n\n` +

            `#gban #id${userId}`;

    } else if (pendingInfo) {

        // Formatear fecha para gban pendiente
        const fechaFormateada = formatDateUY(pendingInfo.timestamp);



        mensaje = 

            `⚠️ <b>Información del Gban (PENDIENTE)</b>\n\n` +

            `👤 <b>Usuario:</b> <a href="tg://user?id=${userId}">${escapeHTML(userInfo ? userInfo.first_name || 'Desconocido' : 'Ver perfil')}</a>\n` +

            (userInfo?.username ? `🔹 <b>Username:</b> @${userInfo.username}\n` : '') +

            `🆔 <b>ID:</b> <code>${userId}</code>\n\n` +

            `📝 <b>Razón:</b> <code>${escapeHTML(pendingInfo.reason)}</code>\n` +

            `⏱️ <b>Solicitado:</b> <code>${fechaFormateada}</code>\n` +

            `👮 <b>Solicitado por:</b> <a href="tg://user?id=${pendingInfo.banned_by}">Ver perfil</a>\n\n` +

            `<i>Este gban se ejecutará cuando el usuario envíe un mensaje</i>\n\n` +

            `#gban_pendiente #id${userId}`;

    }



    await ctx.reply(mensaje, { 

        parse_mode: 'HTML',

        disable_web_page_preview: true

    });

});



// La función resolveUser ahora está en utils/helpers.js



// Cola global para manejar gbans secuencialmente

const gbanQueue = [];

let isProcessingQueue = false;



// Agregar función para procesar la cola de gbans

async function processGbanQueue() {

  if (isProcessingQueue || gbanQueue.length === 0) return;

  

  isProcessingQueue = true;

  console.log(`Procesando cola de gbans. Tamaño actual: ${gbanQueue.length}`);

  

  try {

    const task = gbanQueue[0];

    await task.execute();

  } catch (error) {

    console.error("Error al procesar tarea de la cola:", error);

  } finally {

    gbanQueue.shift(); // Eliminar la tarea completada

    isProcessingQueue = false;

    

    // Si hay más tareas en la cola, continuar procesando

    if (gbanQueue.length > 0) {

      setTimeout(processGbanQueue, 500);

    }

  }

}



// Agregar función para encolar un nuevo gban

function enqueueGban(task) {

  return new Promise((resolve, reject) => {

    gbanQueue.push({

      execute: async () => {

        try {

          const result = await task();

          resolve(result);

        } catch (error) {

          reject(error);

        }

      }

    });

    

    // Si no hay procesamiento activo, iniciar la cola

    if (!isProcessingQueue) {

      processGbanQueue();

    }

  });

}



// La función calculateUpdateInterval ahora está en utils/helpers.js



// Modificar el comando /gban

bot.command('gban', async (ctx) => {

    if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');

  

    const args = ctx.message.text.split(' ').slice(1);

    const identifier = args[0];

    const reason = args.slice(1).join(' ') || 'Sin razón especificada';

  

    if (!identifier) return ctx.reply('Uso: /gban <user_id> <razón>');

  

    // Verificar si el target es un founder

    if (isUserFounder(identifier.replace('@', ''))) {

        return ctx.reply('❌ No puedo ejecutar esa acción sobre un founder.\n¡Los founders están protegidos!');

    }



    // Enviar mensaje de procesamiento

    const processingMsg = await ctx.reply('⏳ Verificando usuario y añadiendo a la cola de gban...');

    

    const user = await resolveUser(bot, identifier);

    

    // Verificar si el usuario ya está gbaneado o tiene un gban pendiente

    const [isGbanned, hasPendingGban] = await Promise.all([

        new Promise((resolve) => {

            db.get('SELECT * FROM gbans WHERE user_id = ?', [user ? user.id : identifier], (err, row) => {

                if (err) {

                    console.error('Error al verificar gban:', err);

                    resolve(false);

                }

                resolve(!!row);

            });

        }),

        new Promise((resolve) => {

            db.get('SELECT * FROM pending_gbans WHERE user_id = ?', [user ? user.id : identifier], (err, row) => {

                if (err) {

                    console.error('Error al verificar gban pendiente:', err);

                    resolve(false);

                }

                resolve(!!row);

            });

        })

    ]);



    if (isGbanned) {

        await ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            '❌ Este usuario ya tiene un gban activo.'

        );

        return;

    }



    if (hasPendingGban) {

        await ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            '❌ Este usuario ya tiene un gban pendiente.'

        );

        return;

    }

    

    // Si no se puede resolver el usuario pero es un ID válido

    if (!user && identifier.match(/^\d+$/)) {

        // Guardar solo en pending_gbans

        db.run('INSERT OR REPLACE INTO pending_gbans (user_id, reason, banned_by) VALUES (?, ?, ?)',

            [identifier, reason, ctx.from.id]);



        await ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            `⚠️ Usuario no encontrado pero registrado para gban futuro\n` +

            `• ID: ${identifier}\n` +

            `• Razón: ${reason}\n\n` +

            `El ban se aplicará automáticamente cuando el usuario sea visible para el bot.`

        );



        // Notificar en logs

        await sendToLogChannels(

            `⚠️ #GBAN_PENDIENTE\n` +

            `• ID: <code>${identifier}</code>\n` +

            `• Razón: ${escapeHTML(reason)}\n` +

            `• Por: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n` +

            `#id${identifier}`,

            { parse_mode: 'HTML' }

        );



        return;

    }



    await ctx.telegram.editMessageText(

        ctx.chat.id,

        processingMsg.message_id,

        null,

        `⏳ Usuario añadido a la cola de gban...\n` +

        `Posición en cola: ${gbanQueue.length + 1}\n\n` +

        `El proceso comenzará automáticamente.`

    );



    // Encolar el proceso de gban

    enqueueGban(async () => {

        // Actualizar mensaje con estado de procesamiento

        await ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            `⏳ Procesando gban...\nObteniendo lista de chats`

        );

        

        let banCount = 0;

        let processedCount = 0;

        

        const chats = await new Promise((resolve, reject) => {

            db.all('SELECT chat_id FROM chats', [], (err, rows) => {

                if (err) reject(err);

                else resolve(rows);

            });

        });



        const totalChats = chats.length;

        

        // Calcular intervalo adaptativo para actualizaciones

        const updateInterval = calculateUpdateInterval(totalChats);

        

        // Actualizar mensaje con el total de chats

        await ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            `⏳ Procesando gban...\nTotal: ${totalChats} chats (Actualizando cada ${updateInterval})`

        );



        let lastUpdateTime = Date.now();



        for (const row of chats) {

            try {

                await bot.telegram.banChatMember(row.chat_id, user.id);

                banCount++;

                

                // Esperar entre cada ban para evitar límites de Telegram

                await new Promise(resolve => setTimeout(resolve, BAN_DELAY));

            } catch (err) {

                console.error(`Error al banear en ${row.chat_id}:`, err.message);

            }

            

            processedCount++;

            

            // Actualizar progreso con frecuencia adaptativa y respetando mínimo tiempo entre actualizaciones

            const shouldUpdate = processedCount % updateInterval === 0 || processedCount === totalChats;

            const timeElapsed = Date.now() - lastUpdateTime;

            

            if (shouldUpdate && timeElapsed >= MIN_UPDATE_INTERVAL) {

                try {

                    await ctx.telegram.editMessageText(

                        ctx.chat.id,

                        processingMsg.message_id,

                        null,

                        `⏳ Procesando gban...\nProgreso: ${processedCount}/${totalChats} chats`

                    );

                    lastUpdateTime = Date.now();

                } catch (error) {

                    console.error('Error al actualizar mensaje de progreso:', error);

                }

            }

        }

    

        db.run('INSERT INTO gbans (user_id, reason, banned_by) VALUES (?, ?, ?)', [

            user.id,

            reason,

            ctx.from.id

        ]);

    

        await sendToLogChannels(

            `🚨 #BAN\n` +

                `• De: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n` +

                `• A: <a href="tg://user?id=${user.id}">${escapeHTML(user.first_name)}</a> ${user.username ? '@' + user.username : ''}\n` +

                `• Razón: ${escapeHTML(reason)}\n` +

                `• Total grupos/canales: ${banCount}/${totalChats}\n` +

                `#id${user.id}`,

            { parse_mode: 'HTML' }

        );

    

        // Mensaje final con resultados

        await ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            `✅ <b>Gban completado exitosamente</b>\n\n` +

            `👤 <b>Usuario:</b> <a href="tg://user?id=${user.id}">${escapeHTML(user.first_name)}</a>\n` +

            (user.last_name ? `• Apellido: ${escapeHTML(user.last_name)}\n` : '') +

            (user.username ? `• Username: @${user.username}\n` : '') +

            `• ID: <code>${user.id}</code>\n\n` +

            `🔨 <b>Detalles del ban:</b>\n` +

            `• Baneado en: ${banCount}/${totalChats} grupos\n` +

            `• Fecha: ${new Date().toLocaleString('es')}\n` +

            `• Por: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n\n` +

            `📝 <b>Razón:</b> ${escapeHTML(reason)}`,

            { parse_mode: 'HTML' }

        );



        return { success: true, banCount, totalChats };

    }).catch(error => {

        console.error('Error en el proceso de gban:', error);

        ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            `❌ Error al procesar el gban: ${error.message}`

        );

    });

});



// Modificar el comando /multigban

bot.command('multigban', async (ctx) => {

    if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');



    // Verificar si es respuesta a un mensaje

    if (!ctx.message.reply_to_message) {

        return ctx.reply('❌ Debes responder a un mensaje que contenga el motivo del gban.');

    }



    const reason = ctx.message.reply_to_message.text;

    if (!reason) {

        return ctx.reply('❌ El mensaje al que respondes debe contener el motivo del gban.');

    }



    // Obtener IDs de usuarios (puede ser una por línea o separadas por espacios)

    let args = ctx.message.text.split(/[\s\n]+/).slice(1);

    if (args.length === 0) {

        return ctx.reply('Uso: /multigban <id1> <id2> <id3> ...\nPuede ser una ID por línea.');

    }



    // Filtrar IDs de founders antes de procesar

    const protectedIds = args.filter(id => isUserFounder(id));

    if (protectedIds.length > 0) {

        await ctx.reply(

            '❌ Detecté IDs de founders en la lista. No puedo procesar:\n' +

            protectedIds.join('\n') +

            '\n\nLos founders están protegidos.'

        );

        // Remover IDs de founders de args

        args = args.filter(id => !isUserFounder(id));

        if (args.length === 0) return;

    }



    // Mensaje inicial de procesamiento

    const processingMsg = await ctx.reply(`⏳ Verificando usuarios y añadiendo a la cola de gban...\nTotal: ${args.length} usuarios`);

    

    // Añadir el multigban a la cola

    enqueueGban(async () => {

        // Obtener todos los chats primero

        const chats = await new Promise((resolve, reject) => {

            db.all('SELECT chat_id FROM chats', [], (err, rows) => {

                if (err) reject(err);

                else resolve(rows);

            });

        });



        const totalChats = chats.length;

        const totalUsers = args.length;

        let successUsers = [];

        let failedUsers = [];

        let currentUser = 0;



        // Calcular intervalo adaptativo para actualizaciones

        const userUpdateInterval = Math.max(1, Math.ceil(totalUsers / 10)); // Máximo 10 actualizaciones para usuarios

        let lastUpdateTime = Date.now();



        await ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            `⏳ Procesando gban múltiple...\n` +

            `Total: ${totalUsers} usuarios - ${totalChats} chats por usuario\n` +

            `Progreso: 0/${totalUsers} usuarios`

        );



        // Procesar cada usuario

        for (const userId of args) {

            currentUser++;

            if (!userId.match(/^\d+$/)) {

                failedUsers.push(`${userId} (ID inválida)`);

                continue;

            }



            try {

                const user = await resolveUser(bot, userId);

                if (!user) {

                    failedUsers.push(`${userId} (No encontrado)`);

                    continue;

                }



                // Verificar si ya tiene gban

                const isAlreadyBanned = await new Promise((resolve) => {

                    db.get('SELECT 1 FROM gbans WHERE user_id = ?', [user.id], (err, row) => {

                        resolve(!!row);

                    });

                });



                if (isAlreadyBanned) {

                    failedUsers.push(`${user.username ? '@' + user.username : user.id} (Ya tiene gban)`);

                    continue;

                }



                let banCount = 0;

                // Banear en todos los chats

                for (const chat of chats) {

                    try {

                        await bot.telegram.banChatMember(chat.chat_id, user.id);

                        banCount++;

                        await new Promise(resolve => setTimeout(resolve, BAN_DELAY)); // Delay para evitar límites

                    } catch (err) {

                        console.error(`Error al banear ${user.id} en ${chat.chat_id}:`, err.message);

                    }

                }



                // Registrar en la base de datos

                db.run('INSERT OR REPLACE INTO gbans (user_id, reason, banned_by) VALUES (?, ?, ?)', [

                    user.id,

                    reason,

                    ctx.from.id

                ]);



                // Notificar en el canal de logs

                await sendToLogChannels(

                    `🚨 #MULTIGBAN\n` +

                    `• Usuario: <a href="tg://user?id=${user.id}">${escapeHTML(user.first_name)}</a> ${user.username ? '@' + user.username : ''}\n` +

                    `• Baneado en: ${banCount}/${totalChats} grupos\n` +

                    `• Razón: ${escapeHTML(reason)}\n` +

                    `• Por: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n` +

                    `#id${user.id}`,

                    { parse_mode: 'HTML' }

                );



                successUsers.push(`${user.username ? '@' + user.username : user.id} (${banCount}/${totalChats})`);



                // Actualizar mensaje de progreso con frecuencia adaptativa

                const shouldUpdate = currentUser % userUpdateInterval === 0 || currentUser === totalUsers;

                const timeElapsed = Date.now() - lastUpdateTime;

                

                if (shouldUpdate && timeElapsed >= MIN_UPDATE_INTERVAL) {

                    try {

                        await ctx.telegram.editMessageText(

                            ctx.chat.id,

                            processingMsg.message_id,

                            null,

                            `⏳ Procesando gban múltiple...\n` +

                            `Total: ${totalUsers} usuarios - ${totalChats} chats por usuario\n` +

                            `Progreso: ${currentUser}/${totalUsers} usuarios`

                        );

                        lastUpdateTime = Date.now();

                    } catch (error) {

                        console.error('Error al actualizar mensaje de progreso:', error);

                    }

                }



            } catch (err) {

                console.error(`Error procesando usuario ${userId}:`, err);

                failedUsers.push(userId);

            }

        }



        // Mensaje final con resultados

        let finalMessage = `✅ <b>Proceso de gban múltiple completado</b>\n\n`;

        if (successUsers.length > 0) {

            finalMessage += `✅ <b>Usuarios baneados exitosamente:</b>\n${successUsers.join('\n')}\n\n`;

        }

        if (failedUsers.length > 0) {

            finalMessage += `❌ <b>Usuarios que fallaron:</b>\n${failedUsers.join('\n')}\n\n`;

        }

        finalMessage += `📝 <b>Razón:</b> ${escapeHTML(reason)}`;



        await ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            finalMessage,

            { parse_mode: 'HTML' }

        );



        return { success: true, totalProcessed: args.length };

    }).catch(error => {

        console.error('Error en el proceso de multigban:', error);

        ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            `❌ Error al procesar el multigban: ${error.message}`

        );

    });

});



// También modificar el comando /ungban para usar la optimización

// Sistema de aprobación para desbaneos pendientes

const pendingUnbans = new Map(); // userId -> {requester, timestamp, timerId, chatId, messageId}



// Función para limpiar desbaneo pendiente después de expirar

function clearPendingUnban(userId) {

  const pendingData = pendingUnbans.get(userId);

  if (!pendingData) return;

  

  // Limpiar el timer si existe

  if (pendingData.timerId) {

    clearTimeout(pendingData.timerId);

  }

  

  // Editar el mensaje original para indicar que expiró

  if (pendingData.chatId && pendingData.messageId) {

    bot.telegram.editMessageText(

      pendingData.chatId,

      pendingData.messageId,

      null,

      `⌛ El tiempo para aprobar el desbaneo de ID ${userId} ha expirado.`,

      { parse_mode: 'HTML' }

    ).catch(err => console.error('Error al actualizar mensaje de desbaneo expirado:', err));

  }

  

  pendingUnbans.delete(userId);

}



// Modificar el comando /ungban para requerir aprobación

bot.command('ungban', async (ctx) => {

    if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');

  

    const args = ctx.message.text.split(' ').slice(1);

    const identifier = args[0];

  

    if (!identifier) return ctx.reply('Uso: /ungban <user_id|@username>');



    // Enviar mensaje de procesamiento

    const processingMsg = await ctx.reply('⏳ Verificando usuario...');

  

    const user = await resolveUser(bot, identifier);

    const userId = user ? user.id : identifier;



    // Verificar en ambas tablas

    const [gbanInfo, pendingInfo] = await Promise.all([

        new Promise((resolve) => {

            db.get('SELECT * FROM gbans WHERE user_id = ?', [userId], (err, row) => {

                if (err) {

                    console.error('Error al consultar gbans:', err);

                    resolve(null);

                }

                resolve(row);

            });

        }),

        new Promise((resolve) => {

            db.get('SELECT * FROM pending_gbans WHERE user_id = ?', [userId], (err, row) => {

                if (err) {

                    console.error('Error al consultar pending_gbans:', err);

                    resolve(null);

                }

                resolve(row);

            });

        })

    ]);



    if (!gbanInfo && !pendingInfo) {

        await ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            `ℹ️ El usuario ${user ? (user.username ? `@${user.username}` : user.id) : identifier} no tiene un gban activo ni pendiente.`

        );

        return;

    }



    // Verificar si ya hay una solicitud pendiente para este usuario

    if (pendingUnbans.has(userId)) {

        const pendingData = pendingUnbans.get(userId);

        

        // Si el mismo founder intenta aprobar su propia solicitud

        if (pendingData.requester === ctx.from.id) {

            await ctx.telegram.editMessageText(

                ctx.chat.id,

                processingMsg.message_id,

                null,

                `⚠️ Ya has solicitado el desbaneo de este usuario. Espera a que otro founder lo apruebe.`

            );

            return;

        }

        

        // Otro founder está aprobando

        await ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            `✅ Has aprobado el desbaneo solicitado por otro founder. Procesando...`

        );



        // Limpiar datos de aprobación pendiente

        clearPendingUnban(userId);

        

        // Continuar con el proceso de ungban

        await executeUngban(ctx, user, userId, gbanInfo, pendingInfo);

        return;

    }



    // Creamos una nueva solicitud de desbaneo
    // Crear timer para expirar la solicitud

    const timerId = setTimeout(() => clearPendingUnban(userId), APPROVAL_TIMEOUT);

    

    // Guardar datos de la solicitud

    pendingUnbans.set(userId, {

        requester: ctx.from.id,

        timestamp: Date.now(),

        timerId: timerId,

        chatId: ctx.chat.id,

        messageId: processingMsg.message_id

    });

    

    // Calcular tiempo de expiración

    const expirationTime = new Date(Date.now() + APPROVAL_TIMEOUT);

    const expirationString = expirationTime.toLocaleString('es', {

        hour: '2-digit',

        minute: '2-digit'

    });



    // Mensaje para solicitar aprobación

    await ctx.telegram.editMessageText(

        ctx.chat.id,

        processingMsg.message_id,

        null,

        `⏳ <b>Se requiere aprobación para desbaneo</b>\n\n` +

        `• Usuario a desbanear: ${user ? (user.username ? `@${user.username}` : `ID ${user.id}`) : `ID ${userId}`}\n` +

        `• Solicitado por: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n\n` +

        `<b>Se requiere que otro founder ejecute:</b>\n` +

        `/ungban ${userId}\n\n` +

        `Esta solicitud expirará a las ${expirationString}.`,

        { parse_mode: 'HTML' }

    );

    

    // Notificar en el canal de logs

    await sendToLogChannels(

        `⏳ #SOLICITUD_UNBAN\n` +

        `• De: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n` +

        `• Usuario: ${user ? (user.username ? `@${user.username}` : '') : ''} [${userId}]\n` +

        `• Expira: ${expirationString}\n` +

        `#id${userId}`,

        { parse_mode: 'HTML' }

    );

});



// Función para ejecutar el unban una vez aprobado

async function executeUngban(ctx, user, userId, gbanInfo, pendingInfo) {

    // Enviar mensaje de procesamiento

    const processingMsg = await ctx.reply('⏳ Usuario aprobado para desbaneo. Añadiendo a la cola de procesamiento...');

    

    await ctx.telegram.editMessageText(

        ctx.chat.id,

        processingMsg.message_id,

        null,

        `⏳ Usuario añadido a la cola de desbaneo...\n` +

        `Posición en cola: ${gbanQueue.length + 1}\n\n` +

        `El proceso comenzará automáticamente.`

    );



    // Encolar el proceso de ungban

    enqueueGban(async () => {

        // Si hay un gban pendiente, eliminarlo

        if (pendingInfo) {

            await new Promise((resolve, reject) => {

                db.run('DELETE FROM pending_gbans WHERE user_id = ?', [userId], (err) => {

                    if (err) reject(err);

                    else resolve();

                });

            });



            await sendToLogChannels(

                `🚨 #UNBAN_PENDIENTE\n` +

                `• De: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n` +

                `• A: ID ${userId}\n` +

                `• Razón original del gban: ${escapeHTML(pendingInfo.reason)}\n` +

                `#id${userId}`,

                { parse_mode: 'HTML' }

            );

        }



        // Si hay un gban activo, proceder con el desbaneo

        if (gbanInfo) {

            let unbanCount = 0;

            let processedCount = 0;



            const chats = await new Promise((resolve, reject) => {

                db.all('SELECT chat_id FROM chats', [], (err, rows) => {

                    if (err) reject(err);

                    else resolve(rows);

                });

            });



            const totalChats = chats.length;

            

            // Calcular intervalo adaptativo para actualizaciones

            const updateInterval = calculateUpdateInterval(totalChats);

            let lastUpdateTime = Date.now();

            const MIN_UPDATE_INTERVAL = 3000; // Mínimo 3 segundos entre actualizaciones



            // Actualizar mensaje con progreso

            await ctx.telegram.editMessageText(

                ctx.chat.id,

                processingMsg.message_id,

                null,

                `⏳ Procesando desbaneo...\nTotal: ${totalChats} chats (Actualizando cada ${updateInterval})`

            );



            // Proceso de desbaneo en chats

            for (const chat of chats) {

                try {

                    await bot.telegram.unbanChatMember(chat.chat_id, userId);

                    unbanCount++;

                    await new Promise(resolve => setTimeout(resolve, BAN_DELAY));

                } catch (err) {

                    console.error(`Error al desbanear en ${chat.chat_id}:`, err.message);

                }

                processedCount++;



                // Actualizar progreso con frecuencia adaptativa y respetando mínimo tiempo entre actualizaciones

                const shouldUpdate = processedCount % updateInterval === 0 || processedCount === totalChats;

                const timeElapsed = Date.now() - lastUpdateTime;

                

                if (shouldUpdate && timeElapsed >= MIN_UPDATE_INTERVAL) {

                    try {

                        await ctx.telegram.editMessageText(

                            ctx.chat.id,

                            processingMsg.message_id,

                            null,

                            `⏳ Procesando desbaneo...\nProgreso: ${processedCount}/${totalChats} chats`

                        );

                        lastUpdateTime = Date.now();

                    } catch (error) {

                        console.error('Error al actualizar mensaje de progreso:', error);

                    }

                }

            }



            // Eliminar de la tabla gbans

            await new Promise((resolve, reject) => {

                db.run('DELETE FROM gbans WHERE user_id = ?', [userId], (err) => {

                    if (err) reject(err);

                    else resolve();

                });

            });



            await sendToLogChannels(

                `🚨 #UNBAN\n` +

                `• De: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n` +

                `• A: ${user ? `<a href="tg://user?id=${user.id}">${escapeHTML(user.first_name)}</a>` : `ID ${userId}`} ${user?.username ? '@' + user.username : ''}\n` +

                `• Total grupos/canales: ${unbanCount}/${totalChats}\n` +

                `• <b>Aprobado por múltiples founders</b>\n` +

                `#id${userId}`,

                { parse_mode: 'HTML' }

            );

        }



        // Mensaje final con resultados

        const mensaje = pendingInfo && gbanInfo ? 

            `✅ Usuario removido de la lista de gbans y gbans pendientes` :

            pendingInfo ? 

            `✅ Usuario removido de la lista de gbans pendientes` :

            `✅ Usuario desbaneado de todos los grupos`;



        await ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            `${mensaje}\n• Usuario: ${user ? (user.username ? `@${user.username}` : user.id) : userId}`

        );



        return { success: true };

    }).catch(error => {

        console.error('Error en el proceso de ungban:', error);

        ctx.telegram.editMessageText(

            ctx.chat.id,

            processingMsg.message_id,

            null,

            `❌ Error al procesar el ungban: ${error.message}`

        );

    });

}



// Comando adicional para ver solicitudes de ungban pendientes

bot.command('pendingapprovals', async (ctx) => {

    if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');



    if (pendingUnbans.size === 0) {

        return ctx.reply('✅ No hay solicitudes de desbaneo pendientes.');

    }



    let message = `🕒 <b>Solicitudes de desbaneo pendientes</b>\n\n`;

    let count = 0;



    for (const [userId, data] of pendingUnbans.entries()) {

        count++;

        const requesterName = await bot.telegram.getChat(data.requester)

            .then(chat => escapeHTML(chat.first_name))

            .catch(() => "Unknown");

        

        const creationTime = formatDateShort(data.timestamp);



        const timeLeft = Math.round((data.timestamp + 15 * 60 * 1000 - Date.now()) / 60000); // minutos restantes

        

        // Intentar obtener información del usuario si es posible

        let userInfo = "ID: " + userId;

        try {

            const user = await bot.telegram.getChat(userId);

            userInfo = user.username ? 

                `@${user.username}` : 

                `${escapeHTML(user.first_name)} [${userId}]`;

        } catch (err) {

            // Si no se puede obtener, usar solo el ID

        }

        

        message += `${count}. <b>Usuario:</b> ${userInfo}\n`;

        message += `   <b>Solicitado por:</b> ${requesterName}\n`;

        message += `   <b>Hora:</b> ${creationTime} (${timeLeft} min. restantes)\n`;

        message += `   <b>Aprobar con:</b> /ungban ${userId}\n\n`;

    }



    await ctx.reply(message, { parse_mode: 'HTML' });

});



// Comando para cancelar una solicitud de ungban pendiente

bot.command('cancelunban', async (ctx) => {

    if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');

    

    const args = ctx.message.text.split(' ').slice(1);

    const userId = args[0];

    

    if (!userId) {

        return ctx.reply('Uso: /cancelunban <user_id>\n\n🔹 Debes proporcionar la ID del usuario.');

    }

    

    if (!pendingUnbans.has(userId)) {

        return ctx.reply('❌ No existe una solicitud de desbaneo pendiente para este usuario.');

    }

    

    // Si no es el mismo founder que lo solicitó y no es una cancelación forzada

    const forceCancellation = args[1] === "force";

    const pendingData = pendingUnbans.get(userId);

    

    if (pendingData.requester !== ctx.from.id && !forceCancellation) {

        return ctx.reply(

            '⚠️ Solo el founder que solicitó el desbaneo puede cancelarlo.\n\n' +

            'Si es necesario, puedes usar:\n/cancelunban ' + userId + ' force'

        );

    }

    

    // Limpiar el pendiente

    clearPendingUnban(userId);

    

    // Notificar en el canal de logs

    await sendToLogChannels(

        `🚫 #CANCELACION_UNBAN\n` +

        `• De: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n` +

        `• Usuario: ID ${userId}\n` +

        `• Tipo: ${forceCancellation ? 'Forzada' : 'Normal'}\n` +

        `#id${userId}`,

        { parse_mode: 'HTML' }

    );

    

    await ctx.reply(`✅ Solicitud de desbaneo para el usuario ${userId} cancelada correctamente.`);

});



// Comando /listchats

bot.command('listchats', async (ctx) => {

  if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');



  db.all('SELECT chat_name, chat_id FROM chats', [], (err, rows) => {

    if (err) {

      console.error('Error al obtener la lista de chats:', err);

      return ctx.reply('❌ Error al obtener la lista de chats.');

    }



    if (rows.length === 0) {

      return ctx.reply('No hay grupos o canales registrados.');

    }



    const chatList = rows

      .map((row) => `• ${row.chat_name} [${row.chat_id}]`)

      .join('\n');



    ctx.reply(`📋 Lista de grupos/canales registrados:\n${chatList}`);

  });

});



// Comando /drop para eliminar un grupo/canal específico

bot.command('drop', async (ctx) => {

  if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');



  const args = ctx.message.text.split(' ').slice(1);

  const chatId = args[0];



  if (!chatId) {

    return ctx.reply('Uso: /drop <chat_id>\n\nProporciona el ID del grupo/canal que deseas eliminar.');

  }



  db.get('SELECT chat_name FROM chats WHERE chat_id = ?', [chatId], async (err, row) => {

    if (err) {

      console.error('Error al consultar la base de datos:', err);

      return ctx.reply('❌ Error al consultar la base de datos.');

    }



    if (!row) {

      return ctx.reply('❌ No se encontró ningún grupo/canal con ese ID en la base de datos.');

    }



    db.run('DELETE FROM chats WHERE chat_id = ?', [chatId], async (err) => {

      if (err) {

        console.error('Error al eliminar el chat:', err);

        return ctx.reply('❌ Error al eliminar el chat de la base de datos.');

      }



      // Notificar en el canal de logs

      try {

        await sendToLogChannels(

          `🗑️ #CHAT_ELIMINADO\n` +

          `• Nombre: ${row.chat_name}\n` +

          `• ID: ${chatId}\n` +

          `• Eliminado por: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>`,

          { parse_mode: 'HTML' }

        );

      } catch (error) {

        console.error('Error al enviar notificación:', error);

      }



      await ctx.reply(

        `✅ Grupo/canal eliminado correctamente\n` +

        `• Nombre: ${row.chat_name}\n` +

        `• ID: ${chatId}`

      );

    });

  });

});



// Comando /who

bot.command('who', async (ctx) => {

  if (!isFounder(ctx)) {

    return ctx.reply('⛔ No tienes permiso para usar este comando.');

  }



  if (String(ctx.from.id) === '1675862381') {

    await ctx.reply('¿Quién eres? Eres Founder del bot. No te olvides poner motivo siempre que des un Gban o te chingo. CACTUS CACTUS miau miau guau');

  } else {

    await ctx.reply('¿Quién eres? Eres Founder del bot.');

  }

});



// Comando /update para agregar motivos adicionales a un gban existente

bot.command('update', async (ctx) => {

  if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');



  const args = ctx.message.text.split(' ').slice(1);

  const userId = args[0];

  const additionalReason = args.slice(1).join(' ');



  if (!userId || !additionalReason) {

    return ctx.reply('Uso: /update ID_USUARIO MOTIVO_ADICIONAL\n\n🔹 Debes proporcionar la ID del usuario y el motivo adicional.');

  }



  // Verificar si el usuario tiene un gban

  db.get('SELECT * FROM gbans WHERE user_id = ?', [userId], async (err, row) => {

    if (err) {

      console.error('Error al consultar la base de datos:', err);

      return ctx.reply('❌ Error al consultar la base de datos.');

    }



    if (!row) {

      return ctx.reply(`ℹ️ El usuario con ID ${userId} no tiene un gban registrado.`);

    }



    // Formato de la adición: "[original] | add. FOUNDER_ID: Nueva razón"

    const originalReason = row.reason;

    let newReason;

    

    // Verificar si ya tiene adiciones previas

    if (originalReason.includes(' | add.')) {

      newReason = `${originalReason} | add. ${ctx.from.id}: ${additionalReason}`;

    } else {

      newReason = `${originalReason} | add. ${ctx.from.id}: ${additionalReason}`;

    }



    // Actualizar la razón en la base de datos

    db.run('UPDATE gbans SET reason = ? WHERE user_id = ?', [newReason, userId], async function(err) {

      if (err) {

        console.error('Error al actualizar la razón del gban:', err);

        return ctx.reply('❌ Error al actualizar la información del gban.');

      }



      if (this.changes === 0) {

        return ctx.reply('❌ No se pudo actualizar el motivo del gban. Intente nuevamente.');

      }



      // Obtener información adicional del usuario si es posible

      let userInfo;

      try {

        userInfo = await bot.telegram.getChat(userId);

      } catch (err) {

        userInfo = null;

      }



      // Notificar en el canal de logs

      await sendToLogChannels(

        `🔄 #UPDATE_GBAN\n` +

        `• De: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n` +

        `• Usuario: ${userInfo ? `<a href="tg://user?id=${userId}">${escapeHTML(userInfo.first_name)}</a>` : `ID ${userId}`} ${userInfo?.username ? '@' + userInfo.username : ''}\n` +

        `• Razón original: <code>${escapeHTML(originalReason)}</code>\n` +

        `• Adición: <code>${escapeHTML(additionalReason)}</code>\n` +

        `• Razón completa: <code>${escapeHTML(newReason)}</code>\n` +

        `#id${userId}`,

        { parse_mode: 'HTML' }

      );



      // Notificar en el chat

      await ctx.reply(

        `✅ Motivo de gban actualizado correctamente\n` +

        `• Usuario: ${userInfo?.username ? '@' + userInfo.username : userId}\n` +

        `• Adición: ${additionalReason}`

      );

    });

  });

});



// Función helper para verificar y ejecutar gbans

async function checkAndExecuteGban(ctx, userId, username) {

  return new Promise((resolve) => {

    db.get('SELECT * FROM gbans WHERE user_id = ?', [userId], async (err, ban) => {

      if (err) {

        console.error('Error al verificar gban:', err);

        return resolve(false);

      }



      if (ban) {

        try {

          // Banear al usuario

          await ctx.banChatMember(userId);

          

          // Notificar en el grupo

          await ctx.reply(

            `⛔️ Usuario ${username ? '@' + username : userId} baneado automáticamente.\n` +

            `Razón: Usuario en lista de gbans\n` +

            `Motivo original: ${ban.reason}`

          );

          

          // Registrar en logs

          await sendToLogChannels(

            `🚫 #AUTOBAN_MESSAGE\n` +

            `• Usuario: <a href="tg://user?id=${userId}">${escapeHTML(ctx.from.first_name)}</a> ${username ? '@' + username : ''}\n` +

            `• Grupo: ${ctx.chat.title} [${ctx.chat.id}]\n` +

            `• Razón original: ${ban.reason}\n` +

            `#id${userId}`,

            { parse_mode: 'HTML' }

          );

          return resolve(true);

        } catch (err) {

          console.error('Error al ejecutar autoban:', err);

          return resolve(false);

        }

      }

      resolve(false);

    });

  });

}



// Middleware para monitorear mensajes

bot.on('message', async (ctx, next) => {

  // Ignorar mensajes de bots

  if (ctx.from.is_bot) return next();

  

  // Ignorar mensajes de canales

  if (!ctx.from) return next();

  

  // Ignorar si es un comando

  if (ctx.message.text && ctx.message.text.startsWith('/')) return next();

  

  // Verificar gban

  const wasGbanned = await checkAndExecuteGban(

    ctx,

    ctx.from.id,

    ctx.from.username

  );

  

  // Si no estaba gbaneado, continuar con el siguiente middleware

  if (!wasGbanned) return next();

});



// Modificar el middleware de mensajes con mejor manejo de timeouts

bot.on(['message', 'channel_post'], async (ctx, next) => {

  if (!ctx.from || ctx.from.is_bot) return next();

  

  const userId = String(ctx.from.id);

  

  // Verificar si es founder antes de procesar pending_gbans

  if (isUserFounder(userId)) return next();



  try {

    // Agregar timeout de 30 segundos para la consulta a la base de datos

    const pendingBan = await Promise.race([

      new Promise((resolve, reject) => {

        db.get('SELECT * FROM pending_gbans WHERE user_id = ?', [userId], (err, row) => {

          if (err) reject(err);

          else resolve(row);

        });

      }),

      new Promise((_, reject) => 

        setTimeout(() => reject(new Error('Database query timeout')), 30000)

      )

    ]);



    if (pendingBan) {

      console.log(`Ejecutando gban pendiente para usuario ${userId}`);



      let banCount = 0;

      let processedCount = 0;

      

      const chats = await Promise.race([

        new Promise((resolve, reject) => {

          db.all('SELECT chat_id FROM chats', [], (err, rows) => {

            if (err) reject(err);

            else resolve(rows);

          });

        }),

        new Promise((_, reject) => 

          setTimeout(() => reject(new Error('Database query timeout')), 30000)

        )

      ]);



      const totalChats = chats.length;



      // Banear en todos los chats con timeout por operación

      for (const row of chats) {

        try {

          await Promise.race([

            bot.telegram.banChatMember(row.chat_id, userId),

            new Promise((_, reject) => 

              setTimeout(() => reject(new Error('Ban operation timeout')), 10000)

            )

          ]);

          banCount++;

        } catch (err) {

          console.error(`Error al banear en ${row.chat_id}:`, err.message);

        }

        processedCount++;

        await new Promise(resolve => setTimeout(resolve, 100));

      }



      // Registrar en la tabla gbans cuando se ejecuta el ban

      db.run('INSERT INTO gbans (user_id, reason, banned_by, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',

        [userId, pendingBan.reason, pendingBan.banned_by]);



      // Notificar en el canal de logs

      await sendToLogChannels(

        `🚨 #GBAN_EJECUTADO\n` +

        `• Usuario: <a href="tg://user?id=${userId}">${escapeHTML(ctx.from.first_name)}</a>\n` +

        `• Baneado en: ${banCount}/${totalChats} grupos\n` +

        `• Razón: ${escapeHTML(pendingBan.reason)}\n` +

        `• Solicitado por: <a href="tg://user?id=${pendingBan.banned_by}">Founder</a>\n` +

        `#id${userId}`,

        { parse_mode: 'HTML' }

      );

      

      // Eliminar de pending_gbans una vez ejecutado

      await new Promise((resolve, reject) => {

        db.run('DELETE FROM pending_gbans WHERE user_id = ?', [userId], (err) => {

          if (err) reject(err);

          else resolve();

        });

      });



      return; // No continuamos con next() ya que el usuario será baneado

    }



    return next();

  } catch (err) {

    console.error('Error al procesar gban pendiente:', err);

    return next();

  }

});



// Agregar comando para ver el estado de la cola

bot.command('queueinfo', async (ctx) => {

    if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');

    

    const queueSize = gbanQueue.length;

    

    if (queueSize === 0 && !isProcessingQueue) {

        return ctx.reply('✅ No hay tareas pendientes en la cola de gbans.');

    }

    

    let message = `📊 <b>Estado de la cola de gbans</b>\n\n`;

    message += `• Tareas pendientes: <b>${queueSize}</b>\n`;

    message += `• Estado: <b>${isProcessingQueue ? '⚙️ Procesando' : '⏸ En espera'}</b>`;

    

    await ctx.reply(message, { parse_mode: 'HTML' });

});



// Comando /generate para generar un enlace de invitación

bot.command('generate', async (ctx) => {

  if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');



  const args = ctx.message.text.split(' ').slice(1);

  const chatId = args[0];



  if (!chatId) {

    return ctx.reply('Uso: /generate <chat_id>\n\n🔹 Debes proporcionar el ID del grupo o canal.');

  }



  // Verificar si el chat existe en la base de datos

  db.get('SELECT chat_name FROM chats WHERE chat_id = ?', [chatId], async (err, row) => {

    if (err) {

      console.error('Error al consultar la base de datos:', err);

      return ctx.reply('❌ Error al consultar la base de datos.');

    }



    if (!row) {

      return ctx.reply('❌ No se encontró ningún grupo o canal con ese ID en la base de datos.');

    }



    // Enviar mensaje de procesamiento

    const processingMsg = await ctx.reply('⏳ Generando enlace de invitación...');



    try {

      // Intentar generar un enlace de invitación

      const inviteLink = await bot.telegram.exportChatInviteLink(chatId);

      

      await ctx.telegram.editMessageText(

        ctx.chat.id,

        processingMsg.message_id,

        null,

        `✅ <b>Enlace generado con éxito</b>\n\n` +

        `• Grupo/Canal: <b>${escapeHTML(row.chat_name)}</b>\n` +

        `• ID: <code>${chatId}</code>\n\n` +

        `• Enlace: ${inviteLink}\n\n` +

        `<i>El enlace puede caducar según la configuración del grupo/canal.</i>`,

        { parse_mode: 'HTML' }

      );

      

      // Registrar en logs

      await sendToLogChannels(

        `🔗 #ENLACE_GENERADO\n` +

        `• Por: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n` +

        `• Grupo/Canal: <b>${escapeHTML(row.chat_name)}</b>\n` +

        `• ID: <code>${chatId}</code>`,

        { parse_mode: 'HTML' }

      );

      

    } catch (error) {

      console.error(`Error al generar enlace para ${chatId}:`, error);

      

      let errorMessage = `❌ <b>Error al generar el enlace</b>\n\n`;

      errorMessage += `• Grupo/Canal: <b>${escapeHTML(row.chat_name)}</b>\n`;

      errorMessage += `• ID: <code>${chatId}</code>\n\n`;

      

      if (error.description) {

        if (error.description.includes("not enough rights")) {

          errorMessage += `• Causa: El bot no tiene permisos suficientes en el grupo/canal.\n`;

          errorMessage += `• Solución: El bot debe ser administrador con permiso para invitar usuarios.`;

        } else if (error.description.includes("chat not found")) {

          errorMessage += `• Causa: El bot ya no tiene acceso al grupo/canal.\n`;

          errorMessage += `• Solución: Verifique que el bot siga dentro del grupo/canal.`;

        } else {

          errorMessage += `• Error: ${escapeHTML(error.description)}`;

        }

      } else {

        errorMessage += `• Error desconocido. Verifique los logs del sistema.`;

      }

      

      await ctx.telegram.editMessageText(

        ctx.chat.id,

        processingMsg.message_id,

        null,

        errorMessage,

        { parse_mode: 'HTML' }

      );

    }

  });

});



// Comando para reintentar ejecutar un gban pendiente

bot.command('retrygban', async (ctx) => {

    if (!isFounder(ctx)) return ctx.reply('⛔ No tienes permiso para usar este comando.');

  

    const args = ctx.message.text.split(' ').slice(1);

    const userId = args[0];

  

    if (!userId) {

        return ctx.reply('Uso: /retrygban <user_id>\n\n🔹 Debes proporcionar el ID del usuario con gban pendiente.');

    }

  

    // Verificar si existe en pending_gbans

    db.get('SELECT * FROM pending_gbans WHERE user_id = ?', [userId], async (err, pendingBan) => {

        if (err) {

            console.error('Error al consultar la base de datos:', err);

            return ctx.reply('❌ Error al consultar la base de datos.');

        }

      

        if (!pendingBan) {

            return ctx.reply(`❌ El usuario con ID ${userId} no tiene un gban pendiente.`);

        }

      

        // Enviar mensaje de procesamiento

        const processingMsg = await ctx.reply('⏳ Reintentando aplicar el gban pendiente. Añadiendo a la cola...');

      

        // Encolar el proceso de reintento de gban

        enqueueGban(async () => {

            let banCount = 0;

            let processedCount = 0;

          

            const chats = await new Promise((resolve, reject) => {

                db.all('SELECT chat_id FROM chats', [], (err, rows) => {

                    if (err) reject(err);

                    else resolve(rows);

                });

            });



            const totalChats = chats.length;

            

            // Calcular intervalo adaptativo para actualizaciones

            const updateInterval = calculateUpdateInterval(totalChats);

            

            // Actualizar mensaje con el total de chats

            await ctx.telegram.editMessageText(

                ctx.chat.id,

                processingMsg.message_id,

                null,

                `⏳ Procesando gban pendiente...\nTotal: ${totalChats} chats (Actualizando cada ${updateInterval})`

            );



            let lastUpdateTime = Date.now();

            const MIN_UPDATE_INTERVAL = 3000; // Mínimo 3 segundos entre actualizaciones



            for (const row of chats) {

                try {

                    await bot.telegram.banChatMember(row.chat_id, userId);

                    banCount++;

                    

                    // Esperar 100ms entre cada ban para evitar límites de Telegram

                    await new Promise(resolve => setTimeout(resolve, BAN_DELAY));

                } catch (err) {

                    console.error(`Error al banear en ${row.chat_id}:`, err.message);

                }

                

                processedCount++;

                

                // Actualizar progreso con frecuencia adaptativa y respetando mínimo tiempo entre actualizaciones

                const shouldUpdate = processedCount % updateInterval === 0 || processedCount === totalChats;

                const timeElapsed = Date.now() - lastUpdateTime;

                

                if (shouldUpdate && timeElapsed >= MIN_UPDATE_INTERVAL) {

                    try {

                        await ctx.telegram.editMessageText(

                            ctx.chat.id,

                            processingMsg.message_id,

                            null,

                            `⏳ Procesando gban pendiente...\nProgreso: ${processedCount}/${totalChats} chats`

                        );

                        lastUpdateTime = Date.now();

                    } catch (error) {

                        console.error('Error al actualizar mensaje de progreso:', error);

                    }

                }

            }

            

            // Intentar obtener información del usuario

            let userInfo;

            try {

                userInfo = await bot.telegram.getChat(userId);

            } catch (err) {

                userInfo = null;

            }

        

            // Verificar si se pudo banear en al menos un grupo

            if (banCount > 0) {

                // Solo mover de pending_gbans a gbans si se baneó exitosamente en al menos un grupo

                db.run('INSERT INTO gbans (user_id, reason, banned_by) VALUES (?, ?, ?)', [

                    userId,

                    pendingBan.reason,

                    pendingBan.banned_by

                ]);

                

                db.run('DELETE FROM pending_gbans WHERE user_id = ?', [userId]);

            

                await sendToLogChannels(

                    `🔄 #RETRY_GBAN_EXITOSO\n` +

                        `• De: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n` +

                        `• A: ${userInfo ? `<a href="tg://user?id=${userId}">${escapeHTML(userInfo.first_name)}</a>` : `ID ${userId}`} ${userInfo?.username ? '@' + userInfo.username : ''}\n` +

                        `• Razón: ${escapeHTML(pendingBan.reason)}\n` +

                        `• Total grupos/canales: ${banCount}/${totalChats}\n` +

                        `• Solicitado originalmente por: <a href="tg://user?id=${pendingBan.banned_by}">Ver perfil</a>\n` +

                        `• Estado: Convertido de pendiente a activo\n` +

                        `#id${userId}`,

                    { parse_mode: 'HTML' }

                );

            

                // Mensaje final con resultados positivos

                await ctx.telegram.editMessageText(

                    ctx.chat.id,

                    processingMsg.message_id,

                    null,

                    `✅ <b>Gban pendiente aplicado exitosamente</b>\n\n` +

                    `👤 <b>Usuario:</b> ${userInfo ? `<a href="tg://user?id=${userId}">${escapeHTML(userInfo.first_name)}</a>` : `ID ${userId}`}\n` +

                    (userInfo?.username ? `• Username: @${userInfo.username}\n` : '') +

                    `• ID: <code>${userId}</code>\n\n` +

                    `🔨 <b>Detalles del ban:</b>\n` +

                    `• Baneado en: ${banCount}/${totalChats} grupos\n` +

                    `• Fecha: ${new Date().toLocaleString('es')}\n` +

                    `• Por: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n\n` +

                    `📝 <b>Razón original:</b> ${escapeHTML(pendingBan.reason)}\n\n` +

                    `<b>Estado:</b> Convertido de pendiente a activo`,

                    { parse_mode: 'HTML' }

                );

            } else {

                // Si no se pudo banear en ningún grupo, mantener como pendiente

                await sendToLogChannels(

                    `⚠️ #RETRY_GBAN_FALLIDO\n` +

                        `• De: <a href="tg://user?id=${ctx.from.id}">${escapeHTML(ctx.from.first_name)}</a>\n` +

                        `• A: ${userInfo ? `<a href="tg://user?id=${userId}">${escapeHTML(userInfo.first_name)}</a>` : `ID ${userId}`} ${userInfo?.username ? '@' + userInfo.username : ''}\n` +

                        `• Razón: ${escapeHTML(pendingBan.reason)}\n` +

                        `• Total grupos/canales intentados: ${totalChats}\n` +

                        `• Solicitado originalmente por: <a href="tg://user?id=${pendingBan.banned_by}">Ver perfil</a>\n` +

                        `• Estado: Sigue pendiente\n` +

                        `#id${userId}`,

                    { parse_mode: 'HTML' }

                );

                

                // Mensaje final con resultados negativos

                await ctx.telegram.editMessageText(

                    ctx.chat.id,

                    processingMsg.message_id,

                    null,

                    `⚠️ <b>No se pudo aplicar el gban</b>\n\n` +

                    `👤 <b>Usuario:</b> ${userInfo ? `<a href="tg://user?id=${userId}">${escapeHTML(userInfo.first_name)}</a>` : `ID ${userId}`}\n` +

                    (userInfo?.username ? `• Username: @${userInfo.username}\n` : '') +

                    `• ID: <code>${userId}</code>\n\n` +

                    `❌ <b>Resultados:</b>\n` +

                    `• No se pudo banear en ningún grupo\n` +

                    `• Grupos intentados: ${totalChats}\n` +

                    `• Fecha del intento: ${new Date().toLocaleString('es')}\n\n` +

                    `📝 <b>Razón original:</b> ${escapeHTML(pendingBan.reason)}\n\n` +

                    `<b>Estado:</b> El gban sigue pendiente para futuras oportunidades`,

                    { parse_mode: 'HTML' }

                );

            }



            return { success: banCount > 0, banCount, totalChats };

        }).catch(error => {

            console.error('Error en el proceso de reintento de gban:', error);

            ctx.telegram.editMessageText(

                ctx.chat.id,

                processingMsg.message_id,

                null,

                `❌ Error al procesar el reintento de gban: ${error.message}\n\nEl gban sigue pendiente.`

            );

        });

    });

});



// Iniciar el bot

bot.launch().then(async () => {

  console.log('Bot en ejecución.');

  // Inicializar canales de logs

  await initLogChannels();

  await removeInactiveChats();

  setInterval(() => {

    removeInactiveChats().catch((err) => console.error('Error al limpiar chats inactivos:', err));

  }, INACTIVE_CHAT_CHECK_INTERVAL);

}).catch(err => {

  console.error('Error al iniciar el bot:', err);

});



// Manejo de errores

process.on('uncaughtException', (err) => {

  console.error('Error no capturado:', err);

  // Opcionalmente reiniciar el bot si es necesario

});



process.on('unhandledRejection', (reason, promise) => {

  console.error('Promesa no manejada:', reason);

  // Log de la promesa para debugging

  console.error('Promesa:', promise);

});



// Las funciones helper ahora están en utils/helpers.js
