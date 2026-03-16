import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
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
      const response = await firstValueFrom(
        this.httpService.post(url, messageTemplate, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.getAccessToken()}`,
          },
        }),
      );
      this.logger.log(
        `📤 WhatsApp Cloud template sent to ${messageTemplate.to}: ${JSON.stringify(response.data)}`,
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

}

