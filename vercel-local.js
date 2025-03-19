// Script para simular el entorno de Vercel localmente
require('dotenv').config();
const http = require('http');
const app = require('./index');

// Simular variables de entorno de Vercel
process.env.VERCEL = '1';
process.env.VERCEL_URL = 'localhost:3000';
// Establecer la URL base para el entorno local
process.env.BASE_URL = 'http://localhost:3000';
// Establecer la URL del webhook para el entorno local
process.env.WEBHOOK_URL = 'http://localhost:3000/webhook';
// Establecer la URL de suscripción para el entorno local
process.env.SUBSCRIPTION_URL = 'http://localhost:3000/subscribe';
// Establecer las URLs de redirección de Stripe para el entorno local
process.env.CHECKOUT_SUCCESS_URL = 'http://localhost:3000/checkout-success';
process.env.CHECKOUT_CANCEL_URL = 'http://localhost:3000/checkout-cancel';
// Establecer la URL del webhook de Stripe para el entorno local
process.env.STRIPE_WEBHOOK_URL = 'http://localhost:3000/stripe-webhook';

// Crear un servidor HTTP que maneje las solicitudes
const server = http.createServer(app);

// Usar específicamente el puerto 3000
const PORT = 3000;

// Manejar errores de puerto en uso
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`El puerto ${PORT} ya está en uso. Por favor, cierra cualquier otra aplicación que esté usando este puerto e intenta nuevamente.`);
    process.exit(1);
  } else {
    console.error('Error al iniciar el servidor:', error);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Servidor simulando Vercel en http://localhost:${PORT}`);
  console.log('Variables de entorno de Vercel simuladas:');
  console.log(`- VERCEL: ${process.env.VERCEL}`);
  console.log(`- VERCEL_URL: ${process.env.VERCEL_URL}`);
});
