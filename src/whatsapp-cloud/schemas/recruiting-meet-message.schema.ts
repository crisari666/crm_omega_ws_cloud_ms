import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RecruitingMeetMessageDocument = HydratedDocument<RecruitingMeetMessage>;

const RECRUITING_MEET_MESSAGE_TTL_SECONDS = 14 * 24 * 60 * 60;

/**
 * Maps a sent recruiting Meet template (wamid) to its candidate, so status webhooks
 * can be reported back to the CRM.
 */
@Schema({ collection: 'recruitingmeetmessages' })
export class RecruitingMeetMessage {
  @Prop({ required: true, unique: true })
  whatsappMessageId!: string;

  @Prop({ required: true })
  candidateId!: string;

  @Prop({ type: Date, default: () => new Date(), expires: RECRUITING_MEET_MESSAGE_TTL_SECONDS })
  createdAt!: Date;
}

export const RecruitingMeetMessageSchema = SchemaFactory.createForClass(RecruitingMeetMessage);
