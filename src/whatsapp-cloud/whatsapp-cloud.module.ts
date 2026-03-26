import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { WhatsappCloudController } from './whatsapp-cloud.controller';
import { WhatsappOnboardingEventsController } from './whatsapp-onboarding-events.controller';
import { DeepSeekService } from './deep-seek.service';

@Module({
  imports: [
    ConfigModule,
    ClientsModule.registerAsync([
      {
        name: 'CRM_BACK_QUEUE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => {
          const rabbitMqUser = configService.get<string>('RABBIT_MQ_USER', 'guest');
          const rabbitMqPass = configService.get<string>('RABBIT_MQ_PASS', 'guest');
          const rabbitMqUrl = `amqp://${rabbitMqUser}:${rabbitMqPass}@localhost:5672`;
          return {
            transport: Transport.RMQ,
            options: {
              urls: [rabbitMqUrl],
              queue: 'crm_back_queue', // where MS2 is listening
              queueOptions: { durable: true },
            },
          };
        },
        inject: [ConfigService],
      },
    ]),
    HttpModule.register({
      timeout: 10000,
      maxRedirects: 5,
    }),
  ],
  controllers: [WhatsappCloudController, WhatsappOnboardingEventsController],
  providers: [WhatsappCloudService, DeepSeekService],
  exports: [WhatsappCloudService, DeepSeekService],
})
export class WhatsappCloudModule {}

