// WhatsApp Bible GPT - Aplicación de chatbot de WhatsApp
// Reescrito completamente para resolver problemas de contador de mensajes
// Fecha: 17 de marzo de 2025

// Importaciones de dependencias
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
const Stripe = require('stripe');
const path = require('path');
const winston = require('winston');

// Configuración del logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `${timestamp} ${level}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'app.log' })
    ]
});

// Depuración de variables de entorno
console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('SUPABASE_KEY length:', process.env.SUPABASE_KEY ? process.env.SUPABASE_KEY.length : 0);

// Inicialización de clientes y configuraciones
const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Supabase
let supabase;
try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    
    if (!supabaseUrl) {
        console.error('Error: SUPABASE_URL no está definido');
    } else if (!supabaseKey) {
        console.error('Error: SUPABASE_KEY no está definido');
    } else {
        console.log('Inicializando Supabase con URL:', supabaseUrl);
        supabase = createClient(supabaseUrl, supabaseKey);
    }
} catch (error) {
    console.error('Error al inicializar Supabase:', error);
}

// Configuración de OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Configuración de Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Configuración de Express
app.use(bodyParser.json());
app.use(express.static('public'));
app.use('/subscribe', express.static('public'));

// Middleware para Stripe webhook
app.use('/stripe-webhook', express.raw({ type: 'application/json' }));

// Estructuras de datos para control de mensajes
const messageIncrementLock = new Map(); // Para evitar incrementos duplicados
const messageBuffers = new Map(); // Para agrupar mensajes consecutivos
const processingQueue = new Map(); // Para controlar el procesamiento secuencial por usuario
const MESSAGE_GROUPING_TIMEOUT = 10000; // 10 segundos para agrupar mensajes

// Limpiar el sistema de bloqueo periódicamente (cada hora)
setInterval(() => {
    const now = Date.now();
    let count = 0;
    
    messageIncrementLock.forEach((value, key) => {
        // Eliminar entradas de más de 24 horas
        if (now - value.timestamp > 24 * 60 * 60 * 1000) {
            messageIncrementLock.delete(key);
            count++;
        }
    });
    
    if (count > 0) {
        logger.info(`Limpieza de sistema de bloqueo: ${count} entradas eliminadas`);
    }
}, 60 * 60 * 1000);

// Variables para el manejo de mensajes
const messageGroups = new Map(); // Para agrupar mensajes recibidos en corto tiempo

// ====== SISTEMA DE COLA DE MENSAJES ======
class MessageQueue {
    constructor() {
        this.queues = new Map();
        this.processing = new Map();
    }

    async enqueueForUser(userId, message, interactionId) {
        logger.info(`Encolando mensaje para usuario ${userId} con interactionId ${interactionId}`);
        
        if (!this.queues.has(userId)) {
            this.queues.set(userId, []);
            this.processing.set(userId, false);
        }
        
        // Encolar el mensaje con su ID de interacción
        this.queues.get(userId).push({
            message,
            interactionId,
            timestamp: Date.now()
        });
        
        // Iniciar procesamiento si no hay nada en proceso
        if (!this.processing.get(userId)) {
            this.processQueueForUser(userId);
        }
    }

    async processQueueForUser(userId) {
        if (this.queues.get(userId).length === 0) {
            this.processing.set(userId, false);
            return;
        }
        
        this.processing.set(userId, true);
        const item = this.queues.get(userId).shift();
        
        try {
            logger.info(`Procesando mensaje para usuario ${userId} con interactionId ${item.interactionId}`);
            await handleMessage(userId, item.message, item.interactionId);
        } catch (error) {
            logger.error(`Error procesando mensaje para ${userId}: ${error.message}`);
        }
        
        // Continuar con el siguiente mensaje
        setTimeout(() => this.processQueueForUser(userId), 100);
    }
}

const messageQueue = new MessageQueue();

