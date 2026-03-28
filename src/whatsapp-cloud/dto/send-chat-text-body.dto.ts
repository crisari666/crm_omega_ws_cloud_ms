import { IsString, MinLength } from 'class-validator';

export class SendChatTextBodyDto {
  @IsString()
  @MinLength(1)
  body!: string;
}
