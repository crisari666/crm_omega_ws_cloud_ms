import { IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class SendDocumentMessageDto {
  @ValidateIf((o: SendDocumentMessageDto) => o.link == null || o.link.length === 0)
  @IsString()
  @MinLength(1)
  id?: string;

  @ValidateIf((o: SendDocumentMessageDto) => o.id == null || o.id.length === 0)
  @IsString()
  @MinLength(1)
  link?: string;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsString()
  filename?: string;
}
