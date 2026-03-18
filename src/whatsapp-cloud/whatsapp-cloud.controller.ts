import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { SendTextDto } from './dto/send-text.dto';
import { SendInitialVideoDto } from './dto/send-initial-video.dto';
import { SendHelloWorldTemplateDto } from './dto/send-hellow-world-template.dto';
import { SendTemplateProposalDto } from './dto/send-template-proposal.dto';
import { SendTemplateGreetingDto } from './dto/send-template-greeting.dto';

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
  async webhookPost(@Body() dto: any) {
    console.log({ dto: JSON.stringify(dto, null, 2) });
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

  
}
