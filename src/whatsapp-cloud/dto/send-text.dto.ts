import { IsNotEmpty, IsString } from 'class-validator';

export class SendTextDto {
  @IsString()
  @IsNotEmpty()
  to: string;

  @IsString()
  @IsNotEmpty()
  body: string;
}
