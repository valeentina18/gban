# Bot de GBan para Telegram

Bot para gestionar baneos globales en múltiples grupos y canales de Telegram.

## Características

- Baneo global de usuarios en múltiples grupos/canales
- Sistema de permisos para fundadores
- Registro de acciones en canal de logs
- Base de datos SQLite para persistencia
- Soporte para IDs y usernames

## Comandos

- `/ping` - Comprobar si el bot está activo
- `/gban` - Banear globalmente a un usuario
- `/ungban` - Desbanear globalmente a un usuario
- `/info` - Ver información de un usuario baneado
- `/listchats` - Listar grupos/canales registrados

## Instalación

1. Clonar el repositorio
```bash
git clone https://github.com/tuUsuario/gban.git
cd gban
```

2. Instalar dependencias
```bash
npm install
```

3. Configurar variables de entorno
```bash
cp .env.example .env
```
Editar `.env` con tus valores:
```
BOT_TOKEN=tu_token_del_bot
LOG_CHANNELS=id_canal_1,id_canal_2
FOUNDERS=id1,id2,id3
```

4. Iniciar el bot
```bash
node main.js
```

## Licencia

MIT