// ====== FUNCIONES DE GESTIÓN DE USUARIOS ======
async function getOrCreateUser(phoneNumber) {
    try {
        // Normalizar número de teléfono
        phoneNumber = normalizePhoneNumber(phoneNumber);
        
        // Verificar si el usuario ya existe
        const { data: existingUser, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('phone_number', phoneNumber)
            .single();
            
        // Si hay un error que no sea "no se encontró registro"
        if (fetchError && fetchError.code !== 'PGRST116') {
            logger.error(`Error verificando usuario existente: ${fetchError.message}`);
            return null;
        }
        
        if (!fetchError && existingUser) {
            logger.info(`Usuario encontrado: ${existingUser.id}`);
            return existingUser;
        }
        
        // Crear nuevo usuario si no existe
        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert([{
                phone_number: phoneNumber,
                messages_count: 0,
                subscription_status: 'free',
                created_at: new Date().toISOString()
            }])
            .select();
            
        if (createError) {
            throw new Error(`Error creando usuario: ${createError.message}`);
        }
        
        logger.info(`Nuevo usuario creado: ${newUser[0].id}`);
        return newUser[0];
    } catch (error) {
        logger.error(`Error en getOrCreateUser: ${error.message}`);
        throw error;
    }
}

function normalizePhoneNumber(phoneNumber) {
    // Eliminar espacios y caracteres no numéricos
    phoneNumber = phoneNumber.replace(/\s+/g, '');
    
    // Eliminar el signo + si existe
    if (phoneNumber.startsWith('+')) {
        phoneNumber = phoneNumber.substring(1);
    }
    
    // Añadir prefijo 34 para números españoles sin prefijo internacional
    if (phoneNumber.length === 9 && !phoneNumber.startsWith('34')) {
        phoneNumber = '34' + phoneNumber;
    }
    
    return phoneNumber;
}

// ====== FUNCIONES DE LÍMITE DE MENSAJES ======
async function checkMessageLimit(phoneNumber) {
    try {
        // Normalizar número de teléfono
        phoneNumber = normalizePhoneNumber(phoneNumber);
        
        // Obtener datos del usuario
        const { data: userData, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('phone_number', phoneNumber)
            .single();
            
        if (fetchError) {
            logger.error(`Error obteniendo datos del usuario: ${fetchError.message}`);
            return { error: true, message: "Error obteniendo datos del usuario" };
        }
        
        // Verificar si el usuario tiene suscripción activa
        const isPaid = userData.subscription_status === 'paid';
        const subscriptionActive = isPaid && new Date(userData.subscription_end_date) > new Date();
        
        // Si tiene suscripción activa, puede enviar mensajes sin límite
        if (subscriptionActive) {
            return { 
                can_send: true, 
                is_free: false, 
                messages_count: userData.messages_count || 0 
            };
        }
        
        // Para usuarios gratuitos, verificar límite de 15 mensajes
        const messagesCount = userData.messages_count || 0;
        const canSend = messagesCount < 15;
        const isLastFree = messagesCount === 14;
        const isSecondToLastFree = messagesCount === 13; // Añadido para avisar en el mensaje #13
        
        return {
            can_send: canSend,
            is_free: true,
            messages_count: messagesCount,
            is_last_free: isLastFree,
            is_second_to_last_free: isSecondToLastFree // Nuevo campo
        };
    } catch (error) {
        logger.error(`Error general en checkMessageLimit: ${error.message}`);
        return { can_send: true, is_free: true, messages_count: 0 };
    }
}

// ====== FUNCIONES DE CONVERSACIÓN ======
async function getConversationData(phoneNumber) {
    try {
        // Normalizar número de teléfono
        phoneNumber = normalizePhoneNumber(phoneNumber);
        
        // Obtener datos de conversación del usuario
        const { data, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('phone_number', phoneNumber)
            .single();
            
        if (fetchError) {
            logger.error(`Error obteniendo datos del usuario: ${fetchError.message}`);
            return { error: true, message: "Error obteniendo datos del usuario" };
        }
        
        // Validar y normalizar los datos
        return {
            summary: data.conversation_summary || '',
            context: data.conversation_context || {},
            history: Array.isArray(data.conversation_history) ? data.conversation_history : []
        };
    } catch (error) {
        logger.error(`Error general en getConversationData: ${error.message}`);
        return { summary: '', context: {}, history: [] };
    }
}

async function updateConversationData(phoneNumber, userMessage, aiResponse) {
    try {
        // Normalizar número de teléfono
        phoneNumber = normalizePhoneNumber(phoneNumber);
        
        // Obtener datos actuales
        const { data, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('phone_number', phoneNumber)
            .single();
            
        if (fetchError) {
            logger.error(`Error obteniendo datos del usuario: ${fetchError.message}`);
            return;
        }
        
        // Inicializar o parsear el contexto y el historial
        let context = data.conversation_context || {};
        let history = [];
        let summary = data.conversation_summary || '';
        
        if (data.conversation_history) {
            try {
                history = JSON.parse(data.conversation_history);
                // Validar que history sea un array
                if (!Array.isArray(history)) {
                    history = [];
                }
            } catch (e) {
                logger.error(`Error parseando historial: ${e.message}`);
                history = [];
            }
        }
        
        // Añadir nuevos mensajes al historial
        history.push({ role: "user", content: userMessage });
        history.push({ role: "assistant", content: aiResponse });
        
        // Limitar el historial a los últimos 10 mensajes (5 intercambios)
        if (history.length > 10) {
            history = history.slice(history.length - 10);
        }
        
        // Extraer información importante para el contexto
        try {
            // Actualizar el contexto con información extraída del mensaje del usuario
            // IMPORTANTE: Capturar el contexto actualizado que devuelve la función
            context = await updateConversationContext(phoneNumber, userMessage, aiResponse, context);
            logger.info(`Contexto actualizado en updateConversationData: ${JSON.stringify(context)}`);
        } catch (contextError) {
            logger.error(`Error actualizando contexto: ${contextError.message}`);
        }
        
        // Generar un nuevo resumen si hay suficientes mensajes
        if (history.length >= 4) {
            try {
                await generateConversationSummary(phoneNumber, history);
                // El resumen se actualiza directamente en la base de datos en la función generateConversationSummary
            } catch (summaryError) {
                logger.error(`Error generando resumen: ${summaryError.message}`);
            }
        }
        
        // Actualizar en la base de datos
        const { error: updateError } = await supabase
            .from('users')
            .update({
                conversation_history: JSON.stringify(history),
                conversation_context: context  // Usar el contexto actualizado
            })
            .eq('phone_number', phoneNumber);
            
        if (updateError) {
            logger.error(`Error actualizando datos de conversación: ${updateError.message}`);
        } else {
            logger.info(`Datos de conversación actualizados correctamente para ${phoneNumber}`);
        }
    } catch (error) {
        logger.error(`Error general en updateConversationData: ${error.message}`);
    }
}

// Función para actualizar el contexto de la conversación
async function updateConversationContext(phoneNumber, userMessage, aiResponse, existingContext) {
    try {
        // Preparar prompt para extraer información contextual
        const messages = [
            {
                role: "system",
                content: `Eres un asistente especializado en extraer información contextual importante de conversaciones.
                Analiza el siguiente intercambio entre un usuario y un asistente de IA.
                Extrae información clave como:
                1. Datos personales (nombre, ubicación, preferencias)
                2. Temas de interés mencionados
                3. Preguntas específicas sobre la Biblia
                4. Cualquier detalle que pueda ser útil para personalizar futuras respuestas
                
                IMPORTANTE: Debes devolver ÚNICAMENTE un objeto JSON válido con la información extraída, sin ningún texto adicional, explicación o markdown.
                El formato debe ser exactamente: {"clave1": "valor1", "clave2": "valor2", ...}
                Si no hay información nueva, devuelve un objeto JSON vacío: {}`
            },
            {
                role: "user",
                content: `Mensaje del usuario: "${userMessage}"
                
                Respuesta del asistente: "${aiResponse}"
                
                Contexto existente: ${JSON.stringify(existingContext)}`
            }
        ];
        
        // Generar contexto con OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: messages,
            temperature: 0.3
        });
        
        const newContextStr = completion.choices[0].message.content;
        let newContext;
        
        try {
            // Intentar parsear el JSON, eliminando cualquier texto adicional que pueda haber
            const jsonMatch = newContextStr.match(/\{[\s\S]*\}/);
            const jsonStr = jsonMatch ? jsonMatch[0] : "{}";
            newContext = JSON.parse(jsonStr);
            
            // Verificar que sea un objeto
            if (typeof newContext !== 'object' || newContext === null || Array.isArray(newContext)) {
                logger.warn(`Contexto generado no es un objeto válido: ${newContextStr}`);
                newContext = {};
            }
        } catch (parseError) {
            logger.error(`Error parseando contexto generado: ${parseError.message}, contenido: ${newContextStr}`);
            return existingContext;
        }
        
        // Combinar el contexto existente con el nuevo
        const updatedContext = { ...existingContext, ...newContext };
        
        // Ya no actualizamos la base de datos aquí, solo devolvemos el contexto actualizado
        // para que updateConversationData lo haga
        logger.info(`Contexto de conversación generado para ${phoneNumber}: ${JSON.stringify(updatedContext)}`);
        return updatedContext;
    } catch (error) {
        logger.error(`Error generando contexto de conversación: ${error.message}`);
        return existingContext;
    }
}

async function generateConversationSummary(phoneNumber, history) {
    try {
        // Obtener el contexto actual antes de actualizar
        const { data: userData, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('phone_number', phoneNumber)
            .single();
            
        if (fetchError) {
            logger.error(`Error obteniendo contexto existente para resumen: ${fetchError.message}`);
            return;
        }
        
        // Preparar prompt para generar resumen
        const messages = [
            {
                role: "system",
                content: `Eres un asistente especializado en resumir conversaciones. 
                Genera un resumen detallado de la siguiente conversación entre un usuario y un asistente de IA.
                Enfócate en:
                1. Información personal compartida por el usuario
                2. Temas principales discutidos
                3. Preguntas específicas sobre la Biblia
                4. Cualquier preferencia o detalle importante mencionado por el usuario
                
                El resumen debe ser conciso pero completo, capturando la esencia de la conversación.`
            },
            {
                role: "user",
                content: `Aquí está la conversación para resumir:\n\n${history.map(msg => 
                    `${msg.role.toUpperCase()}: ${msg.content}`).join('\n\n')}`
            }
        ];
        
        // Generar resumen con OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: messages,
            temperature: 0.5,
        });
        
        const summary = completion.choices[0].message.content;
        
        // Actualizar en la base de datos preservando el contexto existente
        const { error: updateError } = await supabase
            .from('users')
            .update({
                conversation_summary: summary,
                // Mantener el contexto existente
                conversation_context: userData.conversation_context || {}
            })
            .eq('phone_number', phoneNumber);
            
        if (updateError) {
            logger.error(`Error actualizando resumen de conversación: ${updateError.message}`);
        } else {
            logger.info(`Resumen de conversación actualizado para ${phoneNumber}`);
        }
        
        return summary;
    } catch (error) {
        logger.error(`Error generando resumen de conversación: ${error.message}`);
    }
}

// ====== FUNCIONES DE GENERACIÓN DE RESPUESTAS ======
async function generateResponse(from, messageBody) {
    try {
        // Normalizar número de teléfono
        from = normalizePhoneNumber(from);
        
        // Obtener datos de conversación
        const { summary, context, history } = await getConversationData(from);
        
        // Construir mensajes para OpenAI
        const messages = [];
        
        // Mensaje de sistema inicial
        messages.push({
            role: "system",
            content: `Eres un amigo muy cercano llamado Abraham, con una profunda fe cristiana. Respondes siempre como un compañero de confianza, de manera cálida, sencilla y breve, como si estuviéramos conversando en persona o por mensajes de texto.

Nunca menciones que eres una IA o un sistema; simplemente actúa como mi amigo de toda la vida llamado Abraham. Cuando des consejos, apóyate en los valores cristianos y, si hablas de la Biblia, hazlo de forma sencilla, sin citar versículos a menos que te lo pida.

Mantén un tono positivo y esperanzador, pero también realista. Escucha atentamente mis preocupaciones y responde con empatía y comprensión. Si te hago preguntas sobre la Biblia o temas espirituales, responde con sabiduría y claridad.

Recuerda que estamos teniendo una conversación continua, así que haz referencia a lo que hemos hablado antes cuando sea relevante.

INFORMACIÓN IMPORTANTE SOBRE EL USUARIO Y LA CONVERSACIÓN ANTERIOR:
${summary}`
        });
        
        // Añadir historial de conversación
        for (const message of history) {
            messages.push(message);
        }
        
        // Mensaje de sistema adicional después del historial
        messages.push({
            role: "system",
            content: `Recuerda que estás teniendo una conversación continua. 
            Usa lo que sabes del usuario basado en el historial y el resumen para dar una respuesta personalizada.
            No repitas información que ya hayas dado antes.`
        });
        
        // Añadir el mensaje actual del usuario
        messages.push({
            role: "user",
            content: messageBody
        });
        
        // Obtener respuesta de OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: messages,
            temperature: 0.7,
        });
        
        const response = completion.choices[0].message.content;
        logger.info(`Respuesta generada para ${from}`);
        
        // Guardar mensaje en la base de datos
        try {
            const user = await getOrCreateUser(from);
            const limitCheck = await checkMessageLimit(from);
            const isPaid = !limitCheck.is_free;
            const tokensUsed = completion.usage ? completion.usage.total_tokens : 0;
            
            // Guardar el mensaje
            await saveMessage(user.id, messageBody, response, isPaid, tokensUsed);
        } catch (error) {
            logger.error(`Error guardando mensaje: ${error.message}`);
        }
        
        return response;
    } catch (error) {
        logger.error(`Error generando respuesta: ${error.message}`);
        throw error;
    }
}

