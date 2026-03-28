import { IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class SendImageMessageDto {
  @ValidateIf((o: SendImageMessageDto) => o.link == null || o.link.length === 0)
  @IsString()
  @MinLength(1)
  id?: string;

  @ValidateIf((o: SendImageMessageDto) => o.id == null || o.id.length === 0)
  @IsString()
  @MinLength(1)
  link?: string;

  @IsOptional()
  @IsString()
  caption?: string;
}
