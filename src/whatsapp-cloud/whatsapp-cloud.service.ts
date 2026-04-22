import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { format } from 'date-fns';
import { enUS, es } from 'date-fns/locale';
import { GraphApiError, WhatsAppClient } from '@kapso/whatsapp-cloud-api';
import { WHATSAPP_CLIENT } from './constants/whatsapp-client.token';
import { WhatsAppMessageTemplate } from './interfaces/message-template-type';
import { WsChatMsgHandlerService } from './ws-chat-msg-handler.service';
import {
  WHATSAPP_TEMPLATE_CONFIRMAR_CAPACITACION,
  WHATSAPP_TRAINING_SLOTS_LIST_MARKER,
} from './utils/onboarding-webhook.constants';

@Injectable()
export class WhatsappCloudService {
  private readonly logger = new Logger(WhatsappCloudService.name);

  public constructor(
    private readonly configService: ConfigService,
    @Inject(WHATSAPP_CLIENT) private readonly whatsAppClient: WhatsAppClient,
    private readonly wsChatMsgHandlerService: WsChatMsgHandlerService,
  ) {}

  private getPhoneNumberId(): string {
    const id = this.configService.get<string>('WHATSAPP_CLOUD_PHONE_NUMBER_ID');
    if (!id) {
      throw new Error('WHATSAPP_CLOUD_PHONE_NUMBER_ID is not configured');
    }
    return id;
  }

  /**
   * Business phone number id from env (same key used when persisting outbound sends).
   */
  public getConfiguredPhoneNumberId(): string {
    return this.getPhoneNumberId();
  }

