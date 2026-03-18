import { Controller, Inject } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
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
  public async handleMs1Event(
    @Payload() event: CrmBackEventPayload,
  ): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const actionValue = payload.action;
    if (typeof actionValue !== 'string') return;

    if (actionValue === 'send.initial_msg') {
      await this.handleSendInitialMsg(payload);
      return;
    }

    if (actionValue === 'sent.training_message') {
      await this.handleSentTrainingMessage(payload);
      return;
    }
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

  private async handleSentTrainingMessage(payload: Record<string, unknown>): Promise<void> {
    const flowId = payload.flowId != null ? String(payload.flowId) : '';
    const name = payload.name != null ? String(payload.name) : '';
    const phoneNumber = payload.phoneNumber != null ? String(payload.phoneNumber) : '';

    const trainingValue = payload.training as
      | undefined
      | {
          id?: unknown;
          date?: unknown;
        };

    const trainingId = trainingValue?.id != null ? String(trainingValue.id) : '';
    const trainingDate = trainingValue?.date != null ? String(trainingValue.date) : '';

    if (!flowId || !name || !phoneNumber || !trainingId || !trainingDate) return;

    const code = `${trainingId}|${trainingDate}`;
    await this.whatsappCloudService.sendTemplateProposalMessage({ code, name, to: phoneNumber });
  }
}

