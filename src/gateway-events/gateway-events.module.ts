import { Module } from '@nestjs/common';
import { GatewayEventsController } from './gateway-events.controller';

@Module({
  controllers: [GatewayEventsController],
})
export class GatewayEventsModule {}
