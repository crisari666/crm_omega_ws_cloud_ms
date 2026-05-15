import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import { PotentialCustomersMsEventsService } from './potential-customers-ms-events.service';

@Controller()
export class PotentialCustomersMsEventsController {
  constructor(private readonly potentialCustomersMsEventsService: PotentialCustomersMsEventsService) {}

  @EventPattern('potential_customers.ms_ws')
  @MessagePattern('potential_customers.ms_ws')
  async handlePotentialCustomersMsEvent(
    @Payload() payload: unknown,
  ): Promise<{ success: boolean; message?: string }> {
    return this.potentialCustomersMsEventsService.executeHandleEnvelope(payload);
  }
}
