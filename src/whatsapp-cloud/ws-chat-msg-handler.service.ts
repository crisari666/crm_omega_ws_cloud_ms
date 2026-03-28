import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { SendMessageResponse, UnifiedMessage } from '@kapso/whatsapp-cloud-api';
import { WhatsAppClient } from '@kapso/whatsapp-cloud-api';
import { WHATSAPP_CLIENT } from './constants/whatsapp-client.token';
import { WhatsappChat, WhatsappChatDocument } from './schemas/whatsapp-chat.schema';
import {
  WhatsappMessage,
  WhatsappMessageDocument,
  WhatsappMessageMedia,
} from './schemas/whatsapp-message.schema';
import type { PaginatedResult } from './types/paginated-result.type';
import type { WhatsappLlmConversationTurn } from './interfaces/whatsapp-llm-conversation-turn.interface';
import { WhatsappLocalMediaStorageService } from './whatsapp-local-media-storage.service';
import { normalizeWaId } from './utils/normalize-wa-id.util';
import { parseWhatsappTimestampSeconds } from './utils/message-timestamp.util';

// Kapso webhook normalizer is published under `@kapso/whatsapp-cloud-api/server` (package exports).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { normalizeWebhook } = require('@kapso/whatsapp-cloud-api/server') as {
  normalizeWebhook: (payload: unknown) => NormalizedKapsoWebhook;
};

interface NormalizedKapsoWebhook {
  phoneNumberId?: string;
  displayPhoneNumber?: string;
  contacts: Array<Record<string, unknown>>;
  messages: UnifiedMessage[];
  statuses: Array<Record<string, unknown>>;
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);

/** Max stored messages to load into DeepSeek La Ceiba context (newest first, then reordered chronologically). */
const LOTES_DEEPSEEK_HISTORY_MESSAGE_CAP = 40;

/**
 * Persists WhatsApp chat headers and messages using Kapso-normalized webhook payloads and Kapso client for media download.
 */
@Injectable()
export class WsChatMsgHandlerService {
  private readonly logger = new Logger(WsChatMsgHandlerService.name);

  public constructor(
    @InjectModel(WhatsappChat.name) private readonly chatModel: Model<WhatsappChatDocument>,
    @InjectModel(WhatsappMessage.name)
    private readonly messageModel: Model<WhatsappMessageDocument>,
    @Inject(WHATSAPP_CLIENT) private readonly whatsAppClient: WhatsAppClient,
    private readonly localMediaStorage: WhatsappLocalMediaStorageService,
  ) {}

