import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for sending the WhatsApp Cloud `video_msj` template.
 */
export class SendTemplateVideoDto {
  @IsString()
  @IsNotEmpty()
  videoUrl: string;

  @IsString()
  @IsNotEmpty()
  to: string;
}
