import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { WhatsappChat } from './whatsapp-chat.schema';

export type WhatsappMessageDocument = HydratedDocument<WhatsappMessage>;

/**
 * Embedded media metadata for a stored WhatsApp message.
 */
@Schema({ _id: false })
export class WhatsappMessageMedia {
  @Prop()
  whatsappMediaId?: string;

  @Prop()
  mimeType?: string;

  @Prop()
  filename?: string;

  @Prop()
  storedRelativePath?: string;

  @Prop()
  byteSize?: number;
}

const WhatsappMessageMediaSchema = SchemaFactory.createForClass(WhatsappMessageMedia);

/**
 * Single WhatsApp message line (inbound or outbound).
 */
@Schema({ collection: 'whatsapp_messages', timestamps: true })
export class WhatsappMessage {
  @Prop({ type: Types.ObjectId, ref: WhatsappChat.name, required: true })
  chat!: Types.ObjectId;

  @Prop({ required: true, enum: ['inbound', 'outbound'] })
  direction!: 'inbound' | 'outbound';

  @Prop({ required: true, unique: true })
  whatsappMessageId!: string;

  @Prop({ required: true })
  type!: string;

  @Prop({ type: Date, required: true })
  timestamp!: Date;

  @Prop()
  textBody?: string;

  @Prop()
  caption?: string;

  @Prop({ type: WhatsappMessageMediaSchema })
  media?: WhatsappMessageMedia;

  @Prop()
  contextMessageId?: string;

  @Prop({ type: Object })
  interactiveSnapshot?: Record<string, unknown>;

  @Prop({ type: Object })
  rawPayload?: Record<string, unknown>;
}

export const WhatsappMessageSchema = SchemaFactory.createForClass(WhatsappMessage);
WhatsappMessageSchema.index({ chat: 1, timestamp: -1 });
WhatsappMessageSchema.index({ chat: 1, _id: -1 });
