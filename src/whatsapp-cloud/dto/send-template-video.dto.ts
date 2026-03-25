import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for sending the WhatsApp Cloud `video_msj` template (header uses uploaded media id).
 */
export class SendTemplateVideoDto {
  @IsString()
  @IsNotEmpty()
  videoId: string;

  @IsString()
  @IsNotEmpty()
  to: string;
}
