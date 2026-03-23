import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for sending the WhatsApp Cloud `call_notification` template.
 */
export class SendTemplateCallNotificationDto {
  @IsString()
  @IsNotEmpty()
  to: string;

  @IsString()
  @IsNotEmpty()
  contactName: string;
}
