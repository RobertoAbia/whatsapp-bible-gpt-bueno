# WhatsApp Bible GPT

Una aplicación que permite a los usuarios interactuar con ChatGPT a través de WhatsApp para realizar consultas sobre la Biblia cristiana. Incluye sistema de pago con Stripe después de 15 mensajes gratuitos.

## Características

- Integración con WhatsApp Business API
- Respuestas basadas en la Biblia usando ChatGPT
- Almacenamiento de usuarios y conversaciones en Supabase
- Sistema de pago con Stripe (15 mensajes gratuitos)
- Notificación automática cuando el usuario alcanza su último mensaje gratuito
- No requiere prefijo para las consultas

## Requisitos Previos

- Node.js instalado
- Cuenta de OpenAI con API key
- Cuenta de Supabase
- Cuenta de WhatsApp Business
- Cuenta de Stripe

## Configuración

1. Clona el repositorio
2. Instala las dependencias:
   ```bash
   npm install
   ```
3. Copia el archivo `.env.example` a `.env` y configura tus variables de entorno:
   - OPENAI_API_KEY
   - SUPABASE_URL
   - SUPABASE_KEY
   - WHATSAPP_TOKEN
   - WHATSAPP_PHONE_NUMBER_ID
   - WHATSAPP_BUSINESS_ACCOUNT_ID
   - VERIFY_TOKEN
   - WEBHOOK_URL
   - BASE_URL
   - STRIPE_SECRET_KEY
   - STRIPE_PRICE_ID
   - STRIPE_WEBHOOK_SECRET
   - STRIPE_PUBLISHABLE_KEY

## Configuración de URLs Dinámicas

La aplicación utiliza un sistema de URLs dinámicas para facilitar el desarrollo local y el despliegue en producción:

1. `BASE_URL`: Esta variable define la URL base de la aplicación.
   - En desarrollo local: `http://localhost:3000`
   - En producción: `https://whatsapp-bible-gpt-bueno-production.up.railway.app` o la URL de tu despliegue en Railway

2. `WEBHOOK_URL`: Esta variable define la URL del webhook para WhatsApp.
   - En desarrollo local: `http://localhost:3000/webhook`
   - En producción: `https://whatsapp-bible-gpt-bueno-production.up.railway.app/webhook` o la URL correspondiente

El script `vercel-local.js` configura automáticamente estas variables para el entorno de desarrollo local.

## Configuración de la Base de Datos (Supabase)

