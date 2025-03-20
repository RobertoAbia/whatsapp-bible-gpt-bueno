# Documentación de la Base de Datos - WhatsApp Bible GPT

## Resumen

Este documento describe la estructura, funcionamiento y relaciones de la base de datos utilizada en la aplicación WhatsApp Bible GPT. La base de datos está implementada en PostgreSQL a través de Supabase y gestiona usuarios, mensajes, suscripciones y pagos.

## Estructura de la Base de Datos

La base de datos consta de dos tablas principales:

### Tabla `users`

Almacena información sobre los usuarios del sistema.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | uuid | Identificador único del usuario (clave primaria) |
| `phone_number` | text | Número de teléfono del usuario (único) |
| `subscription_status` | text | Estado de la suscripción ('free', 'paid', 'pending', 'cancelled') |
| `subscription_end_date` | timestamptz | Fecha de finalización de la suscripción |
| `messages_count` | integer | Contador de mensajes enviados por el usuario |
| `created_at` | timestamptz | Fecha de creación del registro |
| `updated_at` | timestamptz | Fecha de última actualización del registro |
| `conversation_context` | jsonb | Contexto de la conversación actual |
| `conversation_history` | text | Historial de conversaciones en formato JSON |
| `conversation_summary` | text | Resumen de la conversación actual |
| `stripe_customer_id` | text | ID del cliente en Stripe |
| `stripe_subscription_id` | text | ID de la suscripción en Stripe |
| `subscription_plan` | text | Tipo de plan ('mensual', 'anual') |

### Tabla `messages`

Almacena los mensajes enviados por los usuarios.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | uuid | Identificador único del mensaje (clave primaria) |
| `user_id` | uuid | ID del usuario que envió el mensaje (clave foránea) |
| `content` | text | Contenido del mensaje |
| `response` | text | Respuesta generada por el sistema |
| `created_at` | timestamptz | Fecha de creación del mensaje |
| `updated_at` | timestamptz | Fecha de última actualización del mensaje |

## Relaciones

- Un usuario (`users`) puede tener múltiples mensajes (`messages`).
- La relación se establece mediante la clave foránea `user_id` en la tabla `messages` que referencia `id` en la tabla `users`.

## Índices

Para optimizar el rendimiento de las consultas, se han creado los siguientes índices:

1. `idx_users_phone_number`: Índice sobre `phone_number` en la tabla `users`
2. `idx_messages_user_id`: Índice sobre `user_id` en la tabla `messages`
3. `idx_messages_created_at`: Índice sobre `created_at` en la tabla `messages`

## Estados de Suscripción

El campo `subscription_status` en la tabla `users` puede tener los siguientes valores:

- **'free'**: Usuario en período gratuito (valor predeterminado)
- **'pending'**: Usuario ha solicitado pago pero aún no lo ha completado
- **'paid'**: Usuario ha pagado y tiene acceso completo
- **'cancelled'**: Usuario ha cancelado su suscripción

## Flujos de Datos

### Creación de Usuarios Nuevos

Cuando un usuario interactúa por primera vez con el sistema, se sigue el siguiente flujo:

1. Se recibe un mensaje de WhatsApp con el número de teléfono del usuario.
2. Se verifica si el usuario existe en la base de datos.
3. Si no existe, se crea automáticamente un nuevo registro con:
   - `phone_number`: Número de teléfono del usuario
   - `messages_count`: 0
   - `subscription_status`: 'free'
   - `created_at`: Fecha y hora actual
4. El usuario puede comenzar a enviar mensajes inmediatamente, con un límite de 15 mensajes gratuitos.

### Flujo de Suscripciones y Pagos

El sistema utiliza Stripe para gestionar suscripciones y pagos:

1. **Inicio del proceso de pago**:
   - Cuando un usuario alcanza su límite de mensajes gratuitos, se le ofrece la opción de suscribirse.
   - Se genera un enlace de pago de Stripe y se envía al usuario.

2. **Proceso de pago completado**:
   - Stripe envía un webhook `checkout.session.completed` a la URL configurada.
   - El sistema verifica la autenticidad del webhook usando `STRIPE_WEBHOOK_SECRET`.
   - Si el usuario no existe en la base de datos (caso poco común), se crea automáticamente.
   - Se actualiza el estado del usuario a `subscription_status: 'paid'`.
   - Se establece la fecha de finalización de la suscripción según el plan (mensual o anual).
   - Se almacenan los IDs de cliente y suscripción de Stripe.

3. **Renovación de suscripción**:
   - Stripe envía un webhook `invoice.paid` cuando se procesa un pago recurrente.
   - El sistema actualiza la fecha de finalización de la suscripción.

4. **Cancelación de suscripción**:
   - Stripe envía un webhook `customer.subscription.deleted` cuando se cancela una suscripción.
   - El sistema actualiza el estado del usuario a `subscription_status: 'cancelled'`.
   - El usuario puede seguir usando el servicio hasta la fecha de finalización de su suscripción.

## Triggers y Funciones Automáticas

### Actualización de Timestamps

- **`update_updated_at_column()`**: Función que actualiza automáticamente el campo `updated_at` cuando se modifica un registro.
- **`update_users_updated_at`**: Trigger que ejecuta la función anterior antes de cada actualización en la tabla `users`.

### Gestión de Mensajes

- **`increment_messages_count()`**: Función que incrementa el contador de mensajes de un usuario.
- **`increment_user_messages_count`**: Trigger que ejecuta la función anterior después de insertar un nuevo mensaje.

## Funciones RPC (Remote Procedure Call)

### `increment_user_messages_count(user_phone text)`
Incrementa manualmente el contador de mensajes de un usuario identificado por su número de teléfono.

### `check_free_messages_limit(user_phone text)`
Verifica si un usuario ha alcanzado el límite de mensajes gratuitos (15 mensajes). Retorna:
- `can_send`: Si el usuario puede enviar más mensajes
- `message_count`: Número actual de mensajes
- `is_free`: Si el usuario está en período gratuito
- `is_at_limit`: Si el usuario está en su último mensaje gratuito

### `create_user(phone text)`
Crea un nuevo usuario con el número de teléfono especificado.

### `get_raw_message_count(phone_param TEXT)`
Obtiene el contador de mensajes raw directamente de la base de datos, junto con información adicional sobre el tipo de dato.

## Notas Importantes

- El límite de mensajes gratuitos está establecido en 15.
- Los mensajes enviados durante una suscripción pagada tienen el campo `is_paid = true` en la tabla `messages`.
- La función `check_free_messages_limit()` es crucial para determinar si un usuario puede enviar más mensajes o debe pagar.
- Los campos relacionados con Stripe (`stripe_customer_id` y `stripe_subscription_id`) permiten la integración con el sistema de pagos.
