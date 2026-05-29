import { Injectable, Logger } from '@nestjs/common';
import { WhatsappCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';
import type { Component } from '../whatsapp-cloud/interfaces/message-template-type';

type MarketingCampaignEnvelope = {
  readonly type?: unknown;
  readonly payload?: {
    readonly action?: unknown;
    readonly campaignRecipientId?: unknown;
    readonly to?: unknown;
    readonly templateName?: unknown;
    readonly languageCode?: unknown;
    readonly components?: unknown;
  };
};

function extractFirstMessageId(response: unknown): string | null {
  if (response == null || typeof response !== 'object') {
    return null;
  }
  const data = response as Record<string, unknown>;
  const messagesValue = data.messages;
  if (!Array.isArray(messagesValue)) {
    return null;
  }
  const first = messagesValue[0] as Record<string, unknown> | undefined;
  const idValue = first?.id;
  return typeof idValue === 'string' && idValue.length > 0 ? idValue : null;
}

@Injectable()
export class MarketingCampaignMsEventsService {
  private readonly logger = new Logger(MarketingCampaignMsEventsService.name);

  constructor(private readonly whatsappCloudService: WhatsappCloudService) {}

  async executeHandleEnvelope(raw: unknown): Promise<{
    success: boolean;
    message?: string;
    messageId?: string;
  }> {
    const envelope = raw as MarketingCampaignEnvelope;
    if (envelope?.type !== 'marketing_campaign') {
      return { success: false, message: 'invalid envelope type' };
    }
    const payload = envelope.payload ?? {};
    const action = typeof payload.action === 'string' ? payload.action : '';
    if (action !== 'send.marketing_template') {
      return { success: false, message: 'unsupported action' };
    }
    const to = typeof payload.to === 'string' ? payload.to.trim() : '';
    const templateName =
      typeof payload.templateName === 'string' ? payload.templateName.trim() : '';
    const languageCode =
      typeof payload.languageCode === 'string' ? payload.languageCode.trim() : 'es';
    if (to.length === 0 || templateName.length === 0) {
      return { success: false, message: 'missing to or templateName' };
    }
    const componentsRaw = payload.components;
    const components = Array.isArray(componentsRaw)
      ? (componentsRaw as Component[])
      : undefined;
    try {
      const response = await this.whatsappCloudService.sendMarketingTemplateMessage({
        to,
        templateName,
        languageCode,
        components,
      });
      const messageId = extractFirstMessageId(response);
      return {
        success: true,
        ...(messageId != null ? { messageId } : {}),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`send.marketing_template failed: ${message}`);
      return { success: false, message };
    }
  }
}
