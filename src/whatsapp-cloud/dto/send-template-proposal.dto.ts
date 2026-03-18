import { IsNotEmpty, IsString } from 'class-validator';

export class SendTemplateProposalDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  to: string;
}

