import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { WsChatMsgHandlerService } from './ws-chat-msg-handler.service';
import { ListChatsQueryDto } from './dto/list-chats-query.dto';
import { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import { SendChatTextBodyDto } from './dto/send-chat-text-body.dto';
import { SendImageMessageDto } from './dto/send-image-message.dto';
import { SendDocumentMessageDto } from './dto/send-document-message.dto';
import { SendVideoMessageDto } from './dto/send-video-message.dto';
import { SendAudioMessageDto } from './dto/send-audio-message.dto';
import { SendStickerMessageDto } from './dto/send-sticker-message.dto';
import type { WhatsappChatDocument } from './schemas/whatsapp-chat.schema';
import type { WhatsappMessageDocument } from './schemas/whatsapp-message.schema';

/**
 * HTTP API for stored WhatsApp chats and messages (MongoDB) plus send helpers.
 */
@Controller('whatsapp-cloud')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class WhatsappChatController {
  private readonly logger = new Logger(WhatsappChatController.name);

  public constructor(
    private readonly wsChatMsgHandlerService: WsChatMsgHandlerService,
    private readonly whatsappCloudService: WhatsappCloudService,
  ) {}

  /**
   * Smoke test for load balancers and monitoring.
   */
  @Get('chats/admin/test')
  @HttpCode(HttpStatus.OK)
  adminTest(): { ok: boolean } {
    return { ok: true };
  }

  @Get('chats')
  @HttpCode(HttpStatus.OK)
  async listChats(@Query() query: ListChatsQueryDto) {
    const limit = query.limit ?? 20;
    const page = await this.wsChatMsgHandlerService.listChats({
      limit,
      before: query.before,
    });
    return {
      items: page.items.map((c) => this.serializeChat(c)),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  @Get('chats/:chatId/messages')
  @HttpCode(HttpStatus.OK)
  async listMessages(@Param('chatId') chatId: string, @Query() query: ListMessagesQueryDto) {
    const limit = query.limit ?? 30;
    const page = await this.wsChatMsgHandlerService.listMessagesByChat({
      chatId,
      limit,
      before: query.before,
    });
    return {
      items: page.items.map((m) => this.serializeMessage(m)),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  @Get('chats/:chatId/messages/:messageId/attachment')
  @HttpCode(HttpStatus.OK)
  async streamAttachment(
    @Param('chatId') chatId: string,
    @Param('messageId') messageId: string,
    @Res() res: Response,
  ): Promise<void> {
    const resolved = await this.wsChatMsgHandlerService.resolveInboundAttachmentPath({
      chatId,
      messageId,
    });
    if (resolved == null) {
      throw new NotFoundException('Attachment not found');
    }
    try {
      await stat(resolved.absolutePath);
    } catch {
      throw new NotFoundException('Attachment file missing');
    }
    res.setHeader('Content-Type', resolved.mimeType);
    const stream = createReadStream(resolved.absolutePath);
    stream.on('error', (err) => {
      this.logger.warn(`Attachment stream error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        res.status(500).end();
      }
    });
    stream.pipe(res);
  }

  @Post('chats/:chatId/messages/text')
  @HttpCode(HttpStatus.OK)
  async sendTextForChat(
    @Param('chatId') chatId: string,
    @Body() body: SendChatTextBodyDto,
  ): Promise<unknown> {
    const waId = await this.wsChatMsgHandlerService.getWaIdByChatId(chatId);
    return this.whatsappCloudService.sendTextMessage(waId, body.body);
  }

  @Post('chats/:chatId/messages/image')
  @HttpCode(HttpStatus.OK)
  async sendImageForChat(
    @Param('chatId') chatId: string,
    @Body() dto: SendImageMessageDto,
  ): Promise<unknown> {
    this.assertIdOrLink(dto.id, dto.link);
    const waId = await this.wsChatMsgHandlerService.getWaIdByChatId(chatId);
    return this.whatsappCloudService.sendImageMessage({
      to: waId,
      image: { id: dto.id, link: dto.link, caption: dto.caption },
    });
  }

  @Post('chats/:chatId/messages/document')
  @HttpCode(HttpStatus.OK)
  async sendDocumentForChat(
    @Param('chatId') chatId: string,
    @Body() dto: SendDocumentMessageDto,
  ): Promise<unknown> {
    this.assertIdOrLink(dto.id, dto.link);
    const waId = await this.wsChatMsgHandlerService.getWaIdByChatId(chatId);
    return this.whatsappCloudService.sendDocumentMessage({
      to: waId,
      document: {
        id: dto.id,
        link: dto.link,
        caption: dto.caption,
        filename: dto.filename,
      },
    });
  }

  @Post('chats/:chatId/messages/video')
  @HttpCode(HttpStatus.OK)
  async sendVideoForChat(
    @Param('chatId') chatId: string,
    @Body() dto: SendVideoMessageDto,
  ): Promise<unknown> {
    this.assertIdOrLink(dto.id, dto.link);
    const waId = await this.wsChatMsgHandlerService.getWaIdByChatId(chatId);
    return this.whatsappCloudService.sendVideoMessage({
      to: waId,
      video: { id: dto.id, link: dto.link, caption: dto.caption },
    });
  }

  @Post('chats/:chatId/messages/audio')
  @HttpCode(HttpStatus.OK)
  async sendAudioForChat(
    @Param('chatId') chatId: string,
    @Body() dto: SendAudioMessageDto,
  ): Promise<unknown> {
    this.assertIdOrLink(dto.id, dto.link);
    const waId = await this.wsChatMsgHandlerService.getWaIdByChatId(chatId);
    return this.whatsappCloudService.sendAudioMessage({
      to: waId,
      audio: { id: dto.id, link: dto.link, voice: dto.voice },
    });
  }

  @Post('chats/:chatId/messages/sticker')
  @HttpCode(HttpStatus.OK)
  async sendStickerForChat(
    @Param('chatId') chatId: string,
    @Body() dto: SendStickerMessageDto,
  ): Promise<unknown> {
    this.assertIdOrLink(dto.id, dto.link);
    const waId = await this.wsChatMsgHandlerService.getWaIdByChatId(chatId);
    return this.whatsappCloudService.sendStickerMessage({
      to: waId,
      sticker: { id: dto.id, link: dto.link },
    });
  }

  private assertIdOrLink(id?: string, link?: string): void {
    const hasId = id != null && id.length > 0;
    const hasLink = link != null && link.length > 0;
    if (!hasId && !hasLink) {
      throw new BadRequestException('Provide either id (uploaded media id) or link (HTTPS URL)');
    }
  }

  private serializeChat(chat: WhatsappChatDocument) {
    return {
      id: String(chat._id),
      waId: chat.waId,
      phoneNumberId: chat.phoneNumberId,
      displayPhoneNumber: chat.displayPhoneNumber ?? null,
      profileName: chat.profileName ?? null,
      lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
      createdAt: this.readTimestamp(chat, 'createdAt'),
      updatedAt: this.readTimestamp(chat, 'updatedAt'),
    };
  }

  private serializeMessage(message: WhatsappMessageDocument) {
    const media =
      message.media != null
        ? {
            whatsappMediaId: message.media.whatsappMediaId ?? null,
            mimeType: message.media.mimeType ?? null,
            filename: message.media.filename ?? null,
            storedRelativePath: message.media.storedRelativePath ?? null,
            byteSize: message.media.byteSize ?? null,
          }
        : null;
    return {
      id: String(message._id),
      chatId: String(message.chat),
      direction: message.direction,
      whatsappMessageId: message.whatsappMessageId,
      type: message.type,
      timestamp: message.timestamp.toISOString(),
      textBody: message.textBody ?? null,
      caption: message.caption ?? null,
      media,
      contextMessageId: message.contextMessageId ?? null,
      interactiveSnapshot: message.interactiveSnapshot ?? null,
      createdAt: this.readTimestamp(message, 'createdAt'),
      updatedAt: this.readTimestamp(message, 'updatedAt'),
    };
  }

  private readTimestamp(doc: WhatsappChatDocument | WhatsappMessageDocument, key: string): string | null {
    const value = doc.get(key) as Date | undefined;
    return value instanceof Date ? value.toISOString() : null;
  }
}
