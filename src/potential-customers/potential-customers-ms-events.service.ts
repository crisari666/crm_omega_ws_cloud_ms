import { Injectable, Logger } from '@nestjs/common';
import { WhatsappCloudService } from '../whatsapp-cloud/whatsapp-cloud.service';

type PotentialCustomersPayload = {
  readonly action?: unknown;
  readonly waId?: unknown;
  readonly phoneNumberId?: unknown;
  readonly contactName?: unknown;
  readonly customerId?: unknown;
  readonly body?: unknown;
};

/**
 * Handles `potential_customers.ms_ws` commands from crm-omega-customers-ms.
 */
@Injectable()
export class PotentialCustomersMsEventsService {
  private readonly logger: Logger = new Logger(PotentialCustomersMsEventsService.name);

  constructor(private readonly whatsappCloudService: WhatsappCloudService) {}

  async executeHandleEnvelope(raw: unknown): Promise<{ success: boolean; message?: string }> {
    const envelope = raw as { type?: unknown; payload?: PotentialCustomersPayload };
    if (envelope?.type !== 'potential_customers') {
      return { success: false, message: 'invalid envelope type' };
    }
    const payload: PotentialCustomersPayload = envelope.payload ?? {};
    const action: string = typeof payload.action === 'string' ? payload.action : '';
    if (action === 'send.potential_customer_template') {
      const waId: string = typeof payload.waId === 'string' ? payload.waId : '';
      const contactName: string = typeof payload.contactName === 'string' ? payload.contactName : '';
      const customerId: string = typeof payload.customerId === 'string' ? payload.customerId : '';
      if (waId.trim() === '') {
        return { success: false, message: 'missing waId' };
      }
      if (customerId.trim() === '') {
        return { success: false, message: 'missing customerId' };
      }
      await this.whatsappCloudService.sendTemplatePotentialCustomer({
        to: waId.trim(),
        contactName: contactName.trim(),
        customerId: customerId.trim(),
      });
      return { success: true };
    }
    if (action === 'send.potential_customer_text') {
      const waId: string = typeof payload.waId === 'string' ? payload.waId : '';
      const body: string = typeof payload.body === 'string' ? payload.body : '';
      if (waId.trim() === '' || body.trim() === '') {
        return { success: false, message: 'missing waId or body' };
      }
      await this.whatsappCloudService.sendTextMessage(waId.trim(), body);
      return { success: true };
    }
    this.logger.warn(`potential_customers.ms_ws unsupported action=${action}`);
    return { success: false, message: 'unsupported action' };
  }
}
