import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { LEAD_CONVERSATION_SEND_PATTERN } from './constants/lead-conversation.constants';
import { LeadConversationSenderService } from './lead-conversation-sender.service';
import type { LeadConversationSendCommand } from './types/lead-conversation-send-command.interface';
import type { LeadConversationSendResult } from './types/lead-conversation-send-result.interface';

/** RabbitMQ RPC entry for crm-omega-customers-ms lead qualification sends. */
@Controller()
export class LeadConversationEventsController {
  constructor(private readonly senderService: LeadConversationSenderService) {}

  @MessagePattern(LEAD_CONVERSATION_SEND_PATTERN)
  async handleSend(@Payload() command: LeadConversationSendCommand): Promise<LeadConversationSendResult> {
    return this.senderService.executeSend(command);
  }
}
