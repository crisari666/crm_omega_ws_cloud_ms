import { Module } from '@nestjs/common';
import { WhatsappCloudModule } from '../whatsapp-cloud/whatsapp-cloud.module';
import { MarketingCampaignMsEventsController } from './marketing-campaign-ms-events.controller';
import { MarketingCampaignMsEventsService } from './marketing-campaign-ms-events.service';

@Module({
  imports: [WhatsappCloudModule],
  controllers: [MarketingCampaignMsEventsController],
  providers: [MarketingCampaignMsEventsService],
})
export class MarketingCampaignModule {}
