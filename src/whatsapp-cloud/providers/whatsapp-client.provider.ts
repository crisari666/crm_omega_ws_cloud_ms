import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';
import { WHATSAPP_CLIENT } from '../constants/whatsapp-client.token';

/**
 * Registers a singleton {@link WhatsAppClient} using Meta token and API version from env.
 */
export const whatsappClientProvider: Provider = {
  provide: WHATSAPP_CLIENT,
  useFactory: (configService: ConfigService): WhatsAppClient => {
    const accessToken = configService.get<string>('WHATSAPP_CLOUD_ACCESS_TOKEN');
    if (!accessToken) {
      throw new Error('WHATSAPP_CLOUD_ACCESS_TOKEN is not configured');
    }
    const graphVersion = configService.get<string>('WHATSAPP_CLOUD_API_VERSION', 'v23.0');
    const baseUrl = configService.get<string>('WHATSAPP_KAPSO_BASE_URL');
    const kapsoApiKey = configService.get<string>('WHATSAPP_KAPSO_API_KEY');
    return new WhatsAppClient({
      accessToken,
      graphVersion,
      ...(baseUrl != null && baseUrl.length > 0 ? { baseUrl } : {}),
      ...(kapsoApiKey != null && kapsoApiKey.length > 0 ? { kapsoApiKey } : {}),
    });
  },
  inject: [ConfigService],
};
