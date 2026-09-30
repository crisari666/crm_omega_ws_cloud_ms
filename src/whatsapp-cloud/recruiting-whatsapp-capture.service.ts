import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { lastValueFrom } from 'rxjs';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { WsChatMsgHandlerService } from './ws-chat-msg-handler.service';
import { CvTextExtractorService } from './cv-text-extractor.service';
import type { InboundStoredMedia } from './interfaces/inbound-stored-media.interface';

type CaptureField = {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly order: number;
};

type RecruitingStage = 'collecting_data' | 'awaiting_cv' | 'awaiting_video' | 'done';

type RecruitingStageMessages = {
  readonly cvRequestMessage: string;
  readonly videoRequestMessage: string;
  readonly videoReceivedMessage: string;
};

type RecruitingSession = {
  readonly campaignId: string;
  readonly candidateId: string;
  readonly to: string;
  readonly whatsappAgentPrompt: string;
  readonly captureFields: readonly CaptureField[];
  readonly stageMessages: RecruitingStageMessages;
  capturedData: Record<string, string>;
  messages: ChatCompletionMessageParam[];
  dataComplete: boolean;
  interviewAccepted: boolean;
  stage: RecruitingStage;
};

type CrmBackEventPayload = {
  readonly type: 'ws_ms_events' | 'voice_agent_ms_events';
  readonly payload: Record<string, unknown>;
};

const RECRUITING_TOOL_ROUNDS_MAX = 6;
const DEFAULT_CV_REQUEST_MESSAGE =
  '¡Perfecto, gracias! 📄 El siguiente paso es que me envíes tu hoja de vida (CV) en PDF o Word por este chat.';
const DEFAULT_VIDEO_REQUEST_MESSAGE =
  '¡Recibimos tu hoja de vida! 🎥 Ahora envíanos un video de máximo 1 minuto presentándote: quién eres, tu experiencia y por qué quieres unirte al equipo.';
const DEFAULT_VIDEO_RECEIVED_MESSAGE =
  '¡Gracias por tu video! En un momento te enviamos el enlace de la reunión virtual.';
const CV_REMINDER_MESSAGE =
  'Para continuar necesitamos tu hoja de vida (CV). Envíala por este chat como archivo PDF o Word.';
const CV_INVALID_FORMAT_MESSAGE =
  'Ese archivo no es un PDF ni un Word. Por favor envía tu hoja de vida (CV) en formato PDF o Word (.docx).';
const VIDEO_REMINDER_MESSAGE =
  'Para terminar tu proceso solo falta tu video de presentación (máximo 1 minuto). Envíalo por este chat.';
const VIDEO_INVALID_FORMAT_MESSAGE =
  'No pudimos recibir ese archivo como video. Por favor envía tu video de presentación (máximo 1 minuto) directamente por este chat.';
const MEDIA_NOT_AVAILABLE_MESSAGE =
  'No pudimos descargar tu archivo. ¿Puedes enviarlo de nuevo, por favor?';
const VIDEO_MIME_PREFIX = 'video/';

/**
 * WhatsApp recruiting capture agent driven by campaign prompt + captureFields from RMQ.
 */
@Injectable()
export class RecruitingWhatsappCaptureService {
  private readonly logger = new Logger(RecruitingWhatsappCaptureService.name);
  private readonly sessionsByPhone = new Map<string, RecruitingSession>();
  private readonly sessionsByCandidateId = new Map<string, RecruitingSession>();
  private openaiClient: OpenAI | null = null;

  public constructor(
    private readonly configService: ConfigService,
    private readonly whatsappCloudService: WhatsappCloudService,
    private readonly wsChatMsgHandlerService: WsChatMsgHandlerService,
    private readonly cvTextExtractorService: CvTextExtractorService,
    @Inject('CRM_BACK_QUEUE') private readonly crmBackQueueClient: ClientProxy,
  ) {}

  public hasActiveSessionForPhone(phone: string): boolean {
    return this.sessionsByPhone.has(this.normalizePhone(phone));
  }

