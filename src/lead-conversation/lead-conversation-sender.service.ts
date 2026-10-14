import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LeadConversationSendCommand } from './types/lead-conversation-send-command.interface';
import type { LeadConversationSendResult } from './types/lead-conversation-send-result.interface';
import { buildLeadConversationGraphPayload } from './utils/build-lead-conversation-graph-payload.util';

type GraphMessagesResponse = {
  readonly messages?: readonly { readonly id?: string }[];
  readonly error?: { readonly message?: string };
};

/**
 * Sends lead qualification messages (text, media, reply buttons, lists) on the
 * dedicated leads WhatsApp line (`WHATSAPP_CLOUD_LEADS_*`).
 */
@Injectable()
export class LeadConversationSenderService {
  private readonly logger = new Logger(LeadConversationSenderService.name);

  constructor(private readonly configService: ConfigService) {}

  /** Builds and posts the Graph payload; never throws (RPC-safe). */
  async executeSend(command: LeadConversationSendCommand): Promise<LeadConversationSendResult> {
    try {
      const payload = buildLeadConversationGraphPayload(command);
      const response = await this.postGraphMessages(payload);
      const wamid = response.messages?.[0]?.id;
      this.logger.log(`lead_conversation ${command.kind} sent to=${command.to} wamid=${wamid ?? '-'}`);
      return { success: true, wamid };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(`lead_conversation send failed to=${command.to}: ${message}`);
      return { success: false, error: message };
    }
  }

  private async postGraphMessages(payload: Record<string, unknown>): Promise<GraphMessagesResponse> {
    const phoneNumberId = this.getRequiredEnv('WHATSAPP_CLOUD_LEADS_PHONE_NUMBER_ID');
    const accessToken = this.getRequiredEnv('WHATSAPP_CLOUD_LEADS_ACCESS_TOKEN');
    const version = this.configService.get<string>('WHATSAPP_CLOUD_API_VERSION', 'v25.0');
    const httpResponse = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const responseBody = (await httpResponse.json().catch(() => ({}))) as GraphMessagesResponse;
    if (!httpResponse.ok) {
      throw new Error(responseBody.error?.message ?? `Graph HTTP ${httpResponse.status}`);
    }
    return responseBody;
  }

  private getRequiredEnv(key: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new Error(`${key} is not configured`);
    }
    return value;
  }
}
