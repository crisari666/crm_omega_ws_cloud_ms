import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { WHATSAPP_CLIENT } from './constants/whatsapp-client.token';
import { WhatsappChat } from './schemas/whatsapp-chat.schema';
import { WhatsappMessage } from './schemas/whatsapp-message.schema';
import { WhatsappLocalMediaStorageService } from './whatsapp-local-media-storage.service';
import type { LotesChatDuplicateInboundSuppression } from './interfaces/lotes-chat-duplicate-inbound-suppression.interface';
import { WsChatMsgHandlerService } from './ws-chat-msg-handler.service';

describe('WsChatMsgHandlerService', () => {
  let service: WsChatMsgHandlerService;
  const chatFindChain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };
  const mockChatModel = {
    find: jest.fn().mockReturnValue(chatFindChain),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    exists: jest.fn(),
    findById: jest.fn(),
  };
  const messageFindChain = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };
  const mockMessageModel = {
    find: jest.fn().mockReturnValue(messageFindChain),
    exists: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  };
  const mockWhatsAppClient = {
    media: {
      get: jest.fn(),
      download: jest.fn(),
    },
  };
  const mockLocalMedia = {
    saveInboundMedia: jest.fn(),
    resolveSafeAbsolutePath: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WsChatMsgHandlerService,
        { provide: getModelToken(WhatsappChat.name), useValue: mockChatModel },
        { provide: getModelToken(WhatsappMessage.name), useValue: mockMessageModel },
        { provide: WHATSAPP_CLIENT, useValue: mockWhatsAppClient },
        { provide: WhatsappLocalMediaStorageService, useValue: mockLocalMedia },
      ],
    }).compile();
    service = module.get(WsChatMsgHandlerService);
  });

  it('listChats returns empty page when no documents', async () => {
    chatFindChain.exec.mockResolvedValue([]);
    const actual = await service.listChats({ limit: 10 });
    const expectedHasMore = false;
    expect(actual.items).toEqual([]);
    expect(actual.hasMore).toBe(expectedHasMore);
    expect(actual.nextCursor).toBeNull();
  });

  it('getWaIdByChatId throws when chat missing', async () => {
    const inputChatId = new Types.ObjectId().toHexString();
    mockChatModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      }),
    });
    await expect(service.getWaIdByChatId(inputChatId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('buildRecentLlmConversation returns fallback user turn when chat is missing', async () => {
    mockChatModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    const inputWaId = '521234567890';
    const inputFallback = 'Hola';
    const actual = await service.buildRecentLlmConversation({
      waId: inputWaId,
      phoneNumberId: 'pn1',
      fallbackUserText: inputFallback,
    });
    const expected: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: inputFallback },
    ];
    expect(actual).toEqual(expected);
  });

  it('buildRecentLlmConversation maps inbound/outbound to user/assistant chronologically', async () => {
    const chatId = new Types.ObjectId();
    mockChatModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: chatId, waId: '521', phoneNumberId: 'pn1' }),
    });
    const older = new Date('2020-01-01T00:00:00.000Z');
    const newer = new Date('2020-01-02T00:00:00.000Z');
    messageFindChain.exec.mockResolvedValue([
      {
        direction: 'outbound',
        type: 'text',
        textBody: 'Bot',
        caption: undefined,
        timestamp: newer,
      },
      {
        direction: 'inbound',
        type: 'text',
        textBody: 'User',
        caption: undefined,
        timestamp: older,
      },
    ]);
    mockMessageModel.find.mockReturnValue(messageFindChain);
    const inputCurrentText = 'Gracias';
    const actual = await service.buildRecentLlmConversation({
      waId: '521',
      phoneNumberId: 'pn1',
      fallbackUserText: inputCurrentText,
    });
    const expected = [
      { role: 'user', content: 'User' },
      { role: 'assistant', content: 'Bot' },
      { role: 'user', content: inputCurrentText },
    ];
    expect(actual).toEqual(expected);
  });

  it('shouldSkipLlmReplyForDuplicateInbound returns false when suppression disabled', async () => {
    const suppression: LotesChatDuplicateInboundSuppression = {
      enabled: false,
      windowSeconds: 60,
      minTextLength: 1,
    };
    const actual = await service.shouldSkipLlmReplyForDuplicateInbound({
      waId: '521',
      phoneNumberId: 'pn1',
      currentTextBody: 'same',
      suppression,
    });
    expect(actual).toBe(false);
    expect(mockChatModel.findOne).not.toHaveBeenCalled();
  });

  it('shouldSkipLlmReplyForDuplicateInbound returns false when text shorter than minTextLength', async () => {
    const suppression: LotesChatDuplicateInboundSuppression = {
      enabled: true,
      windowSeconds: 3600,
      minTextLength: 10,
    };
    const actual = await service.shouldSkipLlmReplyForDuplicateInbound({
      waId: '521',
      phoneNumberId: 'pn1',
      currentTextBody: 'short',
      suppression,
    });
    expect(actual).toBe(false);
  });

  it('shouldSkipLlmReplyForDuplicateInbound returns true when two consecutive identical inbounds fall in window', async () => {
    const chatId = new Types.ObjectId();
    mockChatModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: chatId, waId: '521', phoneNumberId: 'pn1' }),
    });
    const t1 = new Date('2026-03-28T10:00:00.000Z');
    const t2 = new Date('2026-03-28T10:05:00.000Z');
    messageFindChain.exec.mockResolvedValue([
      { direction: 'inbound', type: 'text', textBody: 'Auto away message', caption: undefined, timestamp: t2 },
      { direction: 'inbound', type: 'text', textBody: 'Auto away message', caption: undefined, timestamp: t1 },
    ]);
    mockMessageModel.find.mockReturnValue(messageFindChain);
    const suppression: LotesChatDuplicateInboundSuppression = {
      enabled: true,
      windowSeconds: 7200,
      minTextLength: 5,
    };
    const actual = await service.shouldSkipLlmReplyForDuplicateInbound({
      waId: '521',
      phoneNumberId: 'pn1',
      currentTextBody: 'Auto away message',
      suppression,
    });
    expect(actual).toBe(true);
  });

  it('shouldSkipLlmReplyForDuplicateInbound returns false when previous inbound text differs', async () => {
    const chatId = new Types.ObjectId();
    mockChatModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: chatId, waId: '521', phoneNumberId: 'pn1' }),
    });
    const t1 = new Date('2026-03-28T10:00:00.000Z');
    const t2 = new Date('2026-03-28T10:05:00.000Z');
    messageFindChain.exec.mockResolvedValue([
      { direction: 'inbound', type: 'text', textBody: 'Second', caption: undefined, timestamp: t2 },
      { direction: 'inbound', type: 'text', textBody: 'First', caption: undefined, timestamp: t1 },
    ]);
    mockMessageModel.find.mockReturnValue(messageFindChain);
    const suppression: LotesChatDuplicateInboundSuppression = {
      enabled: true,
      windowSeconds: 7200,
      minTextLength: 1,
    };
    const actual = await service.shouldSkipLlmReplyForDuplicateInbound({
      waId: '521',
      phoneNumberId: 'pn1',
      currentTextBody: 'Second',
      suppression,
    });
    expect(actual).toBe(false);
  });

  it('shouldSkipLlmReplyForDuplicateInbound returns false when gap exceeds windowSeconds', async () => {
    const chatId = new Types.ObjectId();
    mockChatModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ _id: chatId, waId: '521', phoneNumberId: 'pn1' }),
    });
    const t1 = new Date('2026-03-28T10:00:00.000Z');
    const t2 = new Date('2026-03-28T12:30:00.000Z');
    messageFindChain.exec.mockResolvedValue([
      { direction: 'inbound', type: 'text', textBody: 'Repeat', caption: undefined, timestamp: t2 },
      { direction: 'inbound', type: 'text', textBody: 'Repeat', caption: undefined, timestamp: t1 },
    ]);
    mockMessageModel.find.mockReturnValue(messageFindChain);
    const suppression: LotesChatDuplicateInboundSuppression = {
      enabled: true,
      windowSeconds: 3600,
      minTextLength: 1,
    };
    const actual = await service.shouldSkipLlmReplyForDuplicateInbound({
      waId: '521',
      phoneNumberId: 'pn1',
      currentTextBody: 'Repeat',
      suppression,
    });
    expect(actual).toBe(false);
  });
});
