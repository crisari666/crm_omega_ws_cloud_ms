import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { WhatsappCloudController } from './whatsapp-cloud.controller';
import { WhatsappOnboardingEventsController } from './whatsapp-onboarding-events.controller';
import { WhatsappChatController } from './whatsapp-chat.controller';
import { DeepSeekService } from './deep-seek.service';
import { WhatsappChat, WhatsappChatSchema } from './schemas/whatsapp-chat.schema';
import { WhatsappMessage, WhatsappMessageSchema } from './schemas/whatsapp-message.schema';
import { WhatsappLocalMediaStorageService } from './whatsapp-local-media-storage.service';
import { WsChatMsgHandlerService } from './ws-chat-msg-handler.service';
import { whatsappClientProvider } from './providers/whatsapp-client.provider';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: WhatsappChat.name, schema: WhatsappChatSchema },
      { name: WhatsappMessage.name, schema: WhatsappMessageSchema },
    ]),
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
  controllers: [
    WhatsappCloudController,
    WhatsappOnboardingEventsController,
    WhatsappChatController,
  ],
  providers: [
    whatsappClientProvider,
    WhatsappLocalMediaStorageService,
    WsChatMsgHandlerService,
    WhatsappCloudService,
    DeepSeekService,
  ],
  exports: [WhatsappCloudService, DeepSeekService, WsChatMsgHandlerService],
})
export class WhatsappCloudModule {}