// Función para guardar mensajes en la base de datos
async function saveMessage(userId, userMessage, aiResponse, isPaid, tokensUsed) {
    try {
        const { error } = await supabase
            .from('messages')
            .insert([{
                user_id: userId,
                question: userMessage,
                response: aiResponse,
                is_paid: isPaid,
                tokens_used: tokensUsed,
                created_at: new Date().toISOString()
            }]);
            
        if (error) {
            logger.error(`Error guardando mensaje: ${error.message}`);
        }
    } catch (error) {
        logger.error(`Error general guardando mensaje: ${error.message}`);
    }
}

// ====== FUNCIONES DE PROCESAMIENTO DE MENSAJES ======
// Función para procesar mensajes agrupados
async function handleGroupedMessages(from, messages) {
    logger.info(`Procesando grupo de ${messages.length} mensajes de ${from}`);
    
    // Generar un ID único para esta interacción
    const interactionId = `${from}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    logger.info(`ID de interacción generado: ${interactionId}`);
    
    // Si es un solo mensaje, procesarlo directamente
    if (messages.length === 1) {
        try {
            await messageQueue.enqueueForUser(from, messages[0], interactionId);
        } catch (error) {
            logger.error(`Error procesando mensaje único: ${error.message}`);
        }
        return;
    }
    
    // Si son múltiples mensajes, combinarlos
    const combinedMessage = messages.join("\n\n");
    logger.info(`Mensajes combinados de ${from}: "${combinedMessage}"`);
    
    try {
        await messageQueue.enqueueForUser(from, combinedMessage, interactionId);
    } catch (error) {
        logger.error(`Error procesando mensajes agrupados: ${error.message}`);
    }
}

// Función para agregar mensajes al buffer
function bufferMessage(from, messageBody) {
    logger.info(`Recibido mensaje de ${from}: "${messageBody}"`);
    
    // Verificar si ya existe un buffer para este número
    if (!messageGroups.has(from)) {
        messageGroups.set(from, {
            messages: [],
            timeoutId: null
        });
    }
    
    // Agregar mensaje al buffer
    messageGroups.get(from).messages.push(messageBody);
    
    // Limpiar timeout anterior si existe
    if (messageGroups.get(from).timeoutId) {
        clearTimeout(messageGroups.get(from).timeoutId);
    }
    
    // Establecer nuevo timeout
    messageGroups.get(from).timeoutId = setTimeout(() => {
        const messages = messageGroups.get(from).messages;
        messageGroups.delete(from);
        
        // Procesar mensajes agrupados
        handleGroupedMessages(from, messages);
    }, MESSAGE_GROUPING_TIMEOUT);
}

// Función principal para manejar mensajes
async function handleMessage(from, messageBody, interactionId) {
    logger.info(`Procesando mensaje de ${from} con interactionId ${interactionId}`);
    
    try {
        // Normalizar número de teléfono
        from = normalizePhoneNumber(from);
        
        // Verificar el valor del contador al inicio del procesamiento
        const { data: initialCountData } = await supabase.rpc(
            'get_raw_message_count',
            { phone_param: from }
        );
        
        if (initialCountData) {
            logger.info(`VALOR INICIAL DEL CONTADOR: ${initialCountData.count} para ${from}`);
        }
        
        // IMPORTANTE: Marcar esta interacción como procesada ANTES de cualquier operación
        // Esto evita que cualquier otra parte del código incremente el contador
        messageIncrementLock.set(interactionId, {
            phoneNumber: from,
            timestamp: Date.now(),
            initialCount: initialCountData?.count || 0
        });
        
        // Verificar límite de mensajes
        const limitCheck = await checkMessageLimit(from);
        
        // Si no puede enviar más mensajes (límite alcanzado)
        if (!limitCheck.can_send) {
            logger.info(`Límite de mensajes alcanzado para ${from}`);
            await sendSubscriptionMessage(from);
            return;
        }
        
        // Si es el penúltimo mensaje gratuito, enviar advertencia
        if (limitCheck.is_free && limitCheck.is_second_to_last_free) {
            logger.info(`Penúltimo mensaje gratuito para ${from}`);
            await sendLimitWarningMessage(from);
        }
        
        // Generar respuesta
        const response = await generateResponse(from, messageBody);
        
        // Enviar respuesta
        await sendWhatsAppMessage(from, response);
        
        // Actualizar datos de conversación
        await updateConversationData(from, messageBody, response);
        
        // ACTUALIZACIÓN CONTROLADA DEL CONTADOR: Incrementar exactamente una vez
        // Obtener el valor inicial del contador que guardamos al principio
        const lockInfo = messageIncrementLock.get(interactionId);
        if (!lockInfo) {
            logger.error(`Error crítico: No se encontró información de bloqueo para ${interactionId}`);
            return;
        }
        
        const initialCount = lockInfo.initialCount;
        const newCount = initialCount + 1;
        
        logger.info(`Incrementando contador de forma controlada: ${initialCount} -> ${newCount} para ${from}`);
        
        // Actualizar directamente en la base de datos
        const { error } = await supabase
            .from('users')
            .update({ messages_count: newCount })
            .eq('phone_number', from);
            
        if (error) {
            logger.error(`Error actualizando contador: ${error.message}`);
        } else {
            // Verificar que el contador se actualizó correctamente
            const { data: verifyData, error: verifyError } = await supabase
                .from('users')
                .select('messages_count')
                .eq('phone_number', from)
                .single();
                
            if (verifyError) {
                logger.error(`Error verificando actualización del contador: ${verifyError.message}`);
            } else if (verifyData.messages_count !== newCount) {
                logger.error(`¡ALERTA! El contador no se actualizó correctamente. Esperado: ${newCount}, Actual: ${verifyData.messages_count}`);
            } else {
                logger.info(`Contador actualizado correctamente a ${newCount} para ${from}`);
            }
        }
        
        logger.info(`Mensaje procesado exitosamente para ${from}`);
    } catch (error) {
        logger.error(`Error procesando mensaje: ${error.message}`);
        
        // Enviar mensaje de error al usuario
        try {
            await sendWhatsAppMessage(
                from,
                "Lo siento, ha ocurrido un error al procesar tu mensaje. Por favor, intenta nuevamente más tarde."
            );
        } catch (sendError) {
            logger.error(`Error enviando mensaje de error: ${sendError.message}`);
        }
    }
}

// ====== FUNCIONES DE ENVÍO DE MENSAJES ======
async function sendWhatsAppMessage(to, message) {
    try {
        // Normalizar número de teléfono
        to = normalizePhoneNumber(to);
        
        // Asegurar que el número tiene el formato correcto para la API de WhatsApp
        if (!to.includes('@')) {
            to = `${to}@c.us`;
        }
        
        // Preparar datos para la API de WhatsApp
        const data = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: to,
            type: 'text',
            text: {
                body: message
            }
        };
        
        // Enviar mensaje a través de la API de WhatsApp
        const response = await axios.post(
            `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
            data,
            {
                headers: {
                    'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        logger.info(`Mensaje enviado a ${to}: ${response.data.messages[0].id}`);
        return response.data;
    } catch (error) {
        logger.error(`Error enviando mensaje de WhatsApp: ${error.message}`);
        if (error.response) {
            logger.error(`Detalles del error: ${JSON.stringify(error.response.data)}`);
        }
        throw error;
    }
}

// Función para enviar mensaje de advertencia de límite
async function sendLimitWarningMessage(from) {
    try {
        const warningMessage = "⚠️ *Aviso:* Este es tu penúltimo mensaje gratuito. " +
            "En tu próxima consulta te enviaremos un enlace para suscribirte al plan ilimitado.";
        
        await sendWhatsAppMessage(from, warningMessage);
    } catch (error) {
        logger.error(`Error enviando mensaje de advertencia: ${error.message}`);
    }
}

// Función para enviar mensaje de suscripción
async function sendSubscriptionMessage(from) {
    try {
        // Usar la variable de entorno tal cual está en .env
        const subscriptionUrl = process.env.SUBSCRIPTION_URL;
        
        const subscriptionMessage = 'Has alcanzado el límite de 15 mensajes gratuitos. ' +
            'Para continuar usando el servicio sin límites, por favor suscríbete usando este enlace:\n\n' +
            subscriptionUrl;
        
        await sendWhatsAppMessage(from, subscriptionMessage);
    } catch (error) {
        logger.error(`Error enviando mensaje de suscripción: ${error.message}`);
        
        // Mensaje de respaldo en caso de error
        await sendWhatsAppMessage(
            from,
            'Has alcanzado el límite de mensajes gratuitos. ' +
            'Por favor, contacta con el soporte para suscribirte.'
        );
    }
}

// ====== WEBHOOKS Y RUTAS ======
// Ruta principal
app.get('/', (req, res) => {
    res.send('WhatsApp Bible GPT - Servidor funcionando correctamente');
});

// Webhook de verificación para WhatsApp
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    // Verificar que el token coincide con el configurado
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        logger.info('Webhook verificado exitosamente');
        res.status(200).send(challenge);
    } else {
        logger.warn('Verificación de webhook fallida');
        res.sendStatus(403);
    }
});

