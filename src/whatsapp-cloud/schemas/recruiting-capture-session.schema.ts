import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type RecruitingCaptureSessionDocument = HydratedDocument<RecruitingCaptureSession>;

/**
 * Persisted state of a candidate's WhatsApp recruiting capture, so it survives service restarts.
 */
@Schema({ collection: 'recruitingcapturesessions', timestamps: true })
export class RecruitingCaptureSession {
  @Prop({ required: true })
  campaignId!: string;

  @Prop({ required: true, unique: true })
  candidateId!: string;

  @Prop({ required: true, index: true })
  phone!: string;

  @Prop({ default: '' })
  whatsappAgentPrompt!: string;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  captureFields!: Array<Record<string, unknown>>;

  @Prop({ type: Object, default: {} })
  stageMessages!: Record<string, string>;

  @Prop({ type: Object, default: {} })
  capturedData!: Record<string, string>;

  @Prop({ type: [MongooseSchema.Types.Mixed], default: [] })
  messages!: Array<Record<string, unknown>>;

  @Prop({ default: false })
  dataComplete!: boolean;

  @Prop({ default: false })
  interviewAccepted!: boolean;

  @Prop({ required: true })
  stage!: string;

  @Prop({ default: false })
  cvReceived!: boolean;

  @Prop({ default: false })
  cvRequested!: boolean;
}

export const RecruitingCaptureSessionSchema = SchemaFactory.createForClass(RecruitingCaptureSession);