  public async startCapture(input: {
    readonly campaignId: string;
    readonly candidateId: string;
    readonly to: string;
    readonly whatsappAgentPrompt: string;
    readonly captureFields: readonly CaptureField[];
    readonly contactName?: string;
    /** When true, session is armed but no free-text opener is sent (template already opened the chat). */
    readonly skipTextOpener?: boolean;
    readonly openingTemplateLabel?: string;
    readonly cvRequestMessage?: string;
    readonly videoRequestMessage?: string;
    readonly videoReceivedMessage?: string;
  }): Promise<void> {
    const to = this.normalizePhone(input.to);
    const fields =
      input.captureFields.length > 0
        ? [...input.captureFields].sort((a, b) => a.order - b.order)
        : [];
    const fieldList = fields
      .map((f) => `- ${f.key}: ${f.label}${f.required ? ' (obligatorio)' : ''}`)
      .join('\n');
    const contactName =
      input.contactName != null && input.contactName.trim().length > 0
        ? input.contactName.trim()
        : '';
    const templateAlreadySent = input.skipTextOpener === true;
    const noRegreetBlock = templateAlreadySent
      ? `
# Apertura ya enviada (OBLIGATORIO)
Ya se envió la plantilla de WhatsApp que SALUDÓ al candidato${contactName.length > 0 ? ` (${contactName})` : ''}.
PROHIBIDO saludar de nuevo (no digas "Hola", "Buenos días", ni te presentes otra vez).
Cuando el candidato responda, continúa DIRECTO pidiendo el siguiente dato pendiente de la lista de campos (sin re-saludo).
`
      : '';
    const systemPrompt = `${input.whatsappAgentPrompt}
${noRegreetBlock}
# Campos a capturar (usa saveCapturedField)
${fieldList}

# Herramientas
- saveCapturedField(fieldKey, fieldValue): guarda un dato capturado.
- markDataComplete: cuando todos los obligatorios estén capturados. El sistema pedirá automáticamente el CV y luego un video; después enviará el link de Meet. No pidas tú el CV, el video ni prometas el Meet.
- markInterviewAccepted: cuando el candidato acepte claramente participar en la reunión virtual (solo registra la aceptación).
`;
    const session: RecruitingSession = {
      campaignId: input.campaignId,
      candidateId: input.candidateId,
      to,
      whatsappAgentPrompt: input.whatsappAgentPrompt,
      captureFields: fields,
      stageMessages: {
        cvRequestMessage: this.pickText(input.cvRequestMessage, DEFAULT_CV_REQUEST_MESSAGE),
        videoRequestMessage: this.pickText(
          input.videoRequestMessage,
          DEFAULT_VIDEO_REQUEST_MESSAGE,
        ),
        videoReceivedMessage: this.pickText(
          input.videoReceivedMessage,
          DEFAULT_VIDEO_RECEIVED_MESSAGE,
        ),
      },
      capturedData: {},
      messages: [{ role: 'system', content: systemPrompt }],
      dataComplete: false,
      interviewAccepted: false,
      stage: 'collecting_data',
    };
    this.sessionsByPhone.set(to, session);
    this.sessionsByCandidateId.set(input.candidateId, session);
    if (templateAlreadySent) {
      const label =
        input.openingTemplateLabel != null &&
        input.openingTemplateLabel.trim().length > 0
          ? input.openingTemplateLabel.trim()
          : 'opening_template';
      const greetingAlreadySent =
        contactName.length > 0
          ? `Hola ${contactName}, gracias por tu interés. (mensaje de plantilla WhatsApp ya enviado; no repetir saludo)`
          : 'Hola, gracias por tu interés. (mensaje de plantilla WhatsApp ya enviado; no repetir saludo)';
      session.messages.push({
        role: 'assistant',
        content: greetingAlreadySent,
      });
      await this.emitConversationTurn({
        candidateId: input.candidateId,
        role: 'assistant',
        text: `[WhatsApp template: ${label}]`,
      });
      return;
    }
    const opener =
      input.contactName != null && input.contactName.trim().length > 0
        ? `Hola ${input.contactName.trim()}, soy el asistente de inteligencia artificial de selección. ¿Me compartes tu nombre completo para continuar?`
        : 'Hola, soy el asistente de inteligencia artificial de selección. ¿Me compartes tu nombre completo para continuar?';
    session.messages.push({ role: 'assistant', content: opener });
    await this.whatsappCloudService.sendTextMessage(to, opener);
    await this.emitConversationTurn({
      candidateId: input.candidateId,
      role: 'assistant',
      text: opener,
    });
  }

  public async handleInboundText(input: {
    readonly waId: string;
    readonly text: string;
  }): Promise<boolean> {
    const session = this.sessionsByPhone.get(this.normalizePhone(input.waId));
    if (session == null || session.stage === 'done') {
      return false;
    }
    const text = input.text.trim();
    if (text.length === 0) {
      return true;
    }
    session.messages.push({ role: 'user', content: text });
    await this.emitConversationTurn({
      candidateId: session.candidateId,
      role: 'user',
      text,
    });
    if (session.stage === 'awaiting_cv') {
      await this.sendAssistantText(session, CV_REMINDER_MESSAGE);
      return true;
    }
    if (session.stage === 'awaiting_video') {
      await this.sendAssistantText(session, VIDEO_REMINDER_MESSAGE);
      return true;
    }
    const reply = await this.runAgentTurn(session);
    if (this.isAwaitingCv(session)) {
      await this.sendAssistantText(session, session.stageMessages.cvRequestMessage);
      return true;
    }
    if (reply != null && reply.trim().length > 0) {
      await this.sendAssistantText(session, reply);
    }
    return true;
  }