1. Crea una cuenta en Supabase (https://supabase.com)
2. Crea un nuevo proyecto
3. Ejecuta el script SQL proporcionado en `supabase_optimizado.sql` en el Editor SQL de Supabase
4. Este script creará:
   - Tabla `users` para almacenar información de los usuarios
   - Tabla `messages` para almacenar las conversaciones
   - Funciones y triggers necesarios para la gestión de mensajes
   - Políticas de seguridad (RLS) para permitir operaciones desde la aplicación

Para una documentación detallada sobre la estructura y funcionamiento de la base de datos, consulta el archivo [documentacion_base_datos.md](./documentacion_base_datos.md). Este documento incluye:
- Estructura completa de las tablas
- Estados de suscripción y su significado
- Triggers y funciones automáticas
- Flujo de suscripción y pagos
- Índices y optimizaciones

## Configuración de WhatsApp Business API

1. Crea una cuenta de desarrollador en Meta (https://developers.facebook.com)
2. Configura una aplicación de WhatsApp Business
3. Obtén el token de acceso y el ID del número de teléfono
4. Configura el webhook con la URL de tu aplicación:
   - URL del webhook: `https://tu-dominio.com/webhook`
   - Token de verificación: El mismo que configuraste en VERIFY_TOKEN

## Configuración de Stripe

1. Crea una cuenta en Stripe (https://stripe.com)
2. Crea un producto y un precio para la suscripción ilimitada
3. Obtén las claves API de Stripe (Secret Key)
4. Configura el webhook de Stripe para manejar los eventos de pago
   - URL del webhook: `https://tu-dominio.com/webhook`
   - Eventos a escuchar: `checkout.session.completed`

## Uso

1. Inicia la aplicación:
   ```bash
   npm start
   ```
   
   Para desarrollo:
   ```bash
   npm run dev
   ```

2. Asegúrate de que tu webhook esté accesible públicamente (puedes usar ngrok para desarrollo)
3. Envía mensajes a tu número de WhatsApp Business configurado

## Sistema de Mensajes y Pagos

- Los usuarios tienen 15 mensajes gratuitos
- En el mensaje 14 (último gratuito), recibirán una notificación
- Después de los 15 mensajes, recibirán un enlace de pago de Stripe
- Una vez realizado el pago, podrán continuar usando el servicio sin límites

## Uso del Bot

Simplemente envía cualquier mensaje al número de WhatsApp configurado. No es necesario usar ningún prefijo.

Ejemplos:
```
¿Qué dice la Biblia sobre el amor?
```

```
Explícame el significado del Salmo 23
```

## Estructura del Proyecto

- `index.js`: Archivo principal con toda la lógica de la aplicación
- `.env`: Variables de entorno (no incluido en el repositorio)
- `.env.example`: Ejemplo de las variables de entorno necesarias
- `supabase_optimizado.sql`: Script SQL para configurar la base de datos
- `package.json`: Dependencias y scripts del proyecto
- `vercel.json`: Configuración para el despliegue (compatible con Railway)

## Despliegue en Railway

Para desplegar esta aplicación en Railway, sigue estos pasos:

1. **Crea una cuenta en Railway**: Regístrate en [Railway](https://railway.app) si aún no tienes una cuenta.

2. **Conecta tu repositorio**:
   - Sube tu código a GitHub
   - En el dashboard de Railway, haz clic en "New Project"
   - Selecciona "Deploy from GitHub repo"
   - Selecciona tu repositorio
   - Railway detectará automáticamente que es un proyecto Node.js

3. **Configura las variables de entorno**:
   - En la configuración del proyecto en Railway, añade todas las variables de entorno que están en tu archivo `.env`
   - Asegúrate de incluir todas las claves de API y configuraciones necesarias

4. **Configura los webhooks**:
   - Una vez desplegada la aplicación, obtendrás una URL (ej: `https://tu-app-production.up.railway.app`)
   - Actualiza la configuración de webhook de WhatsApp con esta URL: `https://tu-app-production.up.railway.app/webhook`
   - Actualiza la configuración de webhook de Stripe con esta URL: `https://tu-app-production.up.railway.app/webhook`

5. **Verifica el despliegue**:
   - Envía un mensaje de prueba a tu número de WhatsApp Business
   - Verifica los logs en el dashboard de Railway para asegurarte de que todo funciona correctamente

### Consideraciones importantes para Railway

- **Servidor persistente**: A diferencia de Vercel, Railway proporciona un servidor persistente, lo que significa que tu aplicación se ejecutará en un entorno con estado. Esto es ideal para aplicaciones que necesitan mantener conexiones persistentes o procesar solicitudes de larga duración.

- **Sin límites de tiempo estrictos**: Railway no impone límites de tiempo de ejecución tan estrictos como las funciones serverless, lo que es perfecto para aplicaciones que necesitan procesar solicitudes más largas o mantener conexiones abiertas.

- **Escalado manual o automático**: Railway permite configurar el escalado de tu aplicación según tus necesidades.

- **Dominio personalizado**: Puedes configurar un dominio personalizado para tu aplicación en la configuración del proyecto en Railway.

> **Nota**: Este proyecto se despliega en Railway en lugar de Vercel debido a que requiere un servidor persistente y no es adecuado para un entorno serverless, que tiene limitaciones de tiempo de ejecución y estado.