  /**
   * Normalizes a webhook POST body with Kapso and persists each inbound message.
   */
  public async persistInboundWebhookPayload(webhookBody: unknown): Promise<void> {
    let normalized: NormalizedKapsoWebhook;
    try {
      normalized = normalizeWebhook(webhookBody);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`normalizeWebhook failed: ${msg}`);
      return;
    }
    const phoneNumberId =
      typeof normalized.phoneNumberId === 'string' ? normalized.phoneNumberId.trim() : '';
    if (phoneNumberId.length === 0) {
      this.logger.warn('Skipping persistence: missing phoneNumberId on webhook');
      return;
    }
    const displayPhoneNumber =
      typeof normalized.displayPhoneNumber === 'string' ? normalized.displayPhoneNumber : undefined;
    for (const unified of normalized.messages) {
      await this.persistSingleInboundUnified({
        contacts: normalized.contacts,
        displayPhoneNumber,
        phoneNumberId,
        message: unified,
      });
    }
  }

  /**
   * Persists one inbound message after Kapso normalization.
   */
  public async persistSingleInboundUnified(input: {
    contacts: Array<Record<string, unknown>>;
    displayPhoneNumber?: string;
    phoneNumberId: string;
    message: UnifiedMessage;
  }): Promise<void> {
    const msg = input.message;
    if (msg.id == null || msg.id.length === 0) {
      return;
    }
    const fromRaw = typeof msg.from === 'string' ? msg.from : '';
    const waId = normalizeWaId(fromRaw.length > 0 ? fromRaw : this.resolveWaIdFromContacts(input.contacts));
    if (waId.length === 0) {
      this.logger.warn(`Skipping inbound message ${msg.id}: missing waId`);
      return;
    }
    const profileName = this.resolveProfileName(input.contacts, fromRaw || waId);
    const timestamp = parseWhatsappTimestampSeconds(msg.timestamp);
    const extracted = this.extractInboundContent(msg);
    const [duplicate, chat] = await Promise.all([
      this.messageModel.exists({ whatsappMessageId: msg.id }).exec(),
      this.chatModel
        .findOneAndUpdate(
          { waId, phoneNumberId: input.phoneNumberId },
          {
            $set: {
              displayPhoneNumber: input.displayPhoneNumber,
              profileName,
              lastMessageAt: timestamp,
            },
          },
          { upsert: true, new: true },
        )
        .exec(),
    ]);
    if (duplicate != null) {
      return;
    }
    if (chat == null) {
      this.logger.error(`Chat upsert failed for waId=${waId}`);
      return;
    }
    const mediaPayload = await this.downloadInboundMediaIfNeeded({
      message: msg,
      phoneNumberId: input.phoneNumberId,
      waId,
    });
    const contextId =
      msg.context != null && typeof msg.context.id === 'string' ? msg.context.id : undefined;
    await this.messageModel.create({
      chat: chat._id,
      direction: 'inbound',
      whatsappMessageId: msg.id,
      type: extracted.type,
      timestamp,
      textBody: extracted.textBody,
      caption: extracted.caption,
      media: mediaPayload,
      contextMessageId: contextId,
      interactiveSnapshot: extracted.interactiveSnapshot,
      rawPayload: this.buildTrimmedRawPayload(msg),
    });
  }

  /**
   * Persists outbound message after a successful Kapso send.
   */
  public async persistOutboundAfterSend(input: {
    toWaId: string;
    phoneNumberId: string;
    response: SendMessageResponse;
    type: string;
    textBody?: string;
    caption?: string;
    media?: WhatsappMessageMedia;
    contextMessageId?: string;
    profileName?: string;
    displayPhoneNumber?: string;
  }): Promise<void> {
    const messageId = input.response.messages?.[0]?.id;
    if (messageId == null || messageId.length === 0) {
      return;
    }
    const waId = normalizeWaId(input.toWaId);
    if (waId.length === 0) {
      return;
    }
    const duplicate = await this.messageModel.exists({ whatsappMessageId: messageId }).exec();
    if (duplicate != null) {
      return;
    }
    const timestamp = new Date();
    const chat = await this.chatModel
      .findOneAndUpdate(
        { waId, phoneNumberId: input.phoneNumberId },
        {
          $set: {
            displayPhoneNumber: input.displayPhoneNumber,
            profileName: input.profileName,
            lastMessageAt: timestamp,
          },
        },
        { upsert: true, new: true },
      )
      .exec();
    if (chat == null) {
      return;
    }
    await this.messageModel.create({
      chat: chat._id,
      direction: 'outbound',
      whatsappMessageId: messageId,
      type: input.type,
      timestamp,
      textBody: input.textBody,
      caption: input.caption,
      media: input.media,
      contextMessageId: input.contextMessageId,
    });
  }

  /**
   * Lists chats sorted by last activity (newest first) with cursor pagination on `_id`.
   */
  public async listChats(input: { limit: number; before?: string }): Promise<PaginatedResult<WhatsappChatDocument>> {
    const limit = Math.min(Math.max(input.limit, 1), 100);
    const filter: Record<string, unknown> = {};
    if (input.before != null && input.before.length > 0 && Types.ObjectId.isValid(input.before)) {
      filter._id = { $lt: new Types.ObjectId(input.before) };
    }
    const rows = await this.chatModel
      .find(filter)
      .sort({ lastMessageAt: -1, _id: -1 })
      .limit(limit + 1)
      .exec();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? String(items[items.length - 1]._id) : null;
    return { items, nextCursor, hasMore };
  }

  /**
   * Lists messages for a chat (newest first) with cursor pagination on `_id`.
   */
  public async listMessagesByChat(input: {
    chatId: string;
    limit: number;
    before?: string;
  }): Promise<PaginatedResult<WhatsappMessageDocument>> {
    if (!Types.ObjectId.isValid(input.chatId)) {
      throw new NotFoundException('Chat not found');
    }
    const chatObjectId = new Types.ObjectId(input.chatId);
    const chatExists = await this.chatModel.exists({ _id: chatObjectId }).exec();
    if (chatExists == null) {
      throw new NotFoundException('Chat not found');
    }
    const limit = Math.min(Math.max(input.limit, 1), 100);
    const filter: Record<string, unknown> = { chat: chatObjectId };
    if (input.before != null && input.before.length > 0 && Types.ObjectId.isValid(input.before)) {
      filter._id = { $lt: new Types.ObjectId(input.before) };
    }
    const rows = await this.messageModel
      .find(filter)
      .sort({ timestamp: -1, _id: -1 })
      .limit(limit + 1)
      .exec();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? String(items[items.length - 1]._id) : null;
    return { items, nextCursor, hasMore };
  }

  /**
   * Builds user/assistant turns from persisted {@link WhatsappMessage} rows for La Ceiba DeepSeek context.
   * Appends {@link input.fallbackUserText} when the latest inbound line is not yet stored (e.g. duplicate webhook).
   */
  public async buildRecentLlmConversation(input: {
    waId: string;
    phoneNumberId: string;
    fallbackUserText: string;
    maxMessages?: number;
  }): Promise<readonly WhatsappLlmConversationTurn[]> {
    const waIdNorm = normalizeWaId(input.waId);
    const phoneNumberIdTrimmed = input.phoneNumberId.trim();
    const cap = Math.min(
      Math.max(input.maxMessages ?? LOTES_DEEPSEEK_HISTORY_MESSAGE_CAP, 1),
      100,
    );
    const trimmedFallback = input.fallbackUserText.trim();
    const singleUserFallback = (): readonly WhatsappLlmConversationTurn[] =>
      trimmedFallback.length > 0 ? [{ role: 'user', content: trimmedFallback }] : [];
    if (waIdNorm.length === 0 || phoneNumberIdTrimmed.length === 0) {
      return singleUserFallback();
    }
    const chat = await this.chatModel
      .findOne({ waId: waIdNorm, phoneNumberId: phoneNumberIdTrimmed })
      .exec();
    if (chat == null) {
      return singleUserFallback();
    }
    const newestFirst = await this.messageModel
      .find({ chat: chat._id })
      .sort({ timestamp: -1, _id: -1 })
      .limit(cap)
      .exec();
    const chronological = newestFirst.slice().reverse();
    const turns: WhatsappLlmConversationTurn[] = [];
    for (const doc of chronological) {
      const content = this.resolveMessageTextForLlm(doc);
      const role: 'user' | 'assistant' = doc.direction === 'inbound' ? 'user' : 'assistant';
      turns.push({ role, content });
    }
    const last = turns[turns.length - 1];
    const alreadyEndsWithCurrentUser =
      last != null && last.role === 'user' && last.content === trimmedFallback;
    if (trimmedFallback.length > 0 && !alreadyEndsWithCurrentUser) {
      turns.push({ role: 'user', content: trimmedFallback });
    }
    return turns;
  }

  /**
   * Returns the WhatsApp user id for an existing chat document.
   */
  public async getWaIdByChatId(chatId: string): Promise<string> {
    if (!Types.ObjectId.isValid(chatId)) {
      throw new NotFoundException('Chat not found');
    }
    const chat = await this.chatModel.findById(chatId).select('waId').exec();
    if (chat == null) {
      throw new NotFoundException('Chat not found');
    }
    return chat.waId;
  }

  /**
   * Loads a message by id for attachment streaming.
   */
  public async getMessageForAttachment(input: {
    chatId: string;
    messageId: string;
  }): Promise<WhatsappMessageDocument | null> {
    if (!Types.ObjectId.isValid(input.chatId) || !Types.ObjectId.isValid(input.messageId)) {
      return null;
    }
    return this.messageModel
      .findOne({
        _id: new Types.ObjectId(input.messageId),
        chat: new Types.ObjectId(input.chatId),
        'media.storedRelativePath': { $exists: true, $ne: '' },
      })
      .exec();
  }

  /**
   * Resolves a stored inbound attachment to an absolute file path for HTTP streaming.
   */
  public async resolveInboundAttachmentPath(input: {
    chatId: string;
    messageId: string;
  }): Promise<{ absolutePath: string; mimeType: string } | null> {
    const msg = await this.getMessageForAttachment(input);
    const relative = msg?.media?.storedRelativePath;
    if (msg == null || relative == null || relative.length === 0) {
      return null;
    }
    const absolutePath = this.localMediaStorage.resolveSafeAbsolutePath(relative);
    if (absolutePath == null) {
      return null;
    }
    const mimeType =
      msg.media.mimeType != null && msg.media.mimeType.length > 0
        ? msg.media.mimeType
        : 'application/octet-stream';
    return { absolutePath, mimeType };
  }

  private resolveMessageTextForLlm(doc: WhatsappMessageDocument): string {
    const textBody = doc.textBody?.trim();
    if (textBody != null && textBody.length > 0) {
      return textBody;
    }
    const caption = doc.caption?.trim();
    if (caption != null && caption.length > 0) {
      return caption;
    }
    const type = typeof doc.type === 'string' && doc.type.length > 0 ? doc.type : 'message';
    return `[${type}]`;
  }

  private resolveWaIdFromContacts(contacts: Array<Record<string, unknown>>): string {
    const first = contacts[0];
    const wa = first?.wa_id;
    return typeof wa === 'string' ? wa : '';
  }

  private resolveProfileName(contacts: Array<Record<string, unknown>>, waId: string): string | undefined {
    const match = contacts.find((c) => {
      const w = c.wa_id;
      return typeof w === 'string' && normalizeWaId(w) === normalizeWaId(waId);
    });
    const profile = match?.profile as Record<string, unknown> | undefined;
    const name = profile?.name;
    return typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined;
  }

  private extractInboundContent(message: UnifiedMessage): {
    type: string;
    textBody?: string;
    caption?: string;
    interactiveSnapshot?: Record<string, unknown>;
  } {
    const type = typeof message.type === 'string' ? message.type : 'unknown';
    const textBody =
      message.text?.body != null && message.text.body.length > 0 ? message.text.body : undefined;
    const rec = message as Record<string, unknown>;
    if (type === 'button') {
      const button = rec.button as Record<string, unknown> | undefined;
      const payload = button?.payload;
      const text = button?.text;
      const parts: string[] = [];
      if (typeof text === 'string' && text.length > 0) {
        parts.push(text);
      }
      if (typeof payload === 'string' && payload.length > 0) {
        parts.push(payload);
      }
      return {
        type,
        textBody: parts.length > 0 ? parts.join(' ') : textBody,
        interactiveSnapshot: button != null ? { button } : undefined,
      };
    }
    if (message.image?.caption != null && message.image.caption.length > 0) {
      return { type, textBody, caption: message.image.caption };
    }
    if (message.video?.caption != null && message.video.caption.length > 0) {
      return { type, textBody, caption: message.video.caption };
    }
    if (message.document?.caption != null && message.document.caption.length > 0) {
      return { type, textBody, caption: message.document.caption };
    }
    if (message.interactive != null) {
      return {
        type,
        textBody,
        interactiveSnapshot: message.interactive as Record<string, unknown>,
      };
    }
    return { type, textBody };
  }

  private buildTrimmedRawPayload(message: UnifiedMessage): Record<string, unknown> | undefined {
    const json = JSON.parse(JSON.stringify(message)) as Record<string, unknown>;
    const s = JSON.stringify(json);
    if (s.length > 16000) {
      return { truncated: true, type: message.type, id: message.id };
    }
    return json;
  }

  private pickInboundMedia(
    message: UnifiedMessage,
  ): { id: string; caption?: string; filename?: string } | null {
    if (message.image?.id != null && message.image.id.length > 0) {
      return { id: message.image.id, caption: message.image.caption, filename: undefined };
    }
    if (message.video?.id != null && message.video.id.length > 0) {
      return { id: message.video.id, caption: message.video.caption };
    }
    if (message.audio?.id != null && message.audio.id.length > 0) {
      return { id: message.audio.id };
    }
    if (message.document?.id != null && message.document.id.length > 0) {
      return {
        id: message.document.id,
        caption: message.document.caption,
        filename: message.document.filename,
      };
    }
    if (message.sticker?.id != null && message.sticker.id.length > 0) {
      return { id: message.sticker.id };
    }
    return null;
  }

  private async downloadInboundMediaIfNeeded(input: {
    message: UnifiedMessage;
    phoneNumberId: string;
    waId: string;
  }): Promise<WhatsappMessageMedia | undefined> {
    const type = typeof input.message.type === 'string' ? input.message.type : '';
    if (!MEDIA_TYPES.has(type)) {
      return undefined;
    }
    const picked = this.pickInboundMedia(input.message);
    if (picked == null) {
      return undefined;
    }
    try {
      const meta = await this.whatsAppClient.media.get({
        mediaId: picked.id,
        phoneNumberId: input.phoneNumberId,
      });
      const buffer = await this.whatsAppClient.media.download({
        mediaId: picked.id,
        phoneNumberId: input.phoneNumberId,
        as: 'arrayBuffer',
      });
      const nodeBuffer = Buffer.from(buffer as ArrayBuffer);
      const saved = await this.localMediaStorage.saveInboundMedia({
        waId: input.waId,
        whatsappMessageId: input.message.id,
        buffer: nodeBuffer,
        mimeType: meta.mimeType,
        originalFilename: picked.filename,
      });
      const sizeNum = Number(meta.fileSize);
      return {
        whatsappMediaId: picked.id,
        mimeType: meta.mimeType,
        filename: picked.filename,
        storedRelativePath: saved.relativePath,
        byteSize: Number.isNaN(sizeNum) ? saved.byteSize : sizeNum,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Inbound media download failed for ${picked.id}: ${msg}`);
      return {
        whatsappMediaId: picked.id,
        filename: picked.filename,
      };
    }
  }
}
