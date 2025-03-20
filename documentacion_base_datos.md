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
| `stripe_customer_id` | text | ID del cliente en Stripe |
| `stripe_subscription_id` | text | ID de la suscripción en Stripe |
| `conversation_summary` | text | Resumen de la conversación actual |
| `conversation_context` | json | Contexto de la conversación en formato JSON |
| `conversation_history` | json | Historial de la conversación en formato JSON |

### Tabla `messages`

Almacena los mensajes intercambiados entre usuarios y el sistema.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | bigint | Identificador único del mensaje (clave primaria) |
| `user_id` | uuid | Referencia al usuario que envió el mensaje |
| `question` | text | Pregunta o mensaje enviado por el usuario |
| `response` | text | Respuesta generada por el sistema |
| `is_paid` | boolean | Indica si el mensaje fue enviado durante una suscripción pagada |
| `tokens_used` | integer | Número de tokens utilizados en la generación de la respuesta |
| `created_at` | timestamptz | Fecha de creación del mensaje |

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

## Flujo de Suscripción y Pagos

1. **Registro inicial**: Cuando un usuario nuevo envía un mensaje, se crea un registro en la tabla `users` con `subscription_status = 'free'`.

2. **Período gratuito**: El usuario puede enviar hasta 15 mensajes gratuitos.

3. **Notificación de límite**: Al llegar al mensaje número 14, el sistema notifica al usuario que le queda un mensaje gratuito.

4. **Solicitud de pago**: Al alcanzar el límite, se envía un enlace de pago y se actualiza el estado a `subscription_status = 'pending'`.

5. **Pago completado**: Cuando el usuario completa el pago, se actualiza a `subscription_status = 'paid'` y se establece `subscription_end_date`.

6. **Cancelación**: Si el usuario cancela su suscripción, se actualiza a `subscription_status = 'cancelled'`.

## Notas Importantes

- El límite de mensajes gratuitos está establecido en 15.
- Los mensajes enviados durante una suscripción pagada tienen el campo `is_paid = true` en la tabla `messages`.
- La función `check_free_messages_limit()` es crucial para determinar si un usuario puede enviar más mensajes o debe pagar.
- Los campos relacionados con Stripe (`stripe_customer_id` y `stripe_subscription_id`) permiten la integración con el sistema de pagos.
