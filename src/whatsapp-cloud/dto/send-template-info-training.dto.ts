import { IsNotEmpty, IsString } from 'class-validator';

export class SendTemplateInfoTrainingDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;
  
  @IsString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsNotEmpty()
  to: string;
}