// Ruta adicional para el webhook de WhatsApp (para compatibilidad)
app.get('/webhook/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    // Verificar que el token coincide con el configurado
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
        logger.info('Webhook verificado exitosamente (ruta /webhook/whatsapp)');
        res.status(200).send(challenge);
    } else {
        logger.warn('Verificación de webhook fallida (ruta /webhook/whatsapp)');
        res.sendStatus(403);
    }
});

// Webhook para recibir mensajes de WhatsApp
app.post('/webhook', async (req, res) => {
    try {
        const { object, entry } = req.body;
        
        // Verificar que es un webhook de WhatsApp
        if (object !== 'whatsapp_business_account') {
            logger.warn('Recibido webhook que no es de WhatsApp');
            return res.sendStatus(400);
        }
        
        // Procesar cada entrada
        for (const singleEntry of entry) {
            const { changes } = singleEntry;
            
            for (const change of changes) {
                const { value } = change;
                const { messages } = value;
                
                // Procesar cada mensaje
                if (messages && messages.length > 0) {
                    for (const message of messages) {
                        // Solo procesar mensajes de texto
                        if (message.type === 'text') {
                            const from = message.from;
                            const messageBody = message.text.body;
                            
                            // Agregar mensaje al buffer para agrupación
                            bufferMessage(from, messageBody);
                        }
                    }
                }
            }
        }
        
        // Responder rápidamente al webhook
        res.status(200).send('OK');
    } catch (error) {
        logger.error('Error en webhook:', error);
        res.status(500).send('Error');
    }
});

