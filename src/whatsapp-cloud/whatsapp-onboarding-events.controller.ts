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
    if (actionValue === 'send.call_notification') {
      return this.handleSendCallNotification(payload);
    }

    if (actionValue === 'sent.training_message') {
      console.log('sent.training_message', payload);
      await this.handleSentTrainingMessage(payload);
      return { success: true };
    }
    return { success: false, message: 'unsupported action' };
  }

  private async handleSendInitialMsg(payload: Record<string, unknown>): Promise<void> {
    const flowId = payload.flowId != null ? String(payload.flowId) : '';
    const userId = payload.userId != null ? String(payload.userId) : '';
    const name = payload.name != null ? String(payload.name) : '';
    const phoneNumber = payload.phoneNumber != null ? String(payload.phoneNumber) : '';
    const videoUrl = payload.videoUrl != null ? String(payload.videoUrl) : '';

    if (!flowId || !userId || !name || !phoneNumber) return;

    const greetingResponse = await this.whatsappCloudService.sendTemplateGreetingMessage(phoneNumber, name);
    const greetingMessageId = extractFirstMessageId(greetingResponse);

    const videoResponse = await this.whatsappCloudService.sendTemplateVideoMessage(phoneNumber, videoUrl);
    const videoMessageId = extractFirstMessageId(videoResponse);

    await lastValueFrom(
      this.crmBackQueueClient.emit('ws_ms_event', {
        type: 'ws_ms_events',
        payload: {
          action: 'whatsapp.message_sent',
          flowId,
          userId,
          greetingMessageId,
          videoMessageId,
        },
      } as CrmBackEventPayload),
    );
  }

  private async handleSendCallNotification(payload: Record<string, unknown>): Promise<unknown> {
    const phoneNumber = payload.phoneNumber != null ? String(payload.phoneNumber) : '';
    if (!phoneNumber) return { success: false, message: 'phoneNumber is required' };
    return this.whatsappCloudService.sendTemplateCallNotificationMessage(phoneNumber);
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

