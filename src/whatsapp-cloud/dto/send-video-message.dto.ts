import { IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class SendVideoMessageDto {
  @ValidateIf((o: SendVideoMessageDto) => o.link == null || o.link.length === 0)
  @IsString()
  @MinLength(1)
  id?: string;

  @ValidateIf((o: SendVideoMessageDto) => o.id == null || o.id.length === 0)
  @IsString()
  @MinLength(1)
  link?: string;

  @IsOptional()
  @IsString()
  caption?: string;
}
