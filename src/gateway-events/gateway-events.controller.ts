import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { WebhookForwardEnvelope } from './types/webhook-forward-envelope.type';

/**
 * Handles RabbitMQ events forwarded from omega_gateway.
 */
@Controller()
export class GatewayEventsController {
  private readonly logger = new Logger(GatewayEventsController.name);

  @EventPattern('whatsapp_customers_event')
  handleCustomersMessage(@Payload() envelope: WebhookForwardEnvelope): void {
    this.logger.log(
      `Customers message received: ${JSON.stringify(envelope, null, 2)}`,
    );
  }
}
