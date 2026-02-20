# Estructura del Bot GBAN

## Organización de Archivos

```
gban/
├── main.js                 # Archivo principal del bot
├── .env                    # Variables de entorno
├── gban_bot.db            # Base de datos SQLite
├── database/
│   └── db.js              # Módulo de gestión de base de datos
└── utils/
    ├── constants.js       # Constantes y mensajes del bot
    └── helpers.js         # Funciones auxiliares
```

## Módulos

### database/db.js
Gestiona todas las operaciones con la base de datos SQLite:
- `initDatabase()` - Inicializa la conexión a la BD
- `runQuery(sql, params)` - Ejecuta consultas sin retornar resultados
- `getOne(sql, params)` - Obtiene una sola fila
- `getAll(sql, params)` - Obtiene todas las filas
- `getDatabase()` - Retorna la instancia de la BD

### utils/helpers.js
Funciones auxiliares reutilizables:
- `escapeHTML(text)` - Escapa caracteres HTML
- `escapeMarkdown(text)` - Escapa caracteres Markdown
- `formatDateUY(date)` - Formatea fecha a hora de Uruguay (UTC-3)
- `formatDateShort(date)` - Formatea fecha corta
- `calculateUpdateInterval(totalChats)` - Calcula intervalo de actualización
- `resolveUser(bot, identifier)` - Resuelve ID o username a información del usuario

### utils/constants.js
Constantes usadas en todo el bot:
- Tiempos y límites (APPROVAL_TIMEOUT, MIN_UPDATE_INTERVAL, BAN_DELAY)
- Mensajes de error (ERRORS)
- Mensajes de éxito (SUCCESS)
- Mensajes informativos (INFO)
- Hashtags para logs (HASHTAGS)
- Emojis comunes (EMOJI)

## Mejoras Implementadas

### UX Mejorada
1. **Comando /help mejorado** - Organizado por categorías con emojis y mejor formato
2. **Respuestas más detalladas** - Información completa del usuario en comandos como /ginfo
3. **Formato consistente** - Uso de emojis y formatos HTML consistentes

### Código Refactorizado
1. **Módulos separados** - Lógica organizada en archivos específicos
2. **Constantes centralizadas** - Fácil mantenimiento de mensajes y configuraciones
3. **Funciones reutilizables** - Código DRY (Don't Repeat Yourself)
4. **Mejor mantenibilidad** - Código más limpio y fácil de entender

## Uso

El bot funciona exactamente igual que antes, pero con código más organizado y mantenible.

Para ejecutar:
```bash
node main.js
```
