import { Controller, Inject } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { WhatsappCloudService } from './whatsapp-cloud.service';

type CrmBackEventSourceType = 'ws_ms_events' | 'voice_agent_ms_events';

interface CrmBackEventPayload {
  readonly type: CrmBackEventSourceType;
  readonly payload: Record<string, unknown>;
}

function extractFirstMessageId(response: unknown): string | null {
  if (response == null) return null;
  const data = response as Record<string, unknown>;
  const messagesValue = data.messages;
  if (!Array.isArray(messagesValue)) return null;
  const first = messagesValue[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  const idValue = first.id;
  return typeof idValue === 'string' && idValue.length > 0 ? idValue : null;
}

@Controller()
export class WhatsappOnboardingEventsController {
  public constructor(
    private readonly whatsappCloudService: WhatsappCloudService,
    @Inject('CRM_BACK_QUEUE') private readonly crmBackQueueClient: ClientProxy,
  ) {}

  @EventPattern('ms_ws_cloud')
  @MessagePattern('ms_ws_cloud')
  public async handleMs1Event(
    @Payload() event: CrmBackEventPayload,
  ): Promise<unknown> {
    const payload = event.payload as Record<string, unknown>;
    const actionValue = payload.action;
    if (typeof actionValue !== 'string') return { success: false, message: 'invalid action' };

    if (actionValue === 'send.initial_msg') {
      await this.handleSendInitialMsg(payload);
      return { success: true };
    }
    if (actionValue === 'send.video_after_greeting') {
      await this.handleSendVideoAfterGreeting(payload);
      return { success: true };
    }
    if (actionValue === 'send.call_notification') {
      const sent = await this.handleSendCallNotification(payload);
      return sent
        ? { success: true }
        : { success: false, message: 'send.call_notification failed or missing fields' };
    }

    if (actionValue === 'sent.training_message') {
      console.log('sent.training_message', payload);
      await this.handleSentTrainingMessage(payload);
      return { success: true };
    }
    if (actionValue === 'send.import_sequence_step') {
      return this.handleSendImportSequenceStep(payload);
    }
    return { success: false, message: 'unsupported action' };
  }

  /**
   * Import nurture: 0 greeting, 1 video, 2 call notification, 3–4 reminder (same greeting template).
   */
  private async handleSendImportSequenceStep(
    payload: Record<string, unknown>,
  ): Promise<{ success: boolean; message?: string }> {
    const stepRaw = payload.importSequenceStep;
    const step =
      typeof stepRaw === 'number'
        ? stepRaw
        : stepRaw != null
          ? Number(stepRaw)
          : Number.NaN;
    if (Number.isNaN(step) || step < 0 || step > 4) {
      return { success: false, message: 'invalid importSequenceStep' };
    }
    if (step === 0) {
      await this.handleSendInitialMsg(payload);
      return { success: true };
    }
    if (step === 1) {
      const videoId =
        payload.videoId != null
          ? String(payload.videoId).trim()
          : payload.videoMediaId != null
            ? String(payload.videoMediaId).trim()
            : '';
      if (videoId.length === 0) {
        return { success: false, message: 'missing videoId for import sequence step 1' };
      }
      await this.handleSendVideoAfterGreeting(payload);
      return { success: true };
    }
    if (step === 2) {
      const sent = await this.handleSendCallNotification(payload);
      return sent
        ? { success: true }
        : { success: false, message: 'send.call_notification failed or missing fields' };
    }
    const reminderSent = await this.handleSendImportSequenceReminder(payload, step);
    return reminderSent
      ? { success: true }
      : { success: false, message: 'import sequence reminder failed or missing message id' };
  }

  private async handleSendInitialMsg(payload: Record<string, unknown>): Promise<void> {
    const flowId = payload.flowId != null ? String(payload.flowId) : '';
    const userId = payload.userId != null ? String(payload.userId) : '';
    const name = payload.name != null ? String(payload.name) : '';
    const phoneNumber = payload.phoneNumber != null ? String(payload.phoneNumber) : '';
    if (!flowId || !userId || !name || !phoneNumber) return;

    const greetingResponse = await this.whatsappCloudService.sendTemplateGreetingMessage(phoneNumber, name);
    const greetingMessageId = extractFirstMessageId(greetingResponse);

    await lastValueFrom(
      this.crmBackQueueClient.emit('ws_ms_event', {
        type: 'ws_ms_events',
        payload: {
          action: 'whatsapp.message_sent',
          flowId,
          userId,
          greetingMessageId,
        },
      } as CrmBackEventPayload),
    );
  }

  private async handleSendVideoAfterGreeting(payload: Record<string, unknown>): Promise<void> {
    const flowId = payload.flowId != null ? String(payload.flowId) : '';
    const userId = payload.userId != null ? String(payload.userId) : '';
    const phoneNumber = payload.phoneNumber != null ? String(payload.phoneNumber) : '';
    const videoId =
      payload.videoId != null
        ? String(payload.videoId).trim()
        : payload.videoMediaId != null
          ? String(payload.videoMediaId).trim()
          : '';

    if (!flowId || !userId || !phoneNumber) return;
    if (!videoId) {
      console.error(
        'handleSendVideoAfterGreeting: missing videoId from omega_office_back payload; skip video template',
      );
      return;
    }

    const videoResponse = await this.whatsappCloudService.sendTemplateVideoMessage(
      phoneNumber,
      videoId,
    );
    const videoMessageId = extractFirstMessageId(videoResponse);

    await lastValueFrom(
      this.crmBackQueueClient.emit('ws_ms_event', {
        type: 'ws_ms_events',
        payload: {
          action: 'whatsapp.message_sent',
          flowId,
          userId,
          videoMessageId,
        },
      } as CrmBackEventPayload),
    );
  }

  private async handleSendCallNotification(payload: Record<string, unknown>): Promise<boolean> {
    const flowId = payload.flowId != null ? String(payload.flowId) : '';
    const userId = payload.userId != null ? String(payload.userId) : '';
    const phoneNumber = payload.phoneNumber != null ? String(payload.phoneNumber) : '';
    const contactName = payload.name != null ? String(payload.name) : '';
    const videoMessageId =
      payload.videoMessageId != null ? String(payload.videoMessageId) : '';

    if (!flowId || !userId || !phoneNumber || !contactName) return false;

    const response = await this.whatsappCloudService.sendTemplateCallNotificationMessage({
      phoneNumber,
      contactName,
    });
    const callNotificationMessageId = extractFirstMessageId(response);

    await lastValueFrom(
      this.crmBackQueueClient.emit('ws_ms_event', {
        type: 'ws_ms_events',
        payload: {
          action: 'call.notification_dispatched',
          flowId,
          userId,
          ...(videoMessageId.length > 0 ? { videoMessageId } : {}),
          ...(callNotificationMessageId != null
            ? { callNotificationMessageId }
            : {}),
        },
      } as CrmBackEventPayload),
    );
    return true;
  }

  private async handleSendImportSequenceReminder(
    payload: Record<string, unknown>,
    importSequenceStep: number,
  ): Promise<boolean> {
    const flowId = payload.flowId != null ? String(payload.flowId) : '';
    const userId = payload.userId != null ? String(payload.userId) : '';
    const name = payload.name != null ? String(payload.name) : '';
    const phoneNumber = payload.phoneNumber != null ? String(payload.phoneNumber) : '';
    if (!flowId || !userId || !name || !phoneNumber) {
      return false;
    }
    const reminderResponse = await this.whatsappCloudService.sendTemplateGreetingMessage(
      phoneNumber,
      name,
    );
    const reminderMessageId = extractFirstMessageId(reminderResponse);
    if (reminderMessageId == null) {
      console.error(
        'handleSendImportSequenceReminder: Graph API did not return a message id',
      );
      return false;
    }
    await lastValueFrom(
      this.crmBackQueueClient.emit('ws_ms_event', {
        type: 'ws_ms_events',
        payload: {
          action: 'whatsapp.import_sequence_reminder_sent',
          flowId,
          userId,
          importSequenceStep,
          reminderMessageId,
        },
      } as CrmBackEventPayload),
    );
    return true;
  }

  private async handleSentTrainingMessage(payload: Record<string, unknown>): Promise<void> {
    const name = payload.name != null ? String(payload.name) : '';
    const phoneNumber = payload.phoneNumber != null ? String(payload.phoneNumber) : '';
    const trainingValue = payload.training as
    | undefined
    | {
      attendeeId?: unknown;
      date?: unknown;
    };

    const attendeeId = trainingValue?.attendeeId != null ? String(trainingValue.attendeeId) : '';
    const trainingDate = trainingValue?.date != null ? String(trainingValue.date) : '';
    await this.whatsappCloudService.sendTemplateInfoTrainingMessage({ code: attendeeId, name, date: trainingDate, to: phoneNumber });
  }
}