  private mapGraphErrorToHttp(err: unknown): never {
    if (err instanceof GraphApiError) {
      const status =
        err.httpStatus >= 400 && err.httpStatus < 600 ? err.httpStatus : HttpStatus.BAD_GATEWAY;
      throw new HttpException(err.message, status);
    }
    if (err instanceof HttpException) {
      throw err;
    }
    throw new HttpException(
      err instanceof Error ? err.message : 'WhatsApp Cloud request failed',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private formatTrainingDateToSpanish(dateString: string): string {
    const dateObject: Date = new Date(dateString);
    if (Number.isNaN(dateObject.getTime())) {
      throw new HttpException('Invalid training date', HttpStatus.BAD_REQUEST);
    }
    const capitalizeFirstLetter = (input: string): string => {
      const trimmedInput: string = input.trim();
      if (!trimmedInput) return trimmedInput;
      return trimmedInput.charAt(0).toUpperCase() + trimmedInput.slice(1);
    };
    const removeDiacritics = (input: string): string => {
      return input.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    };
    const dayNameEs: string = format(dateObject, 'EEEE', { locale: es }).trim();
    const dayOfMonth: string = format(dateObject, 'd');
    const monthNameEs: string = format(dateObject, 'LLLL', { locale: es }).trim();
    const timeText: string = format(dateObject, 'h:mm a', { locale: enUS });
    const dayNameSpanishCapitalized: string = removeDiacritics(capitalizeFirstLetter(dayNameEs));
    const monthNameSpanishCapitalized: string = removeDiacritics(capitalizeFirstLetter(monthNameEs));
    return `${dayNameSpanishCapitalized} ${dayOfMonth} de ${monthNameSpanishCapitalized} a las ${timeText}`;
  }

  /**
   * Send a simple text message using Kapso WhatsApp client (Meta Graph).
   */
  public async sendTextMessage(to: string, body: string) {
    const phoneNumberId = this.getPhoneNumberId();
    try {
      const data = await this.whatsAppClient.messages.sendText({
        phoneNumberId,
        to,
        body,
        recipientType: 'individual',
      });
      this.logger.log(`📤 WhatsApp Cloud message sent to ${to}: ${JSON.stringify(data)}`);
      await this.wsChatMsgHandlerService.persistOutboundAfterSend({
        toWaId: to,
        phoneNumberId,
        response: data,
        type: 'text',
        textBody: body,
      });
      return {
        success: true,
        to,
        body,
        raw: data,
      };
    } catch (error) {
      this.logger.error(`Error sending WhatsApp Cloud message: ${(error as Error).message}`);
      this.mapGraphErrorToHttp(error);
    }
  }

  /**
   * Send a template message using Kapso sendRaw (preserves existing Meta JSON shape).
   */
  public async msgTemplate(messageTemplate: WhatsAppMessageTemplate) {
    const phoneNumberId = this.getPhoneNumberId();
    try {
      this.logger.log(`messageTemplate ${JSON.stringify(messageTemplate)}`);
      const data = await this.whatsAppClient.messages.sendRaw({
        phoneNumberId,
        payload: messageTemplate as unknown as Record<string, unknown>,
      });
      this.logger.log(
        `📤 WhatsApp Cloud template sent ${messageTemplate.template.name} to ${messageTemplate.to}: ${JSON.stringify(data)}`,
      );
      await this.wsChatMsgHandlerService.persistOutboundAfterSend({
        toWaId: messageTemplate.to,
        phoneNumberId,
        response: data,
        type: 'template',
        textBody: messageTemplate.template.name,
      });
      return data;
    } catch (error) {
      this.logger.error(`Error sending WhatsApp Cloud template: ${(error as Error).message}`);
      this.mapGraphErrorToHttp(error);
    }
  }

  public async sendInitialVideoTemplate(name: string, phoneNumber: string) {
    const templateMessage: WhatsAppMessageTemplate = {
      to: phoneNumber,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template: {
        name: 'saludo_inicial',
        language: {
          code: 'es',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: name,
                parameter_name: 'name',
              },
            ],
          },
        ],
      },
    };
    return this.msgTemplate(templateMessage);
  }

  public async sendHelloWorldTemplate(phoneNumber: string) {
    const templateMessage: WhatsAppMessageTemplate = {
      messaging_product: 'whatsapp',
      to: phoneNumber,
      recipient_type: 'individual',
      type: 'template',
      template: {
        name: 'hello_world',
        language: {
          code: 'en_US',
        },
      },
    };
    return this.msgTemplate(templateMessage);
  }

  public async sendTemplateInfoTrainingMessage({
    code,
    name,
    date,
    to,
  }: {
    code: string;
    name: string;
    date: string;
    to: string;
  }) {
    this.logger.log(
      `[sendTemplateProposalMessage] Sending proposal to ${to} (name: ${name}, date: ${date})`,
    );
    const formattedDate: string = this.formatTrainingDateToSpanish(date);
    const templateMessage: WhatsAppMessageTemplate = {
      to,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template: {
        name: 'info_capacitacion',
        language: {
          code: 'es_CO',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: name,
                parameter_name: 'contact_name',
              },
              {
                type: 'text',
                text: formattedDate,
                parameter_name: 'training_date',
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: 0,
            parameters: [
              {
                type: 'text',
                text: code,
              },
            ],
          },
        ],
      },
    };
    return this.msgTemplate(templateMessage);
  }

  public async sendTemplateNotificacionCapacitacionMessage(input: {
    phoneNumber: string;
    contactName: string;
    fecha: string;
    hora: string;
    googleMeetUrl: string;
  }): Promise<unknown> {
    const meetUrl = input.googleMeetUrl.trim().length > 0 ? input.googleMeetUrl.trim() : '-';
    const templateMessage: WhatsAppMessageTemplate = {
      to: input.phoneNumber,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template: {
        name: 'alerta_capacitacion',
        language: {
          code: 'es',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: input.contactName,
                parameter_name: 'contact_name',
              },
              {
                type: 'text',
                text: input.fecha,
                parameter_name: 'fecha',
              },
              {
                type: 'text',
                text: input.hora,
                parameter_name: 'hora',
              },
              {
                type: 'text',
                text: meetUrl,
                parameter_name: 'link_meet',
              },
            ],
          },
        ],
      },
    };
    return this.msgTemplate(templateMessage);
  }

  public async sendTemplateGreetingMessage(phoneNumber: string, name: string) {
    const templateMessage: WhatsAppMessageTemplate = {
      to: phoneNumber,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template: {
        name: 'saludo_estudiante',
        language: {
          code: 'es_CO',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: name,
                parameter_name: 'contact_name',
              },
            ],
          },
        ],
      },
    };
    this.logger.log(`templateMessage ${JSON.stringify(templateMessage, null, 2)}`);
    return this.msgTemplate(templateMessage);
  }

  /**
   * Sends `video_msj` with a header video. Meta requires an uploaded **media id** (`video.id`).
   */
  public async sendTemplateVideoMessage(phoneNumber: string, videoMediaId: string): Promise<unknown> {
    const resolvedId = videoMediaId.trim();
    if (resolvedId.length === 0) {
      throw new HttpException(
        'WhatsApp video template requires videoMediaId (provided by omega_office_back or API client)',
        HttpStatus.BAD_REQUEST,
      );
    }
    const templateMessage: WhatsAppMessageTemplate = {
      to: phoneNumber,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template: {
        name: 'video_msj',
        language: {
          code: 'es_CO',
        },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'video',
                video: {
                  id: resolvedId,
                },
              },
            ],
          },
        ],
      },
    };
    return this.msgTemplate(templateMessage);
  }

  public async sendTemplateConfirmarCapacitacionMessage(input: {
    phoneNumber: string;
    contactName: string;
  }) {
    const templateMessage: WhatsAppMessageTemplate = {
      to: input.phoneNumber,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template: {
        name: WHATSAPP_TEMPLATE_CONFIRMAR_CAPACITACION,
        language: {
          code: 'es',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: input.contactName,
                parameter_name: 'contact_name',
              },
            ],
          },
        ],
      },
    };
    return this.msgTemplate(templateMessage);
  }

  public async sendTemplateCallNotificationMessage(input: {
    phoneNumber: string;
    contactName: string;
  }) {
    const templateMessage: WhatsAppMessageTemplate = {
      to: input.phoneNumber,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template: {
        name: 'call_notification',
        language: {
          code: 'es',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: input.contactName,
                parameter_name: 'contact_name',
              },
            ],
          },
        ],
      },
    };
    return this.msgTemplate(templateMessage);
  }

  /**
   * Training reminder 12h — body: contact_name, date, time, link (Meet URL).
   * Meta template `capacitacion_12_hora`; align `parameter_name` with Business Manager if different.
   */
  public async sendTemplateCapacitacion12Hora(input: {
    phoneNumber: string;
    contactName: string;
    dateText: string;
    timeText: string;
    meetLink: string;
  }): Promise<unknown> {
    const link =
      input.meetLink.trim().length > 0 ? input.meetLink.trim() : '-';
    const templateMessage: WhatsAppMessageTemplate = {
      to: input.phoneNumber,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template: {
        name: 'capacitacion_12_hora',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: input.contactName,
                parameter_name: 'contact_name',
              },
              {
                type: 'text',
                text: input.dateText,
                parameter_name: 'date',
              },
              {
                type: 'text',
                text: input.timeText,
                parameter_name: 'time',
              },
              { type: 'text', text: link, parameter_name: 'link' },
            ],
          },
        ],
      },
    };
    return this.msgTemplate(templateMessage);
  }

  /** Training reminder 3h — contact_name, time, link. Template `capacitacion_3_hora`. */
  public async sendTemplateCapacitacion3Hora(input: {
    phoneNumber: string;
    contactName: string;
    timeText: string;
    meetLink: string;
  }): Promise<unknown> {
    const link =
      input.meetLink.trim().length > 0 ? input.meetLink.trim() : '-';
    const templateMessage: WhatsAppMessageTemplate = {
      to: input.phoneNumber,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template: {
        name: 'capacitacion_3_hora',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: input.contactName,
                parameter_name: 'contact_name',
              },
              {
                type: 'text',
                text: input.timeText,
                parameter_name: 'time',
              },
              { type: 'text', text: link, parameter_name: 'link' },
            ],
          },
        ],
      },
    };
    return this.msgTemplate(templateMessage);
  }

  /** Training reminder 45m — contact_name, link. Template `capacitacion_45_minutos`. */
  public async sendTemplateCapacitacion45Minutos(input: {
    phoneNumber: string;
    contactName: string;
    meetLink: string;
  }): Promise<unknown> {
    const link =
      input.meetLink.trim().length > 0 ? input.meetLink.trim() : '-';
    const templateMessage: WhatsAppMessageTemplate = {
      to: input.phoneNumber,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template: {
        name: 'capacitacion_45_minutos',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: input.contactName,
                parameter_name: 'contact_name',
              },
              { type: 'text', text: link, parameter_name: 'link' },
            ],
          },
        ],
      },
    };
    return this.msgTemplate(templateMessage);
  }

  /** Training reminder 5m — contact_name, link. Template `capacitacion_5_minutos`. */
  public async sendTemplateCapacitacion5Minutos(input: {
    phoneNumber: string;
    contactName: string;
    meetLink: string;
  }): Promise<unknown> {
    const link =
      input.meetLink.trim().length > 0 ? input.meetLink.trim() : '-';
    const templateMessage: WhatsAppMessageTemplate = {
      to: input.phoneNumber,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template: {
        name: 'capacitacion_5_minutos',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: input.contactName,
                parameter_name: 'contact_name',
              },
              { type: 'text', text: link, parameter_name: 'link' },
            ],
          },
        ],
      },
    };
    return this.msgTemplate(templateMessage);
  }

  /**
   * Sends an image message (id or link) via Kapso; persists outbound row.
   */
  public async sendImageMessage(input: {
    to: string;
    image: { id?: string; link?: string; caption?: string };
  }) {
    const phoneNumberId = this.getPhoneNumberId();
    try {
      const data = await this.whatsAppClient.messages.sendImage({
        phoneNumberId,
        to: input.to,
        recipientType: 'individual',
        image: input.image,
      });
      await this.wsChatMsgHandlerService.persistOutboundAfterSend({
        toWaId: input.to,
        phoneNumberId,
        response: data,
        type: 'image',
        caption: input.image.caption,
        media: {
          whatsappMediaId: input.image.id,
        },
      });
      return data;
    } catch (error) {
      this.mapGraphErrorToHttp(error);
    }
  }

  /**
   * Sends a document message via Kapso; persists outbound row.
   */
  public async sendDocumentMessage(input: {
    to: string;
    document: { id?: string; link?: string; caption?: string; filename?: string };
  }) {
    const phoneNumberId = this.getPhoneNumberId();
    try {
      const data = await this.whatsAppClient.messages.sendDocument({
        phoneNumberId,
        to: input.to,
        recipientType: 'individual',
        document: input.document,
      });
      await this.wsChatMsgHandlerService.persistOutboundAfterSend({
        toWaId: input.to,
        phoneNumberId,
        response: data,
        type: 'document',
        caption: input.document.caption,
        media: {
          whatsappMediaId: input.document.id,
          filename: input.document.filename,
        },
      });
      return data;
    } catch (error) {
      this.mapGraphErrorToHttp(error);
    }
  }

  /**
   * Sends a video message via Kapso; persists outbound row.
   */
  public async sendVideoMessage(input: {
    to: string;
    video: { id?: string; link?: string; caption?: string };
  }) {
    const phoneNumberId = this.getPhoneNumberId();
    try {
      const data = await this.whatsAppClient.messages.sendVideo({
        phoneNumberId,
        to: input.to,
        recipientType: 'individual',
        video: input.video,
      });
      await this.wsChatMsgHandlerService.persistOutboundAfterSend({
        toWaId: input.to,
        phoneNumberId,
        response: data,
        type: 'video',
        caption: input.video.caption,
        media: { whatsappMediaId: input.video.id },
      });
      return data;
    } catch (error) {
      this.mapGraphErrorToHttp(error);
    }
  }

  /**
   * Sends an audio message via Kapso; persists outbound row.
   */
  public async sendAudioMessage(input: {
    to: string;
    audio: { id?: string; link?: string; voice?: boolean };
  }) {
    const phoneNumberId = this.getPhoneNumberId();
    try {
      const data = await this.whatsAppClient.messages.sendAudio({
        phoneNumberId,
        to: input.to,
        recipientType: 'individual',
        audio: input.audio,
      });
      await this.wsChatMsgHandlerService.persistOutboundAfterSend({
        toWaId: input.to,
        phoneNumberId,
        response: data,
        type: 'audio',
        media: { whatsappMediaId: input.audio.id },
      });
      return data;
    } catch (error) {
      this.mapGraphErrorToHttp(error);
    }
  }

  /**
   * Sends a sticker message via Kapso; persists outbound row.
   */
  public async sendStickerMessage(input: { to: string; sticker: { id?: string; link?: string } }) {
    const phoneNumberId = this.getPhoneNumberId();
    try {
      const data = await this.whatsAppClient.messages.sendSticker({
        phoneNumberId,
        to: input.to,
        recipientType: 'individual',
        sticker: input.sticker,
      });
      await this.wsChatMsgHandlerService.persistOutboundAfterSend({
        toWaId: input.to,
        phoneNumberId,
        response: data,
        type: 'sticker',
        media: { whatsappMediaId: input.sticker.id },
      });
      return data;
    } catch (error) {
      this.mapGraphErrorToHttp(error);
    }
  }

  /**
   * Sends a WhatsApp interactive list message (training slot picker). Persists outbound with a stable marker.
   */
  public async sendInteractiveTrainingSlotsListMessage(input: {
    to: string;
    interactive: Record<string, unknown>;
  }) {
    const phoneNumberId = this.getPhoneNumberId();
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to,
      type: 'interactive',
      interactive: input.interactive,
    };
    console.log('payload', JSON.stringify(payload, null, 2));
    try {
      const data = await this.whatsAppClient.messages.sendRaw({
        phoneNumberId,
        payload,
      });
      this.logger.log(`📤 WhatsApp interactive list sent to ${input.to}: ${JSON.stringify(data)}`);
      await this.wsChatMsgHandlerService.persistOutboundAfterSend({
        toWaId: input.to,
        phoneNumberId,
        response: data,
        type: 'interactive',
        textBody: WHATSAPP_TRAINING_SLOTS_LIST_MARKER,
      });
      return data;
    } catch (error) {
      this.logger.error(
        `Error sending WhatsApp interactive list: ${(error as Error).message}`,
      );
      this.mapGraphErrorToHttp(error);
    }
  }

  /**
   * Uploads media bytes to WhatsApp and returns the media id.
   */
  public async uploadMediaFile(input: { type: string; file: Buffer; fileName?: string }) {
    const phoneNumberId = this.getPhoneNumberId();
    try {
      return await this.whatsAppClient.media.upload({
        phoneNumberId,
        type: input.type,
        file: input.file,
        fileName: input.fileName,
        messagingProduct: 'whatsapp',
      });
    } catch (error) {
      this.mapGraphErrorToHttp(error);
    }
  }
}
