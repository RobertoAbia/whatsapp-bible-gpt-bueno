// logger.js - Sistema de logging estructurado
const winston = require('winston');
const fs = require('fs');

// Asegurarse de que el directorio de logs exista
const logDir = './logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

// Crear el logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'whatsapp-bible-gpt' },
    transports: [
        // Escribir logs de error en error.log
        new winston.transports.File({ 
            filename: `${logDir}/error.log`, 
            level: 'error' 
        }),
        // Escribir todos los logs en combined.log
        new winston.transports.File({ 
            filename: `${logDir}/combined.log` 
        }),
        // Mostrar logs en consola durante desarrollo
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

module.exports = logger;
