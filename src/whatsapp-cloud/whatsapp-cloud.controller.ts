import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Inject,
} from '@nestjs/common';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { DeepSeekService } from './deep-seek.service';
import { SendTextDto } from './dto/send-text.dto';
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
import { WHATSAPP_ECOSYSTEM_HEALTH_DELIVERY_ERROR_CODE } from './utils/whatsapp-ecosystem-delivery.constants';

@Controller('whatsapp-cloud')
export class WhatsappCloudController {
  private readonly logger = new Logger(WhatsappCloudController.name);

  public constructor(
    private readonly whatsappCloudService: WhatsappCloudService,
    private readonly deepSeekService: DeepSeekService,
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
    console.log('webhookPost', JSON.stringify(dto, null, 2));
    const payload = dto as Record<string, unknown>;
    const entry = payload.entry as Array<Record<string, unknown>> | undefined;
    const firstEntry = entry?.[0];
    const changes = firstEntry?.changes as Array<Record<string, unknown>> | undefined;
    const firstChange = changes?.[0];
    const value = firstChange?.value as Record<string, unknown> | undefined;
    if (!value) return HttpStatus.OK;
    // Button click webhook (interactive message)
    const messagesValue = value.messages as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(messagesValue)) {
      for (const message of messagesValue) {
        if (message == null || typeof message !== 'object') continue;
        const messageRecord = message as Record<string, unknown>;
        await this.emitInboundUserMessageToCrmBack(value, messageRecord);
        const messageType = messageRecord.type;
        console.log({ messageType });
        if (messageType === 'button' || messageType === 'text') {
          const context = messageRecord.context as Record<string, unknown> | undefined;
          const contextMessageIdValue = context?.id;
          const contextMessageId =
            typeof contextMessageIdValue === 'string' ? contextMessageIdValue : '';

          const button = messageRecord.button as Record<string, unknown> | undefined;
          const buttonPayload = button?.payload;
          const buttonPayloadString = typeof buttonPayload === 'string' ? buttonPayload : '';
          const buttonTextValue = button?.text;
          const buttonTextString = typeof buttonTextValue === 'string' ? buttonTextValue : '';
          const text = messageRecord.text as Record<string, unknown> | undefined;
          const textBodyValue = text?.body;
          const textBodyString = typeof textBodyValue === 'string' ? textBodyValue : '';

          const contacts = value.contacts as Array<Record<string, unknown>> | undefined;
          const waIdValue = contacts?.[0]?.wa_id;
          const waId = typeof waIdValue === 'string' ? waIdValue : '';
          const profile = contacts?.[0]?.profile as Record<string, unknown> | undefined;
          const contactName =
            typeof profile?.name === 'string' && profile.name.trim().length > 0
              ? profile.name.trim()
              : undefined;

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

          if (messageType === 'text' && textBodyString.trim().length > 0) {
            await this.maybeSendDeepSeekLotesReply({
              waId,
              textBody: textBodyString.trim(),
              contactName,
            });
            continue;
          }

          if (
            messageType === 'button' &&
            contextMessageId.length === 0 &&
            (buttonTextString.length > 0 || buttonPayloadString.length > 0)
          ) {
            const snippet = [buttonTextString, buttonPayloadString]
              .filter((s) => s.length > 0)
              .join(' ');
            if (snippet.length > 0) {
              await this.maybeSendDeepSeekLotesReply({
                waId,
                textBody: snippet,
                contactName,
              });
            }
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

    const statusesValue = value.statuses as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(statusesValue)) {
      for (const status of statusesValue) {
        const ecosystemPayload = this.extractEcosystemBlockedDeliveryPayload(status);
        if (ecosystemPayload != null) {
          await lastValueFrom(
            this.crmBackQueueClient.emit('ws_ms_event', {
              type: 'ws_ms_events',
              payload: {
                action: 'whatsapp.message_not_delivered_ecosystem',
                ...ecosystemPayload,
              },
            }),
          );
          continue;
        }
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
   * La Ceiba chat (DeepSeek): replies when the message is not handled by onboarding CTAs.
   */
  private async maybeSendDeepSeekLotesReply(input: {
    waId: string;
    textBody: string;
    contactName?: string;
  }): Promise<void> {
    if (input.waId.length === 0) return;
    try {
      const reply = await this.deepSeekService.replyLotesChat({
        userMessage: input.textBody,
        contactName: input.contactName,
      });
      if (reply.length === 0) return;
      await this.whatsappCloudService.sendTextMessage(input.waId, reply);
      try {
        await lastValueFrom(
          this.crmBackQueueClient.emit('ws_ms_event', {
            type: 'ws_ms_events',
            payload: {
              action: 'whatsapp.deepseek_lotes_chat_turn',
              fromWaId: input.waId,
              userMessage: input.textBody,
              aiResponse: reply,
              ...(input.contactName != null && input.contactName.length > 0
                ? { contactName: input.contactName }
                : {}),
            },
          }),
        );
      } catch (emitErr) {
        const emitMessage = emitErr instanceof Error ? emitErr.message : String(emitErr);
        this.logger.warn(`emit deepseek_lotes_chat_turn to CRM failed: ${emitMessage}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`maybeSendDeepSeekLotesReply failed: ${message}`);
    }
  }

  /**
   * Persists inbound WhatsApp user messages on the monolith onboarding flow (`whatsapp.user_message_received`).
   */
  private async emitInboundUserMessageToCrmBack(
    value: Record<string, unknown>,
    message: Record<string, unknown>,
  ): Promise<void> {
    const payload = this.buildWhatsappInboundUserMessagePayload(value, message);
    const whatsappMessageId =
      typeof payload.whatsappMessageId === 'string' ? payload.whatsappMessageId : '';
    const fromWaId = typeof payload.fromWaId === 'string' ? payload.fromWaId : '';
    if (whatsappMessageId.length === 0 || fromWaId.length === 0) {
      return;
    }
    await lastValueFrom(
      this.crmBackQueueClient.emit('ws_ms_event', {
        type: 'ws_ms_events',
        payload,
      }),
    );
  }

  /**
   * Maps WhatsApp Cloud webhook `messages[]` item + parent `value` to CRM-back onboarding payload.
   */
  private buildWhatsappInboundUserMessagePayload(
    value: Record<string, unknown>,
    message: Record<string, unknown>,
  ): Record<string, unknown> {
    const metadata = value.metadata as Record<string, unknown> | undefined;
    const contacts = value.contacts as Array<Record<string, unknown>> | undefined;
    const profile = contacts?.[0]?.profile as Record<string, unknown> | undefined;
    const fromValue = message.from;
    const fromWaId = typeof fromValue === 'string' ? fromValue : '';
    const waIdFromContacts = contacts?.[0]?.wa_id;
    const resolvedWaId =
      fromWaId.length > 0
        ? fromWaId
        : typeof waIdFromContacts === 'string'
          ? waIdFromContacts
          : '';
    const messageIdValue = message.id;
    const whatsappMessageId = typeof messageIdValue === 'string' ? messageIdValue : '';
    const timestampValue = message.timestamp;
    const timestamp =
      typeof timestampValue === 'string'
        ? timestampValue
        : timestampValue != null
          ? String(timestampValue)
          : '';
    const messageTypeRaw = message.type;
    const messageTypeString = typeof messageTypeRaw === 'string' ? messageTypeRaw : '';
    const context = message.context as Record<string, unknown> | undefined;
    const contextMessageId = typeof context?.id === 'string' ? context.id : '';
    const button = message.button as Record<string, unknown> | undefined;
    const text = message.text as Record<string, unknown> | undefined;
    const textBody = typeof text?.body === 'string' ? text.body : '';
    return {
      action: 'whatsapp.user_message_received',
      fromWaId: resolvedWaId,
      whatsappMessageId,
      messageType: messageTypeString,
      timestamp,
      textBody,
      buttonPayload: typeof button?.payload === 'string' ? button.payload : '',
      buttonText: typeof button?.text === 'string' ? button.text : '',
      contextMessageId,
      profileName: typeof profile?.name === 'string' ? profile.name : '',
      phoneNumberId: typeof metadata?.phone_number_id === 'string' ? metadata.phone_number_id : '',
      displayPhoneNumber:
        typeof metadata?.display_phone_number === 'string' ? metadata.display_phone_number : '',
    };
  }

  /**
   * When WhatsApp blocks delivery for ecosystem health (e.g. code 131049), returns payload for CRM-back.
   */
  private extractEcosystemBlockedDeliveryPayload(
    status: Record<string, unknown>,
  ): {
    messageId: string;
    recipientId: string;
    code: number;
    title: string;
    message: string;
    errorDetails: string;
  } | null {
    const statusValue = status.status;
    if (statusValue !== 'failed') {
      return null;
    }
    const errorsRaw = status.errors;
    if (!Array.isArray(errorsRaw) || errorsRaw.length === 0) {
      return null;
    }
    const firstError = errorsRaw[0] as Record<string, unknown>;
    const codeRaw = firstError.code;
    const code =
      typeof codeRaw === 'number' ? codeRaw : codeRaw != null ? Number(codeRaw) : Number.NaN;
    if (Number.isNaN(code) || code !== WHATSAPP_ECOSYSTEM_HEALTH_DELIVERY_ERROR_CODE) {
      return null;
    }
    const messageIdValue = status.id;
    const messageId = typeof messageIdValue === 'string' ? messageIdValue : '';
    if (messageId.length === 0) {
      return null;
    }
    const recipientIdValue = status.recipient_id;
    const recipientId = typeof recipientIdValue === 'string' ? recipientIdValue : '';
    const title = typeof firstError.title === 'string' ? firstError.title : '';
    const message = typeof firstError.message === 'string' ? firstError.message : '';
    const errorData = firstError.error_data as Record<string, unknown> | undefined;
    const detailsRaw = errorData?.details;
    const errorDetails = typeof detailsRaw === 'string' ? detailsRaw : '';
    return { messageId, recipientId, code, title, message, errorDetails };
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
    const { videoId, to } = dto;
    return this.whatsappCloudService.sendTemplateVideoMessage(to, videoId);
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
