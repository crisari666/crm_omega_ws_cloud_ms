import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { format } from 'date-fns';
import { enUS, es } from 'date-fns/locale';
import { WhatsAppMessageTemplate } from './interfaces/message-template-type';
import {
  WhatsappCloudApiError,
  WhatsappCloudTextMessagePayload,
} from './interfaces/whatsapp-cloud-api-types';

@Injectable()
export class WhatsappCloudService {
  private readonly logger = new Logger(WhatsappCloudService.name);
  private readonly graphBaseUrl = 'https://graph.facebook.com';

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  private getAccessToken(): string {
    const token = this.configService.get<string>('WHATSAPP_CLOUD_ACCESS_TOKEN');
    if (!token) {
      throw new Error('WHATSAPP_CLOUD_ACCESS_TOKEN is not configured');
    }
    return token;
  }

  private getPhoneNumberId(): string {
    const id = this.configService.get<string>('WHATSAPP_CLOUD_PHONE_NUMBER_ID');
    if (!id) {
      throw new Error('WHATSAPP_CLOUD_PHONE_NUMBER_ID is not configured');
    }
    return id;
  }

  private getApiVersion(): string {
    return this.configService.get<string>('WHATSAPP_CLOUD_API_VERSION', 'v23.0');
  }

  private formatTrainingDateToSpanish(dateString: string): string {
    const dateObject: Date = new Date(dateString);
    if (Number.isNaN(dateObject.getTime())) {
      throw new HttpException(
        'Invalid training date',
        HttpStatus.BAD_REQUEST,
      );
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
   * Send a simple text message using WhatsApp Cloud API
   */
  async sendTextMessage(to: string, body: string) {
    try {
      const phoneNumberId = this.getPhoneNumberId();
      const accessToken = this.getAccessToken();
      const apiVersion = this.getApiVersion();
      const url = `${this.graphBaseUrl}/${apiVersion}/${phoneNumberId}/messages`;
      const payload: WhatsappCloudTextMessagePayload = {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      };
      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      );
      const data = response.data;
      this.logger.log(
        `📤 WhatsApp Cloud message sent to ${to}: ${JSON.stringify(data)}`,
      );
      return {
        success: true,
        to,
        body,
        raw: data,
      };
    } catch (error) {
      const axiosError = error as { response?: { status: number; data?: WhatsappCloudApiError } };
      this.logger.error(
        `Error sending WhatsApp Cloud message: ${(error as Error).message}`,
      );
      if (axiosError.response) {
        const apiError = axiosError.response.data as WhatsappCloudApiError;
        throw new HttpException(
          apiError?.error?.message || 'Failed to send WhatsApp Cloud message',
          HttpStatus.BAD_GATEWAY,
        );
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to send WhatsApp Cloud message',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Send a template message using WhatsApp Cloud API
   */
  async msgTemplate(messageTemplate: WhatsAppMessageTemplate) {
    try {
      const url = `${this.graphBaseUrl}/${this.getApiVersion()}/${this.getPhoneNumberId()}/messages`;
      console.log('messageTemplate', JSON.stringify(messageTemplate, null, 2));
      console.log('url', url);
      const response = await firstValueFrom(
        this.httpService.post(url, messageTemplate, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.getAccessToken()}`,
          },
        }),
      );
      this.logger.log(
        `📤 WhatsApp Cloud template sent ${messageTemplate.template.name} to ${messageTemplate.to}: ${JSON.stringify(response.data)}`,
      );
      return response.data;
    } catch (error) {
      const axiosError = error as { response?: { data?: WhatsappCloudApiError } };
      this.logger.error(
        `Error sending WhatsApp Cloud template: ${(error as Error).message}`,
      );
      if (axiosError.response?.data) {
        this.logger.error(
          `WhatsApp Cloud API error: ${JSON.stringify(axiosError.response.data)}`,
        );
        throw new HttpException(
          (axiosError.response.data as WhatsappCloudApiError)?.error?.message ||
            'Failed to send WhatsApp Cloud template',
          HttpStatus.BAD_GATEWAY,
        );
      }
      throw new HttpException(
        'Failed to send WhatsApp Cloud template',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Send the \"initial_video\" template using WhatsApp Cloud API
   */
  async sendInitialVideoTemplate(name: string, phoneNumber: string) {
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

  async sendHelloWorldTemplate(phoneNumber: string) {
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



  async sendTemplateInfoTrainingMessage({code, name, date, to}: {code: string, name: string, date: string, to: string}) {
    this.logger.log(
      `[sendTemplateProposalMessage] Sending proposal to ${to} (name: ${name})`,
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
            ]
        }
        ]
      },
    };
    return this.msgTemplate(templateMessage);
  }

  async sendTemplateGreetingMessage(phoneNumber: string, name: string) {
    const templateMessage: WhatsAppMessageTemplate = {
      to: phoneNumber,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template: {
        name: 'saludo_aspirante',
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
                parameter_name: 'user_name',
              },
            ],
          },
        ],
      },
    };
    console.log('templateMessage', JSON.stringify(templateMessage, null, 2));
    return this.msgTemplate(templateMessage);

  }

  async sendTemplateVideoMessage(phoneNumber: string, videoUrl: string): Promise<unknown> {
    const templateMessage: WhatsAppMessageTemplate = {
      to: phoneNumber,
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template: {
        //name: 'video_mock',
        name: 'video_msj',
        language: {
          //code: 'en',
          code: 'es_CO',
        },
        components: [
          {
            type: 'header',
            parameters: [
              {
                type: 'video',
                video: {
                  id: '1911053819616278'
                  // link: `https://back.laceiba.group/bucket/video_reclutamiento_lite.mp4`,
                  // link: 'https://www.facebook.com/share/r/1C74cuW5mx/',
                },
              },
            ],
          },
        ],
      },
    };
    return this.msgTemplate(templateMessage);
  }

  async sendTemplateCallNotificationMessage(input: {
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

}