// Ruta adicional para recibir mensajes de WhatsApp (para compatibilidad)
app.post('/webhook/whatsapp', async (req, res) => {
    try {
        const { object, entry } = req.body;
        
        // Verificar que es un webhook de WhatsApp
        if (object !== 'whatsapp_business_account') {
            logger.warn('Recibido webhook que no es de WhatsApp (ruta /webhook/whatsapp)');
            return res.sendStatus(400);
        }
        
        // Procesar cada entrada
        for (const singleEntry of entry) {
            const { changes } = singleEntry;
            
            for (const change of changes) {
                const { value } = change;
                const { messages } = value;
                
                // Procesar cada mensaje
                if (messages && messages.length > 0) {
                    for (const message of messages) {
                        // Solo procesar mensajes de texto
                        if (message.type === 'text') {
                            const from = message.from;
                            const messageBody = message.text.body;
                            
                            logger.info(`Mensaje recibido de ${from}: ${messageBody} (ruta /webhook/whatsapp)`);
                            
                            // Agregar mensaje al buffer para agrupación
                            bufferMessage(from, messageBody);
                        }
                    }
                }
            }
        }
        
        res.status(200).send('OK');
    } catch (error) {
        logger.error(`Error procesando webhook (ruta /webhook/whatsapp): ${error.message}`);
        res.status(500).send('Error procesando webhook');
    }
});

