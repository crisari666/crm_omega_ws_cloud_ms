import { Module } from '@nestjs/common';
import { LeadConversationEventsController } from './lead-conversation-events.controller';
import { LeadConversationSenderService } from './lead-conversation-sender.service';

@Module({
  controllers: [LeadConversationEventsController],
  providers: [LeadConversationSenderService],
})
export class LeadConversationModule {}
