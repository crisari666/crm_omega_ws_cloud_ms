import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { WhatsappCloudService } from './whatsapp-cloud.service';

class SendTextDto {
  to: string;
  body: string;
}

class SendInitialVideoDto {
  to: string;
  name: string;
}

@Controller('whatsapp-cloud')
export class WhatsappCloudController {
  constructor(private readonly whatsappCloudService: WhatsappCloudService) {}

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

  @Get('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(req: Request, @Query() query: any) {
    console.log({ query });
    return query['hub.challenge']
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhookPost(@Body() dto: any) {
    console.log({ dto: JSON.stringify(dto, null, 2) });
    return HttpStatus.OK;
  }
}
