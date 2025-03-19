-- Función para obtener el contador de mensajes raw directamente de la base de datos
CREATE OR REPLACE FUNCTION get_raw_message_count(phone_param TEXT)
RETURNS json AS $$
DECLARE
    result json;
BEGIN
    SELECT json_build_object(
        'user_id', id,
        'count', messages_count,
        'raw_type', pg_typeof(messages_count)
    ) INTO result
    FROM users
    WHERE phone_number = phone_param
    LIMIT 1;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;
