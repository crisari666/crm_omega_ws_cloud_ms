import { IsNotEmpty, IsString } from 'class-validator';

export class SendInitialVideoDto {
  @IsString()
  @IsNotEmpty()
  to: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}
