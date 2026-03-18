import { IsNotEmpty, IsString } from 'class-validator';

export class SendTemplateGreetingDto {

  @IsString()
  @IsNotEmpty()
  name: string;


  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsString()
  @IsNotEmpty()
  to: string;
}