  /**
   * Handles a document/video sent by a candidate while the session waits for the CV or the video.
   * Returns false when no recruiting session is waiting for media (caller continues normal handling).
   */
  public async handleInboundMedia(input: {
    readonly waId: string;
    readonly whatsappMessageId: string;
    readonly messageType: string;
  }): Promise<boolean> {
    const session = this.sessionsByPhone.get(this.normalizePhone(input.waId));
    if (session == null) {
      return false;
    }
    if (session.stage !== 'awaiting_cv' && session.stage !== 'awaiting_video') {
      return false;
    }
    const media = await this.wsChatMsgHandlerService.findInboundMediaByWhatsappMessageId(
      input.whatsappMessageId,
    );
    if (media == null) {
      await this.sendAssistantText(session, MEDIA_NOT_AVAILABLE_MESSAGE);
      return true;
    }
    if (session.stage === 'awaiting_cv') {
      await this.processCvMedia(session, media);
      return true;
    }
    await this.processVideoMedia(session, media, input.messageType);
    return true;
  }

  public async sendMeetLink(input: {
    readonly candidateId: string;
    readonly to: string;
    readonly text: string;
  }): Promise<void> {
    const to = this.normalizePhone(input.to);
    await this.whatsappCloudService.sendTextMessage(to, input.text);
    await this.emitConversationTurn({
      candidateId: input.candidateId,
      role: 'assistant',
      text: input.text,
    });
  }

  private async processCvMedia(
    session: RecruitingSession,
    media: InboundStoredMedia,
  ): Promise<void> {
    const isCvFile = this.cvTextExtractorService.isSupportedCvFile({
      mimeType: media.mimeType,
      filename: media.filename,
    });
    if (!isCvFile) {
      await this.sendAssistantText(session, CV_INVALID_FORMAT_MESSAGE);
      return;
    }
    const cvText = await this.cvTextExtractorService.extractText({
      absolutePath: media.absolutePath,
      mimeType: media.mimeType,
      filename: media.filename,
    });
    await this.emitConversationTurn({
      candidateId: session.candidateId,
      role: 'user',
      text: `[CV recibido: ${media.filename || 'documento'}]`,
    });
    await this.emitMediaReceived({ session, media, action: 'recruiting.cv_received', cvText });
    session.stage = 'awaiting_video';
    await this.sendAssistantText(session, session.stageMessages.videoRequestMessage);
  }

  private async processVideoMedia(
    session: RecruitingSession,
    media: InboundStoredMedia,
    messageType: string,
  ): Promise<void> {
    const isVideo =
      messageType === 'video' || media.mimeType.toLowerCase().startsWith(VIDEO_MIME_PREFIX);
    if (!isVideo) {
      await this.sendAssistantText(session, VIDEO_INVALID_FORMAT_MESSAGE);
      return;
    }
    await this.emitConversationTurn({
      candidateId: session.candidateId,
      role: 'user',
      text: '[Video de presentación recibido]',
    });
    session.stage = 'done';
    await this.sendAssistantText(session, session.stageMessages.videoReceivedMessage);
    await this.emitMediaReceived({ session, media, action: 'recruiting.video_received' });
  }

  private async emitMediaReceived(input: {
    readonly session: RecruitingSession;
    readonly media: InboundStoredMedia;
    readonly action: 'recruiting.cv_received' | 'recruiting.video_received';
    readonly cvText?: string;
  }): Promise<void> {
    await this.emitCrmEvent({
      action: input.action,
      candidateId: input.session.candidateId,
      campaignId: input.session.campaignId,
      whatsappMessageId: input.media.whatsappMessageId,
      storedRelativePath: input.media.storedRelativePath,
      mimeType: input.media.mimeType,
      filename: input.media.filename,
      ...(input.cvText != null ? { cvText: input.cvText } : {}),
    });
  }

  private async sendAssistantText(session: RecruitingSession, text: string): Promise<void> {
    session.messages.push({ role: 'assistant', content: text });
    await this.whatsappCloudService.sendTextMessage(session.to, text);
    await this.emitConversationTurn({
      candidateId: session.candidateId,
      role: 'assistant',
      text,
    });
  }

  private async emitCrmEvent(payload: Record<string, unknown>): Promise<void> {
    await lastValueFrom(
      this.crmBackQueueClient.emit('ws_ms_event', {
        type: 'ws_ms_events',
        payload,
      } as CrmBackEventPayload),
    );
  }