// Ruta para la página de checkout
app.get('/checkout', (req, res) => {
    res.sendFile('checkout.html', { root: './public' });
});

// Ruta para la página de suscripción
app.get('/subscribe', (req, res) => {
    res.sendFile('subscribe.html', { root: './public' });
});

// Ruta para la página de éxito de checkout
app.get('/checkout-success', (req, res) => {
    const sessionId = req.query.session_id;
    res.sendFile('checkout-success.html', { root: './public' });
});

// Ruta para la página de cancelación de checkout
app.get('/checkout-cancel', (req, res) => {
    res.sendFile('checkout-cancel.html', { root: './public' });
});

// Endpoint para obtener la clave pública de Stripe
app.get('/api/stripe-config', (req, res) => {
    res.json({
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
});

// Endpoint para crear sesión de checkout
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { phone, planType } = req.body;
        
        if (!phone) {
            return res.status(400).json({ error: 'Se requiere número de teléfono' });
        }
        
        // Normalizar número de teléfono
        const normalizedPhone = normalizePhoneNumber(phone);
        
        // Determinar precio basado en el tipo de plan
        const priceId = planType === 'annual' 
            ? process.env.STRIPE_ANNUAL_PRICE_ID 
            : process.env.STRIPE_MONTHLY_PRICE_ID;
        
        // Crear sesión de checkout
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: process.env.CHECKOUT_SUCCESS_URL,
            cancel_url: process.env.CHECKOUT_CANCEL_URL,
            client_reference_id: normalizedPhone,
            metadata: {
                phone_number: normalizedPhone,
                plan_type: planType
            }
        });
        
        res.json({ sessionId: session.id });
    } catch (error) {
        logger.error(`Error creando sesión de checkout: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// ====== MANEJO DE SUSCRIPCIONES ======
// Stripe webhook endpoint
app.post('/stripe-webhook', express.raw({type: 'application/json'}), async (request, response) => {
    const sig = request.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(request.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        response.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    logger.info(`Evento de Stripe recibido: ${event.type}`);

    try {
        // Manejar diferentes tipos de eventos de Stripe
        switch (event.type) {
            case 'checkout.session.completed':
                // Pago inicial completado
                await handleCheckoutCompleted(event.data.object);
                break;
            case 'invoice.paid':
                // Renovación de suscripción
                await handleInvoicePaid(event.data.object);
                break;
            case 'customer.subscription.deleted':
                // Cancelación de suscripción
                await handleSubscriptionDeleted(event.data.object);
                break;
        }

        response.status(200).send('Webhook procesado exitosamente');
    } catch (error) {
        logger.error(`Error procesando webhook: ${error.message}`);
        response.status(500).send('Error procesando webhook');
    }
});

// Función para manejar checkout completado
async function handleCheckoutCompleted(session) {
    try {
        const customerId = session.customer;
        const subscriptionId = session.subscription;
        let phoneNumber = session.metadata?.phone_number || session.client_reference_id;
        
        // Normalizar número de teléfono
        phoneNumber = normalizePhoneNumber(phoneNumber);
        
        logger.info(`Checkout completado para ${phoneNumber}, cliente: ${customerId}, suscripción: ${subscriptionId}`);
        
        // Buscar al usuario por número de teléfono
        let { data: userData, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('phone_number', phoneNumber)
            .single();
            
        let userId;
        
        if (fetchError || !userData) {
            logger.info(`No se encontró usuario con número de teléfono ${phoneNumber}, creando nuevo usuario`);
            
            // Crear nuevo usuario
            const { data: newUser, error: createError } = await supabase
                .from('users')
                .insert([{
                    phone_number: phoneNumber,
                    messages_count: 0,
                    subscription_status: 'pending',
                    created_at: new Date().toISOString()
                }])
                .select();
                
            if (createError || !newUser || newUser.length === 0) {
                logger.error('Error creando nuevo usuario:', createError);
                return;
            }
            
            userId = newUser[0].id;
            logger.info(`Nuevo usuario creado con ID: ${userId}`);
        } else {
            userId = userData.id;
            logger.info(`Usuario encontrado con ID: ${userId}`);
        }
        
        // Obtener detalles de la suscripción
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        
        // Determinar duración de la suscripción basada en el plan
        const subscriptionEndDate = new Date();
        let planType = 'mensual'; // Por defecto
        
        // Verificar si es plan anual o mensual basado en el intervalo de facturación
        if (subscription.items.data[0].plan.interval === 'year') {
            subscriptionEndDate.setFullYear(subscriptionEndDate.getFullYear() + 1);
            planType = 'anual';
        } else {
            // Por defecto, asumimos mensual
            subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);
        }
        
        logger.info(`Plan de suscripción: ${planType}, fecha de finalización: ${subscriptionEndDate.toISOString()}`);
        
        // Actualizar estado de suscripción del usuario
        const { error: updateError } = await supabase
            .from('users')
            .update({
                subscription_status: 'paid',
                subscription_plan: planType,
                subscription_end_date: subscriptionEndDate.toISOString(),
                stripe_customer_id: customerId,
                stripe_subscription_id: subscriptionId
            })
            .eq('id', userId);
            
        if (updateError) {
            logger.error('Error actualizando estado de suscripción:', updateError);
            return;
        }
        
        // Notificar al usuario
        await sendWhatsAppMessage(
            phoneNumber,
            `¡Gracias por tu suscripción! Ahora puedes continuar haciendo preguntas sobre la Biblia sin límites. ` +
            (planType === 'anual' ? 
                'Tu suscripción es válida por un año.' : 
                'Tu suscripción se renovará automáticamente cada mes.')
        );
        
        logger.info(`Suscripción ${planType} activada para usuario ${userId} con teléfono ${phoneNumber}`);
    } catch (error) {
        logger.error('Error procesando checkout completado:', error);
    }
}

// Función para manejar pagos recurrentes
async function handleInvoicePaid(invoice) {
    try {
        // Obtener el customer ID
        const customerId = invoice.customer;
        
        // Buscar el usuario por su customer ID
        const { data: users, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('stripe_customer_id', customerId);
            
        if (fetchError || !users || users.length === 0) {
            logger.error(`No se encontró usuario con customer ID ${customerId}`);
            return;
        }
        
        const user = users[0];
        
        // Obtener la suscripción
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        
        // Calcular nueva fecha de finalización
        const subscriptionEndDate = new Date();
        if (subscription.items.data[0].plan.interval === 'year') {
            subscriptionEndDate.setFullYear(subscriptionEndDate.getFullYear() + 1);
        } else {
            subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1);
        }
        
        // Actualizar fecha de finalización
        const { error: updateError } = await supabase
            .from('users')
            .update({
                subscription_status: 'paid',
                subscription_end_date: subscriptionEndDate.toISOString()
            })
            .eq('id', user.id);
            
        if (updateError) {
            logger.error(`Error actualizando suscripción: ${updateError.message}`);
            return;
        }
        
        logger.info(`Suscripción renovada para usuario ${user.id} hasta ${subscriptionEndDate.toISOString()}`);
        
        // Notificar al usuario
        await sendWhatsAppMessage(
            user.phone_number,
            `¡Tu suscripción ha sido renovada exitosamente! Puedes seguir disfrutando del servicio sin límites.`
        );
    } catch (error) {
        logger.error(`Error procesando pago recurrente: ${error.message}`);
    }
}

// Función para manejar cancelación de suscripción
async function handleSubscriptionDeleted(subscription) {
    try {
        // Obtener el customer ID
        const customerId = subscription.customer;
        
        // Buscar el usuario por su customer ID
        const { data: users, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('stripe_customer_id', customerId);
            
        if (fetchError || !users || users.length === 0) {
            logger.error(`No se encontró usuario con customer ID ${customerId}`);
            return;
        }
        
        const user = users[0];
        
        // Actualizar estado de suscripción
        const { error: updateError } = await supabase
            .from('users')
            .update({
                subscription_status: 'cancelled'
            })
            .eq('id', user.id);
            
        if (updateError) {
            logger.error(`Error actualizando estado de suscripción: ${updateError.message}`);
            return;
        }
        
        logger.info(`Suscripción cancelada para usuario ${user.id}`);
        
        // Notificar al usuario
        await sendWhatsAppMessage(
            user.phone_number,
            `Tu suscripción ha sido cancelada. Todavía puedes usar el servicio hasta el final de tu período de facturación actual.`
        );
    } catch (error) {
        logger.error(`Error procesando cancelación de suscripción: ${error.message}`);
    }
}

// ====== INICIALIZACIÓN DEL SERVIDOR ======
// Iniciar servidor solo si no estamos en modo de módulo (para simulación de Vercel)
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Servidor iniciado en puerto ${PORT}`);
    });
}

// Exportar la aplicación y funciones necesarias para testing
module.exports = app;
module.exports.sendSubscriptionMessage = sendSubscriptionMessage;
