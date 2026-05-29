import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { MarketingCampaignMsEventsService } from './marketing-campaign-ms-events.service';

@Controller()
export class MarketingCampaignMsEventsController {
  constructor(
    private readonly marketingCampaignMsEventsService: MarketingCampaignMsEventsService,
  ) {}

  @EventPattern('marketing_campaign.ms_ws')
  @MessagePattern('marketing_campaign.ms_ws')
  async handleMarketingCampaignMsEvent(
    @Payload() payload: unknown,
  ): Promise<{ success: boolean; message?: string; messageId?: string }> {
    return this.marketingCampaignMsEventsService.executeHandleEnvelope(payload);
  }
}
