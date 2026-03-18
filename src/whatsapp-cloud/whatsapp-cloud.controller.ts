import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Inject,
} from '@nestjs/common';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { SendTextDto } from './dto/send-text.dto';
import { SendInitialVideoDto } from './dto/send-initial-video.dto';
import { SendHelloWorldTemplateDto } from './dto/send-hellow-world-template.dto';
import { SendTemplateProposalDto } from './dto/send-template-proposal.dto';
import { SendTemplateGreetingDto } from './dto/send-template-greeting.dto';
import { SendTemplateVideoDto } from './dto/send-template-video.dto';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';

@Controller('whatsapp-cloud')
export class WhatsappCloudController {
  public constructor(
    private readonly whatsappCloudService: WhatsappCloudService,
    @Inject('CRM_BACK_QUEUE') private readonly crmBackQueueClient: ClientProxy,
  ) {}

  /**
   * Simple endpoint to send a text message via WhatsApp Cloud API
   */
  @Post('messages/text')
  @HttpCode(HttpStatus.OK)
  async sendText(@Body() dto: SendTextDto) {
    const { to, body } = dto;
    return this.whatsappCloudService.sendTextMessage(to, body);
  }

  /**
   * Endpoint to send the \"initial_video\" template message
   */
  @Post('messages/template/initial-video')
  @HttpCode(HttpStatus.OK)
  async sendInitialVideo(@Body() dto: SendInitialVideoDto) {
    const { to, name } = dto;
    return this.whatsappCloudService.sendInitialVideoTemplate(name, to);
  }

  @Post('messages/template/hello-world')
  @HttpCode(HttpStatus.OK)
  async sendHelloWorld(@Body() dto: SendHelloWorldTemplateDto) {
    const { to } = dto;
    return this.whatsappCloudService.sendHelloWorldTemplate(to);
  }

  @Get('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(req: Request, @Query() query: any) {
    console.log({ query });
    return query['hub.challenge']
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhookPost(@Body() dto: unknown): Promise<HttpStatus> {
    // console.log('webhookPost', JSON.stringify(dto, null, 2));
    const payload = dto as Record<string, unknown>;
    const entry = payload.entry as Array<Record<string, unknown>> | undefined;
    const firstEntry = entry?.[0];
    const changes = firstEntry?.changes as Array<Record<string, unknown>> | undefined;
    const firstChange = changes?.[0];
    const value = firstChange?.value as Record<string, unknown> | undefined;
    if (!value) return HttpStatus.OK;

    // Button click webhook (interactive message)
    const messagesValue = value.messages as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(messagesValue)) {
      for (const message of messagesValue) {
        const messageType = message.type;
        console.log({messageType, });
        if(messageType === 'button') {
          // console.log('button message', {message});
          const context = message.context as Record<string, unknown> | undefined;
          const videoMessageId = context?.id;
          if (!videoMessageId) continue;
  
          const button = message.button as Record<string, unknown> | undefined;
          const buttonPayload = button?.payload;
          const buttonPayloadString = typeof buttonPayload === 'string' ? buttonPayload : null;
  
          const contacts = value.contacts as Array<Record<string, unknown>> | undefined;
          const waIdValue = contacts?.[0]?.wa_id;
          const waId = typeof waIdValue === 'string' ? waIdValue : '';

          console.log( {waId});
  
          await lastValueFrom(
            this.crmBackQueueClient.emit('ws_ms_event', {
              type: 'ws_ms_events',
              payload: {
                action: 'user.clicked_call_button',
                videoMessageId,
                buttonPayload: buttonPayloadString,
                fromWaId: waId,
              },
            }),
          );
        }
      }

    }

    // Status webhooks (sent/delivered)
    const statusesValue = value.statuses as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(statusesValue)) {
      for (const status of statusesValue) {
        const statusValue = status.status;
        if (statusValue !== 'delivered') continue;

        const messageIdValue = status.id;
        const messageId = typeof messageIdValue === 'string' ? messageIdValue : '';
        if (!messageId) continue;

        await lastValueFrom(
          this.crmBackQueueClient.emit('ws_ms_event', {
            type: 'ws_ms_events',
            payload: {
              action: 'whatsapp.message_delivered',
              messageId,
            },
          }),
        );
      }
    }

    return HttpStatus.OK;
  }

  @Post('messages/template/proposal')
  @HttpCode(HttpStatus.OK)
  async sendTemplateProposal(@Body() dto: SendTemplateProposalDto) {
    const { code, name, to } = dto;
    return this.whatsappCloudService.sendTemplateProposalMessage({code, name, to});
  }

  @Post('messages/template/greeting')
  @HttpCode(HttpStatus.OK)
  async sendTemplateGreeting(@Body() dto: SendTemplateGreetingDto) {
    const { name, to } = dto;
    return this.whatsappCloudService.sendTemplateGreetingMessage(to, name);
  }

  @Post('messages/template/video')
  @HttpCode(HttpStatus.OK)
  async sendTemplateVideo(@Body() dto: SendTemplateVideoDto) {
    const { videoUrl, to } = dto;
    return this.whatsappCloudService.sendTemplateVideoMessage(to, videoUrl);
  }
}
