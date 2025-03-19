// queue.js - Sistema de cola para procesar mensajes secuencialmente
class MessageQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
    }

    // Añadir un mensaje a la cola
    enqueue(from, messageBody) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                from,
                messageBody,
                resolve,
                reject
            });
            
            // Si no hay procesamiento activo, iniciar
            if (!this.processing) {
                this.processQueue();
            }
        });
    }

    // Procesar la cola
    async processQueue() {
        if (this.queue.length === 0) {
            this.processing = false;
            return;
        }

        this.processing = true;
        const item = this.queue.shift();
        
        try {
            // Aquí llamaríamos a la función que procesa el mensaje
            // En index.js, esto sería handleMessage
            const result = await this.processMessage(item.from, item.messageBody);
            item.resolve(result);
        } catch (error) {
            item.reject(error);
        } finally {
            // Procesar el siguiente mensaje en la cola
            this.processQueue();
        }
    }

    // Esta función debe ser sobrescrita en la implementación
    async processMessage(from, messageBody) {
        throw new Error('processMessage debe ser implementado');
    }
}

module.exports = MessageQueue;
