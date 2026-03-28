import { IsString, MinLength, ValidateIf } from 'class-validator';

export class SendStickerMessageDto {
  @ValidateIf((o: SendStickerMessageDto) => o.link == null || o.link.length === 0)
  @IsString()
  @MinLength(1)
  id?: string;

  @ValidateIf((o: SendStickerMessageDto) => o.id == null || o.id.length === 0)
  @IsString()
  @MinLength(1)
  link?: string;
}