  private isAwaitingCv(session: RecruitingSession): boolean {
    return session.stage === 'awaiting_cv';
  }

  private pickText(value: string | undefined, fallback: string): string {
    const trimmed = (value ?? '').trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  private async runAgentTurn(session: RecruitingSession): Promise<string | null> {
    const openai = this.getOpenai();
    const tools = this.buildTools();
    let messages = [...session.messages];
    for (let round = 0; round < RECRUITING_TOOL_ROUNDS_MAX; round += 1) {
      const completion = await openai.chat.completions.create({
        model: 'deepseek-chat',
        messages,
        tools,
        tool_choice: 'auto',
      });
      const choice = completion.choices[0]?.message;
      if (choice == null) {
        return null;
      }
      const toolCalls = choice.tool_calls;
      if (toolCalls == null || toolCalls.length === 0) {
        return typeof choice.content === 'string' ? choice.content : null;
      }
      messages = [
        ...messages,
        {
          role: 'assistant',
          content: choice.content ?? null,
          tool_calls: toolCalls,
        },
      ];
      for (const toolCall of toolCalls) {
        if (toolCall.type !== 'function') {
          continue;
        }
        const name = toolCall.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}') as Record<
            string,
            unknown
          >;
        } catch {
          args = {};
        }
        const result = await this.executeTool(session, name, args);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      session.messages = messages;
      if (session.stage !== 'collecting_data') {
        return null;
      }
    }
    return null;
  }

  private async executeTool(
    session: RecruitingSession,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (name === 'saveCapturedField') {
      const fieldKey =
        typeof args.fieldKey === 'string' ? args.fieldKey.trim() : '';
      const fieldValue =
        typeof args.fieldValue === 'string' ? args.fieldValue.trim() : '';
      if (fieldKey.length === 0 || fieldValue.length === 0) {
        return { ok: false, error: 'missing fieldKey or fieldValue' };
      }
      session.capturedData[fieldKey] = fieldValue;
      await lastValueFrom(
        this.crmBackQueueClient.emit('ws_ms_event', {
          type: 'ws_ms_events',
          payload: {
            action: 'recruiting.field_captured',
            candidateId: session.candidateId,
            campaignId: session.campaignId,
            fieldKey,
            fieldValue,
          },
        } as CrmBackEventPayload),
      );
      return { ok: true, capturedData: session.capturedData };
    }
    if (name === 'markDataComplete') {
      session.dataComplete = true;
      session.stage = 'awaiting_cv';
      await this.emitCrmEvent({
        action: 'recruiting.data_complete',
        candidateId: session.candidateId,
        campaignId: session.campaignId,
      });
      return {
        ok: true,
        message:
          'Datos completos. El sistema enviará automáticamente la solicitud del CV. NO escribas ningún mensaje adicional.',
      };
    }
    if (name === 'markInterviewAccepted') {
      session.interviewAccepted = true;
      await this.emitCrmEvent({
        action: 'recruiting.interview_accepted',
        candidateId: session.candidateId,
        campaignId: session.campaignId,
      });
      return {
        ok: true,
        message:
          'Aceptación registrada. El link de Meet se enviará después de recibir el CV y el video.',
      };
    }
    return { ok: false, error: `unknown tool ${name}` };
  }

  private buildTools(): ChatCompletionTool[] {
    return [
      {
        type: 'function',
        function: {
          name: 'saveCapturedField',
          description: 'Guarda un campo capturado del candidato.',
          parameters: {
            type: 'object',
            properties: {
              fieldKey: { type: 'string' },
              fieldValue: { type: 'string' },
            },
            required: ['fieldKey', 'fieldValue'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'markDataComplete',
          description: 'Marca que todos los datos obligatorios ya fueron capturados.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      {
        type: 'function',
        function: {
          name: 'markInterviewAccepted',
          description:
            'Marca que el candidato aceptó claramente ser agendado a la reunión virtual.',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
    ];
  }

  private async emitConversationTurn(input: {
    readonly candidateId: string;
    readonly role: 'user' | 'assistant' | 'system';
    readonly text: string;
  }): Promise<void> {
    await lastValueFrom(
      this.crmBackQueueClient.emit('ws_ms_event', {
        type: 'ws_ms_events',
        payload: {
          action: 'recruiting.conversation_turn',
          candidateId: input.candidateId,
          role: input.role,
          text: input.text,
        },
      } as CrmBackEventPayload),
    );
  }

  private getOpenai(): OpenAI {
    if (this.openaiClient != null) {
      return this.openaiClient;
    }
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (apiKey == null || apiKey.trim().length === 0) {
      throw new Error('DEEPSEEK_API_KEY is not configured');
    }
    this.openaiClient = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey: apiKey.trim(),
    });
    return this.openaiClient;
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }
}
