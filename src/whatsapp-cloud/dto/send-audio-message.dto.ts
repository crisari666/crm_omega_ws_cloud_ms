import { IsBoolean, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class SendAudioMessageDto {
  @ValidateIf((o: SendAudioMessageDto) => o.link == null || o.link.length === 0)
  @IsString()
  @MinLength(1)
  id?: string;

  @ValidateIf((o: SendAudioMessageDto) => o.id == null || o.id.length === 0)
  @IsString()
  @MinLength(1)
  link?: string;

  @IsOptional()
  @IsBoolean()
  voice?: boolean;
}
