import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Inject,
} from '@nestjs/common';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { SendTextDto } from './dto/send-text.dto';
import { SendInitialVideoDto } from './dto/send-initial-video.dto';
import { SendHelloWorldTemplateDto } from './dto/send-hellow-world-template.dto';
import { SendTemplateInfoTrainingDto } from './dto/send-template-info-training.dto';
import { SendTemplateGreetingDto } from './dto/send-template-greeting.dto';
import { SendTemplateVideoDto } from './dto/send-template-video.dto';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { SendTemplateCallNotificationDto } from './dto/send-template-call-notification.dto';

/** Quick-reply / button payload on saludo_aspirante template (greeting CTA). */
const GREETING_INTERESTED_BUTTON_LABEL = 'Estoy Interesado';

@Controller('whatsapp-cloud')
export class WhatsappCloudController {
  public constructor(
    private readonly whatsappCloudService: WhatsappCloudService,
    @Inject('CRM_BACK_QUEUE') private readonly crmBackQueueClient: ClientProxy,
  ) {}

  /**
   * Simple endpoint to send a text message via WhatsApp Cloud API
   */
  @Post('messages/text')
  @HttpCode(HttpStatus.OK)
  async sendText(@Body() dto: SendTextDto) {
    const { to, body } = dto;
    return this.whatsappCloudService.sendTextMessage(to, body);
  }

  /**
   * Endpoint to send the \"initial_video\" template message
   */
  @Post('messages/template/initial-video')
  @HttpCode(HttpStatus.OK)
  async sendInitialVideo(@Body() dto: SendInitialVideoDto) {
    const { to, name } = dto;
    return this.whatsappCloudService.sendInitialVideoTemplate(name, to);
  }

  @Post('messages/template/hello-world')
  @HttpCode(HttpStatus.OK)
  async sendHelloWorld(@Body() dto: SendHelloWorldTemplateDto) {
    const { to } = dto;
    return this.whatsappCloudService.sendHelloWorldTemplate(to);
  }

  @Get('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(req: Request, @Query() query: any) {
    console.log({ query });
    return query['hub.challenge']
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhookPost(@Body() dto: unknown): Promise<HttpStatus> {
    // console.log('webhookPost', JSON.stringify(dto, null, 2));
    const payload = dto as Record<string, unknown>;
    const entry = payload.entry as Array<Record<string, unknown>> | undefined;
    const firstEntry = entry?.[0];
    const changes = firstEntry?.changes as Array<Record<string, unknown>> | undefined;
    const firstChange = changes?.[0];
    const value = firstChange?.value as Record<string, unknown> | undefined;
    if (!value) return HttpStatus.OK;
    console.log({dto: JSON.stringify(dto, null, 2)});
    // Button click webhook (interactive message)
    const messagesValue = value.messages as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(messagesValue)) {
      for (const message of messagesValue) {
        const messageType = message.type;
        console.log({messageType, });
        if (messageType === 'button') {
          const context = message.context as Record<string, unknown> | undefined;
          const contextMessageIdValue = context?.id;
          const contextMessageId =
            typeof contextMessageIdValue === 'string' ? contextMessageIdValue : '';
          if (!contextMessageId) continue;

          const button = message.button as Record<string, unknown> | undefined;
          const buttonPayload = button?.payload;
          const buttonPayloadString = typeof buttonPayload === 'string' ? buttonPayload : '';
          const buttonTextValue = button?.text;
          const buttonTextString = typeof buttonTextValue === 'string' ? buttonTextValue : '';
          const isGreetingInterestedClick =
            buttonPayloadString === GREETING_INTERESTED_BUTTON_LABEL ||
            buttonTextString === GREETING_INTERESTED_BUTTON_LABEL;

          const contacts = value.contacts as Array<Record<string, unknown>> | undefined;
          const waIdValue = contacts?.[0]?.wa_id;
          const waId = typeof waIdValue === 'string' ? waIdValue : '';

          console.log({ waId });

          if (isGreetingInterestedClick) {
            await lastValueFrom(
              this.crmBackQueueClient.emit('ws_ms_event', {
                type: 'ws_ms_events',
                payload: {
                  action: 'whatsapp.interested_button_clicked',
                  greetingMessageId: contextMessageId,
                  buttonPayload: buttonPayloadString || buttonTextString,
                  fromWaId: waId,
                },
              }),
            );
            continue;
          }

          await lastValueFrom(
            this.crmBackQueueClient.emit('ws_ms_event', {
              type: 'ws_ms_events',
              payload: {
                action: 'user.clicked_call_button',
                videoMessageId: contextMessageId,
                buttonPayload: buttonPayloadString || null,
                fromWaId: waId,
              },
            }),
          );
        }
      }

    }

    // Status webhooks (sent/delivered)
    const statusesValue = value.statuses as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(statusesValue)) {
      for (const status of statusesValue) {
        const statusValue = status.status;
        if (statusValue !== 'delivered') continue;

        const messageIdValue = status.id;
        const messageId = typeof messageIdValue === 'string' ? messageIdValue : '';
        if (!messageId) continue;

        await lastValueFrom(
          this.crmBackQueueClient.emit('ws_ms_event', {
            type: 'ws_ms_events',
            payload: {
              action: 'whatsapp.message_delivered',
              messageId,
            },
          }),
        );
      }
    }

    return HttpStatus.OK;
  }

  @Post('messages/template/info-capacitacion')
  @HttpCode(HttpStatus.OK)
  async sendTemplateProposal(@Body() dto: SendTemplateInfoTrainingDto) {
    const { code, name, date, to } = dto;
    return this.whatsappCloudService.sendTemplateInfoTrainingMessage({code, name, date, to});
  }

  @Post('messages/template/greeting')
  @HttpCode(HttpStatus.OK)
  async sendTemplateGreeting(@Body() dto: SendTemplateGreetingDto) {
    const { name, to } = dto;
    return this.whatsappCloudService.sendTemplateGreetingMessage(to, name);
  }

  @Post('messages/template/video')
  @HttpCode(HttpStatus.OK)
  async sendTemplateVideo(@Body() dto: SendTemplateVideoDto) {
    const { videoUrl, to } = dto;
    return this.whatsappCloudService.sendTemplateVideoMessage(to, videoUrl);
  }

  @Post('messages/template/call-notification')
  @HttpCode(HttpStatus.OK)
  async sendTemplateCallNotification(@Body() dto: SendTemplateCallNotificationDto) {
    const { to, contactName } = dto;
    return this.whatsappCloudService.sendTemplateCallNotificationMessage({
      phoneNumber: to,
      contactName,
    });
  }
}
