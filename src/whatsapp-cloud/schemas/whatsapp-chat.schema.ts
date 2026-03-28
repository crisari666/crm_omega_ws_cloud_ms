import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WhatsappChatDocument = HydratedDocument<WhatsappChat>;

/**
 * Conversation header for one WhatsApp user and business phone number pair.
 */
@Schema({ collection: 'whatsapp_chats', timestamps: true })
export class WhatsappChat {
  @Prop({ required: true })
  waId!: string;

  @Prop({ required: true })
  phoneNumberId!: string;

  @Prop()
  displayPhoneNumber?: string;

  @Prop()
  profileName?: string;

  @Prop({ type: Date })
  lastMessageAt?: Date;
}

export const WhatsappChatSchema = SchemaFactory.createForClass(WhatsappChat);
WhatsappChatSchema.index({ waId: 1, phoneNumberId: 1 }, { unique: true });
WhatsappChatSchema.index({ lastMessageAt: -1 });
