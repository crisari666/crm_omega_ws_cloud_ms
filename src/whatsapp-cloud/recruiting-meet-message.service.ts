import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { lastValueFrom } from 'rxjs';
import type { RecruitingMeetStatus } from './interfaces/recruiting-meet-status.interface';
import {
  RecruitingMeetMessage,
  RecruitingMeetMessageDocument,
} from './schemas/recruiting-meet-message.schema';
import { WHATSAPP_ECOSYSTEM_HEALTH_DELIVERY_ERROR_CODE } from './utils/whatsapp-ecosystem-delivery.constants';

const WHATSAPP_MARKETING_OPT_OUT_ERROR_CODE = 131050;
const SPAM_ERROR_CODES: ReadonlySet<number> = new Set([
  WHATSAPP_ECOSYSTEM_HEALTH_DELIVERY_ERROR_CODE,
  WHATSAPP_MARKETING_OPT_OUT_ERROR_CODE,
]);
const TRACKED_WEBHOOK_STATUSES: ReadonlySet<string> = new Set([
  'sent',
  'delivered',
  'read',
  'failed',
]);

type WebhookStatusError = {
  readonly code: number | null;
  readonly message: string;
};

/**
 * Tracks recruiting group Meet templates (wamid → candidate) and reports send results and
 * delivery status webhooks to the CRM.
 */
@Injectable()
export class RecruitingMeetMessageService {
  private readonly logger = new Logger(RecruitingMeetMessageService.name);

  public constructor(
    @InjectModel(RecruitingMeetMessage.name)
    private readonly meetMessageModel: Model<RecruitingMeetMessageDocument>,
    @Inject('CRM_BACK_QUEUE') private readonly crmBackQueueClient: ClientProxy,
  ) {}

  public async reportTemplateSent(input: {
    readonly candidateId: string;
    readonly whatsappMessageId: string;
  }): Promise<void> {
    await this.meetMessageModel
      .updateOne(
        { whatsappMessageId: input.whatsappMessageId },
        { $set: { candidateId: input.candidateId } },
        { upsert: true },
      )
      .exec();
    await this.emitToCrm({ action: 'recruiting.meet_template_sent', ...input });
  }

  public async reportTemplateFailed(input: {
    readonly candidateId: string;
    readonly errorMessage: string;
  }): Promise<void> {
    await this.emitToCrm({ action: 'recruiting.meet_template_failed', ...input });
  }

  /**
   * Reports a Meta status webhook when its wamid belongs to a recruiting Meet template.
   */
  public async reportWebhookStatusIfTracked(status: Record<string, unknown>): Promise<void> {
    const whatsappMessageId = typeof status.id === 'string' ? status.id : '';
    const rawStatus = typeof status.status === 'string' ? status.status.trim().toLowerCase() : '';
    if (whatsappMessageId.length === 0 || !TRACKED_WEBHOOK_STATUSES.has(rawStatus)) return;
    const tracked = await this.meetMessageModel.findOne({ whatsappMessageId }).lean().exec();
    if (tracked == null) return;
    const error = this.readFirstError(status);
    await this.emitToCrm({
      action: 'recruiting.meet_template_status',
      candidateId: tracked.candidateId,
      whatsappMessageId,
      status: this.mapStatus({ rawStatus, errorCode: error.code }),
      errorCode: error.code != null ? String(error.code) : '',
      errorMessage: error.message,
    });
  }

  private mapStatus(input: {
    readonly rawStatus: string;
    readonly errorCode: number | null;
  }): RecruitingMeetStatus {
    if (input.rawStatus !== 'failed') return input.rawStatus as RecruitingMeetStatus;
    return input.errorCode != null && SPAM_ERROR_CODES.has(input.errorCode) ? 'spam' : 'failed';
  }

  private readFirstError(status: Record<string, unknown>): WebhookStatusError {
    const errors = status.errors;
    const first = Array.isArray(errors) ? (errors[0] as Record<string, unknown> | undefined) : undefined;
    if (first == null) return { code: null, message: '' };
    const code = Number(first.code);
    const errorData = first.error_data as Record<string, unknown> | undefined;
    const details = typeof errorData?.details === 'string' ? errorData.details : '';
    const title = typeof first.title === 'string' ? first.title : '';
    return { code: Number.isNaN(code) ? null : code, message: details || title };
  }

  private async emitToCrm(payload: Record<string, unknown>): Promise<void> {
    try {
      await lastValueFrom(
        this.crmBackQueueClient.emit('ws_ms_event', { type: 'ws_ms_events', payload }),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`emit ${String(payload.action)} failed: ${message}`);
    }
  }
}
