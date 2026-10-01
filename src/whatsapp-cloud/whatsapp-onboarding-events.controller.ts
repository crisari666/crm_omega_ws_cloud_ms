import { Controller, Inject, Logger } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { RecruitingWhatsappCaptureService } from './recruiting-whatsapp-capture.service';
import { WsChatMsgHandlerService } from './ws-chat-msg-handler.service';

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

function extractMessagesSubset(response: unknown): Record<string, unknown> | undefined {
  if (response == null || typeof response !== 'object') return undefined;
  const data = response as Record<string, unknown>;
  const messagesValue = data.messages;
  if (!Array.isArray(messagesValue)) return undefined;
  return { messages: messagesValue };
}

@Controller()
export class WhatsappOnboardingEventsController {
  private readonly logger = new Logger(WhatsappOnboardingEventsController.name);

  public constructor(
    private readonly whatsappCloudService: WhatsappCloudService,
    private readonly recruitingWhatsappCaptureService: RecruitingWhatsappCaptureService,
    private readonly wsChatMsgHandlerService: WsChatMsgHandlerService,
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
    if (actionValue === 'send.confirmar_capacitacion') {
      await this.handleSendConfirmarCapacitacion(payload);
      return { success: true };
    }
    if (actionValue === 'send.interactive_training_slots') {
      await this.handleSendInteractiveTrainingSlots(payload);
      return { success: true };
    }
    if (actionValue === 'send.whatsapp_text') {
      await this.handleSendWhatsappText(payload);
      return { success: true };
    }
    if (actionValue === 'send.training_reminder') {
      return this.handleSendTrainingReminder(payload);
    }
    if (actionValue === 'send.recruiting_capture_start') {
      await this.handleRecruitingCaptureStart(payload);
      return { success: true };
    }
    if (actionValue === 'send.recruiting_meet_link') {
      await this.handleRecruitingMeetLink(payload);
      return { success: true };
    }
    if (actionValue === 'send.recruiting_meet_template') {
      await this.handleRecruitingMeetTemplate(payload);
      return { success: true };
    }
    if (actionValue === 'recruiting.purge_candidate') {
      return this.handleRecruitingPurgeCandidate(payload);
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

  private async handleSendConfirmarCapacitacion(payload: Record<string, unknown>): Promise<void> {
    const flowId = payload.flowId != null ? String(payload.flowId) : '';
    const userId = payload.userId != null ? String(payload.userId) : '';
    const phoneNumber = payload.phoneNumber != null ? String(payload.phoneNumber) : '';
    const name = payload.name != null ? String(payload.name) : '';
    if (!flowId || !userId || !phoneNumber || !name) {
      return;
    }
    const response = await this.whatsappCloudService.sendTemplateConfirmarCapacitacionMessage({
      phoneNumber,
      contactName: name,
    });
    const confirmarCapacitacionMessageId = extractFirstMessageId(response);
    if (confirmarCapacitacionMessageId == null) {
      console.error(
        'handleSendConfirmarCapacitacion: Graph API did not return a message id; skip CRM dispatch event',
      );
      return;
    }
    await lastValueFrom(
      this.crmBackQueueClient.emit('ws_ms_event', {
        type: 'ws_ms_events',
        payload: {
          action: 'whatsapp.confirmar_capacitacion_dispatched',
          flowId,
          userId,
          confirmarCapacitacionMessageId,
        },
      } as CrmBackEventPayload),
    );
  }

  private async handleSendInteractiveTrainingSlots(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const flowId = payload.flowId != null ? String(payload.flowId) : '';
    const userId = payload.userId != null ? String(payload.userId) : '';
    const phoneNumber = payload.phoneNumber != null ? String(payload.phoneNumber) : '';
    const interactive = payload.interactive as Record<string, unknown> | undefined;
    if (!flowId || !userId || !phoneNumber || interactive == null) {
      return;
    }
    const response = await this.whatsappCloudService.sendInteractiveTrainingSlotsListMessage({
      to: phoneNumber,
      interactive,
    });
    const trainingSlotsListMessageId = extractFirstMessageId(response);
    if (trainingSlotsListMessageId == null) {
      return;
    }
    await lastValueFrom(
      this.crmBackQueueClient.emit('ws_ms_event', {
        type: 'ws_ms_events',
        payload: {
          action: 'whatsapp.training_slots_list_dispatched',
          flowId,
          userId,
          trainingSlotsListMessageId,
        },
      } as CrmBackEventPayload),
    );
  }

  private async handleSendWhatsappText(payload: Record<string, unknown>): Promise<void> {
    const phoneNumber = payload.phoneNumber != null ? String(payload.phoneNumber) : '';
    const body = payload.body != null ? String(payload.body) : '';
    if (!phoneNumber || !body) {
      return;
    }
    await this.whatsappCloudService.sendTextMessage(phoneNumber, body);
  }

  /**
   * Outbound training slot reminders (`capacitacion_*` templates). Returns payload for monolith DB.
   */
  private async handleSendTrainingReminder(
    payload: Record<string, unknown>,
  ): Promise<{
    success: boolean;
    message?: string;
    messageId?: string;
    raw?: Record<string, unknown>;
  }> {
    const phoneNumber =
      payload.phoneNumber != null
        ? String(payload.phoneNumber).trim()
        : payload.to != null
          ? String(payload.to).trim()
          : '';
    const contactName =
      payload.contactName != null
        ? String(payload.contactName).trim()
        : payload.name != null
          ? String(payload.name).trim()
          : '';
    const templateName =
      payload.templateName != null
        ? String(payload.templateName).trim()
        : payload.template_name != null
          ? String(payload.template_name).trim()
          : '';
    const dateText =
      payload.dateText != null ? String(payload.dateText).trim() : '';
    const timeText =
      payload.timeText != null ? String(payload.timeText).trim() : '';
    const meetLink =
      payload.meetLink != null
        ? String(payload.meetLink).trim()
        : payload.googleMeetUrl != null
          ? String(payload.googleMeetUrl).trim()
          : '';

    if (!phoneNumber || !contactName || !templateName) {
      return { success: false, message: 'missing phoneNumber, contactName, or templateName' };
    }

    const templatesNeedLink = new Set([
      'capacitacion_12_hora',
      'capacitacion_3_hora',
      'capacitacion_45_minutos',
      'capacitacion_5_minutos',
    ]);
    if (!templatesNeedLink.has(templateName)) {
      return { success: false, message: 'unsupported templateName' };
    }
    if (meetLink.length === 0) {
      return { success: false, message: 'missing meetLink' };
    }

    try {
      let response: unknown;
      if (templateName === 'capacitacion_12_hora') {
        if (!dateText || !timeText) {
          return { success: false, message: 'missing dateText or timeText for 12h template' };
        }
        response = await this.whatsappCloudService.sendTemplateCapacitacion12Hora({
          phoneNumber,
          contactName,
          dateText,
          timeText,
          meetLink,
        });
      } else if (templateName === 'capacitacion_3_hora') {
        if (!timeText) {
          return { success: false, message: 'missing timeText for 3h template' };
        }
        response = await this.whatsappCloudService.sendTemplateCapacitacion3Hora({
          phoneNumber,
          contactName,
          timeText,
          meetLink,
        });
      } else if (templateName === 'capacitacion_45_minutos') {
        response = await this.whatsappCloudService.sendTemplateCapacitacion45Minutos({
          phoneNumber,
          contactName,
          meetLink,
        });
      } else {
        response = await this.whatsappCloudService.sendTemplateCapacitacion5Minutos({
          phoneNumber,
          contactName,
          meetLink,
        });
      }
      const messageId = extractFirstMessageId(response);
      const raw = extractMessagesSubset(response);
      return {
        success: true,
        ...(messageId != null ? { messageId } : {}),
        ...(raw != null ? { raw } : {}),
      };
    } catch (err) {
      console.error('handleSendTrainingReminder error', JSON.stringify(err, null, 2));
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message };
    }
  }

  private async handleSentTrainingMessage(payload: Record<string, unknown>): Promise<void> {
    const flowId = payload.flowId != null ? String(payload.flowId) : '';
    const userId = payload.userId != null ? String(payload.userId) : '';
    const name = payload.name != null ? String(payload.name) : '';
    const phoneNumber = payload.phoneNumber != null ? String(payload.phoneNumber) : '';
    const isTrainingSlotReselection = payload.isTrainingSlotReselection === true;
    const attendeeIdFromPayload =
      payload.attendeeId != null ? String(payload.attendeeId).trim() : '';
    const trainingValue = payload.training as
    | undefined
    | {
      attendeeId?: unknown;
      date?: unknown;
      time?: unknown;
      trainingDateTimeIso?: unknown;
      googleMeetUrl?: unknown;
    };
    const attendeeIdFromTraining =
      trainingValue?.attendeeId != null ? String(trainingValue.attendeeId).trim() : '';
    const attendeeId =
      attendeeIdFromPayload.length > 0 ? attendeeIdFromPayload : attendeeIdFromTraining;
    const trainingDate =
      trainingValue?.date != null ? String(trainingValue.date).trim() : '';
    const trainingTime =
      trainingValue?.time != null ? String(trainingValue.time).trim() : '';
    const trainingDateTimeIso =
      trainingValue?.trainingDateTimeIso != null
        ? String(trainingValue.trainingDateTimeIso).trim()
        : '';
    const googleMeetUrl =
      trainingValue?.googleMeetUrl != null ? String(trainingValue.googleMeetUrl).trim() : '';
    if (!flowId || !userId || !name || !phoneNumber) {
      return;
    }
    if (isTrainingSlotReselection) {
      if (attendeeId.length === 0 || trainingDateTimeIso.length === 0) {
        return;
      }
      const response = await this.whatsappCloudService.sendTemplateInfoTrainingMessage({
        code: attendeeId,
        name,
        date: trainingDateTimeIso,
        to: phoneNumber,
      });
      const trainingInfoMessageId = extractFirstMessageId(response);
      if (trainingInfoMessageId == null) {
        return;
      }
      await lastValueFrom(
        this.crmBackQueueClient.emit('ws_ms_event', {
          type: 'ws_ms_events',
          payload: {
            action: 'whatsapp.training_info_dispatched',
            flowId,
            userId,
            trainingInfoMessageId,
          },
        } as CrmBackEventPayload),
      );
      return;
    }
    if (trainingDate.length === 0 || trainingTime.length === 0) {
      return;
    }
    const response = await this.whatsappCloudService.sendTemplateNotificacionCapacitacionMessage({
      phoneNumber,
      contactName: name,
      fecha: trainingDate,
      hora: trainingTime,
      googleMeetUrl,
    });
    const confirmarCapacitacionMessageId = extractFirstMessageId(response);
    if (confirmarCapacitacionMessageId == null) {
      return;
    }
    await lastValueFrom(
      this.crmBackQueueClient.emit('ws_ms_event', {
        type: 'ws_ms_events',
        payload: {
          action: 'whatsapp.confirmar_capacitacion_dispatched',
          flowId,
          userId,
          confirmarCapacitacionMessageId,
        },
      } as CrmBackEventPayload),
    );
  }

  private async handleRecruitingCaptureStart(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const campaignId =
      payload.campaignId != null ? String(payload.campaignId).trim() : '';
    const candidateId =
      payload.candidateId != null ? String(payload.candidateId).trim() : '';
    const to =
      payload.to != null
        ? String(payload.to).trim()
        : payload.phoneNumber != null
          ? String(payload.phoneNumber).trim()
          : '';
    const whatsappAgentPrompt =
      payload.whatsappAgentPrompt != null
        ? String(payload.whatsappAgentPrompt)
        : '';
    const contactName =
      payload.contactName != null ? String(payload.contactName).trim() : '';
    const rawFields = payload.captureFields;
    const captureFields: Array<{
      key: string;
      label: string;
      required: boolean;
      order: number;
    }> = [];
    if (Array.isArray(rawFields)) {
      for (const row of rawFields) {
        if (row == null || typeof row !== 'object') continue;
        const record = row as Record<string, unknown>;
        const key = typeof record.key === 'string' ? record.key.trim() : '';
        const label =
          typeof record.label === 'string' ? record.label.trim() : key;
        if (key.length === 0) continue;
        captureFields.push({
          key,
          label,
          required: record.required !== false,
          order: typeof record.order === 'number' ? record.order : 0,
        });
      }
    }
    if (
      campaignId.length === 0 ||
      candidateId.length === 0 ||
      to.length === 0 ||
      whatsappAgentPrompt.trim().length === 0
    ) {
      return;
    }
    const templateNameRaw =
      payload.whatsappTemplateName != null
        ? String(payload.whatsappTemplateName).trim()
        : '';
    const templateLanguageRaw =
      payload.whatsappTemplateLanguage != null
        ? String(payload.whatsappTemplateLanguage).trim()
        : '';
    const templateName =
      templateNameRaw.length > 0
        ? templateNameRaw
        : 'candidate_opening_message';
    const templateLanguage =
      templateLanguageRaw.length > 0 ? templateLanguageRaw : 'spa';
    if (contactName.length === 0) {
      this.logger.error(
        `Recruiting opening template skipped: missing contactName for ${to}`,
      );
      return;
    }
    try {
      await this.whatsappCloudService.sendRecruitingOpeningTemplate({
        phoneNumber: to,
        templateName,
        languageCode: templateLanguage,
        contactName,
      });
    } catch (error) {
      this.logger.error(
        `Recruiting opening template failed (${templateName}/${templateLanguage}) to ${to}`,
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }
    await this.recruitingWhatsappCaptureService.startCapture({
      campaignId,
      candidateId,
      to,
      whatsappAgentPrompt,
      captureFields,
      prefilledData: this.readStringRecord(payload.prefilledData),
      contactName: contactName.length > 0 ? contactName : undefined,
      skipTextOpener: true,
      openingTemplateLabel: `${templateName} (${templateLanguage})`,
      cvRequestMessage: this.readOptionalString(payload.cvRequestMessage),
      videoRequestMessage: this.readOptionalString(payload.videoRequestMessage),
      videoReceivedMessage: this.readOptionalString(payload.videoReceivedMessage),
    });
  }

  /**
   * Removed candidate: end the capture session and delete its WhatsApp messages and media files.
   */
  private async handleRecruitingPurgeCandidate(
    payload: Record<string, unknown>,
  ): Promise<{ success: boolean; message?: string }> {
    const candidateId = this.readOptionalString(payload.candidateId) ?? '';
    const phone = this.readOptionalString(payload.phone) ?? '';
    if (candidateId.length === 0 || phone.length === 0) {
      return { success: false, message: 'missing candidateId or phone' };
    }
    const sinceDate = new Date(this.readOptionalString(payload.sinceIso) ?? Number.NaN);
    const mediaMessageIds = Array.isArray(payload.mediaMessageIds)
      ? payload.mediaMessageIds
          .map((value) => this.readOptionalString(value))
          .filter((value): value is string => value != null)
      : [];
    await this.recruitingWhatsappCaptureService.endSessionForCandidate(candidateId);
    const result = await this.wsChatMsgHandlerService.purgeRecruitingMessages({
      phone,
      since: Number.isNaN(sinceDate.getTime()) ? new Date() : sinceDate,
      mediaMessageIds,
    });
    this.logger.log(
      `Purged recruiting candidate ${candidateId}: ${result.deletedMessages} messages, ${result.deletedFiles} media folders`,
    );
    return { success: true };
  }

  private readOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }

  private readStringRecord(value: unknown): Record<string, string> {
    if (value == null || typeof value !== 'object') return {};
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [key, raw]) => {
        const text = this.readOptionalString(raw);
        return text != null ? { ...acc, [key]: text } : acc;
      },
      {},
    );
  }

  private async handleRecruitingMeetTemplate(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const to = this.readOptionalString(payload.to);
    const templateName = this.readOptionalString(payload.templateName);
    const meetCode = this.readOptionalString(payload.meetCode);
    if (to == null || templateName == null || meetCode == null) {
      this.logger.warn('send.recruiting_meet_template: missing to, templateName or meetCode');
      return;
    }
    await this.whatsappCloudService.sendRecruitingMeetTemplate({
      phoneNumber: to.replace(/\D/g, ''),
      templateName,
      languageCode: this.readOptionalString(payload.templateLanguage) ?? 'es_CO',
      contactName: this.readOptionalString(payload.contactName) ?? '',
      dateText: this.readOptionalString(payload.date_) ?? '',
      timeText: this.readOptionalString(payload.time) ?? '',
      meetCode,
    });
  }

  private async handleRecruitingMeetLink(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const candidateId =
      payload.candidateId != null ? String(payload.candidateId).trim() : '';
    const to =
      payload.to != null
        ? String(payload.to).trim()
        : payload.phoneNumber != null
          ? String(payload.phoneNumber).trim()
          : '';
    const text = payload.text != null ? String(payload.text) : '';
    if (candidateId.length === 0 || to.length === 0 || text.trim().length === 0) {
      return;
    }
    await this.recruitingWhatsappCaptureService.sendMeetLink({
      candidateId,
      to,
      text,
    });
  }
}

