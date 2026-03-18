import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.APP_PORT;

  app.setGlobalPrefix('ws-cloud');

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const rabbitMqUser = process.env.RABBIT_MQ_USER || 'guest';
  const rabbitMqPass = process.env.RABBIT_MQ_PASS || 'guest';
  const rabbitMqUrl = `amqp://${rabbitMqUser}:${rabbitMqPass}@localhost:5672`;

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [rabbitMqUrl],
      queue: 'ws_ms_queue',
      queueOptions: {
        durable: true, // 👈 asegura persistencia
      },
    },
  });
  await app.startAllMicroservices();

  await app.listen(port);
  console.log(`Whatsapp Cloud Microservice is running on port ${port}`);
}
bootstrap();
