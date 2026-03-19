import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for sending the WhatsApp Cloud `video_msj` template.
 */
export class SendTemplateCallNotificationDto {
  @IsString()
  @IsNotEmpty()
  to: string;
}
