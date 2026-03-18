import { IsNotEmpty, IsString } from 'class-validator';

export class SendHelloWorldTemplateDto {
  @IsString()
  @IsNotEmpty()
  to: string;
}
