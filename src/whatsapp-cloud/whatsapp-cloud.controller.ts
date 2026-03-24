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
import { WHATSAPP_ONBOARDING_WEBHOOK_CTAS } from './utils/onboarding-webhook.constants';
import { matchesGreetingInterestedInput } from './utils/match-greeting-interested.util';
import { matchesVideoInterestedInput } from './utils/match-video-interested.util';

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
        if (messageType === 'button' || messageType === 'text') {
          const context = message.context as Record<string, unknown> | undefined;
          const contextMessageIdValue = context?.id;
          const contextMessageId =
            typeof contextMessageIdValue === 'string' ? contextMessageIdValue : '';

          const button = message.button as Record<string, unknown> | undefined;
          const buttonPayload = button?.payload;
          const buttonPayloadString = typeof buttonPayload === 'string' ? buttonPayload : '';
          const buttonTextValue = button?.text;
          const buttonTextString = typeof buttonTextValue === 'string' ? buttonTextValue : '';
          const text = message.text as Record<string, unknown> | undefined;
          const textBodyValue = text?.body;
          const textBodyString = typeof textBodyValue === 'string' ? textBodyValue : '';

          const contacts = value.contacts as Array<Record<string, unknown>> | undefined;
          const waIdValue = contacts?.[0]?.wa_id;
          const waId = typeof waIdValue === 'string' ? waIdValue : '';

          if (
            await this.handleGreetingMessageReply({
              buttonPayloadString,
              buttonTextString,
              textBodyString,
              contextMessageId,
              waId,
            })
          ) {
            continue;
          }

          if (
            await this.handleVideoMessageReply({
              buttonPayloadString,
              buttonTextString,
              textBodyString,
              contextMessageId,
              waId,
            })
          ) {
            continue;
          }

          if (messageType !== 'button' || !contextMessageId) continue;

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

  /**
   * Greeting template (`saludo_aspirante`) CTA: "Estoy Interesado" via button or text.
   * @returns true when this message matches the greeting CTA (emits CRM event only if `contextMessageId` is set).
   */
  private async handleGreetingMessageReply(input: {
    buttonPayloadString: string;
    buttonTextString: string;
    textBodyString: string;
    contextMessageId: string;
    waId: string;
  }): Promise<boolean> {
    const isGreetingInterested =
      matchesGreetingInterestedInput(input.buttonPayloadString) ||
      matchesGreetingInterestedInput(input.buttonTextString) ||
      matchesGreetingInterestedInput(input.textBodyString);
    if (!isGreetingInterested) return false;
    const resolvedPayload =
      input.buttonPayloadString ||
      input.buttonTextString ||
      input.textBodyString ||
      WHATSAPP_ONBOARDING_WEBHOOK_CTAS.greetingInterested;
    console.log({ waId: input.waId, greetingInterested: true });
    if (!input.contextMessageId) return true;
    await lastValueFrom(
      this.crmBackQueueClient.emit('ws_ms_event', {
        type: 'ws_ms_events',
        payload: {
          action: 'whatsapp.interested_button_clicked',
          greetingMessageId: input.contextMessageId,
          buttonPayload: resolvedPayload,
          fromWaId: input.waId,
        },
      }),
    );
    return true;
  }

  /**
   * Video template (`video_msj`) CTA: "Interesado" via button or text (optional quoted `contextMessageId`).
   * @returns true when this message matches the video CTA.
   */
  private async handleVideoMessageReply(input: {
    buttonPayloadString: string;
    buttonTextString: string;
    textBodyString: string;
    contextMessageId: string;
    waId: string;
  }): Promise<boolean> {
    const isVideoInterested =
      matchesVideoInterestedInput(input.buttonPayloadString) ||
      matchesVideoInterestedInput(input.buttonTextString) ||
      matchesVideoInterestedInput(input.textBodyString);
    if (!isVideoInterested) return false;
    if (!input.contextMessageId && !input.waId) return true;
    const resolvedPayload =
      input.buttonPayloadString ||
      input.buttonTextString ||
      input.textBodyString ||
      WHATSAPP_ONBOARDING_WEBHOOK_CTAS.videoInterested;
    console.log({ waId: input.waId, videoInterested: true });
    const videoPayload: Record<string, unknown> = {
      action: 'user.clicked_call_button',
      buttonPayload: resolvedPayload,
      fromWaId: input.waId,
    };
    if (input.contextMessageId.length > 0) {
      videoPayload.videoMessageId = input.contextMessageId;
    }
    await lastValueFrom(
      this.crmBackQueueClient.emit('ws_ms_event', {
        type: 'ws_ms_events',
        payload: videoPayload,
      }),
    );
    return true;
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
