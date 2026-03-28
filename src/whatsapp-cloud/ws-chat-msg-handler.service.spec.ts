import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { WHATSAPP_CLIENT } from './constants/whatsapp-client.token';
import { WhatsappChat } from './schemas/whatsapp-chat.schema';
import { WhatsappMessage } from './schemas/whatsapp-message.schema';
import { WhatsappLocalMediaStorageService } from './whatsapp-local-media-storage.service';
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
});
