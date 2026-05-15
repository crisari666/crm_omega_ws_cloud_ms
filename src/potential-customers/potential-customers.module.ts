import { Module } from '@nestjs/common';
import { WhatsappCloudModule } from '../whatsapp-cloud/whatsapp-cloud.module';
import { PotentialCustomersMsEventsController } from './potential-customers-ms-events.controller';
import { PotentialCustomersMsEventsService } from './potential-customers-ms-events.service';

@Module({
  imports: [WhatsappCloudModule],
  controllers: [PotentialCustomersMsEventsController],
  providers: [PotentialCustomersMsEventsService],
})
export class PotentialCustomersModule {}
