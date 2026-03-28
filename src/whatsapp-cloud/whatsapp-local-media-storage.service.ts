import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SaveMediaResult } from './types/save-media-result.type';
import { normalizeWaId } from './utils/normalize-wa-id.util';

const DEFAULT_UPLOAD_DIR = 'uploads/whatsapp-media';

/**
 * Writes inbound media bytes under a configurable base directory.
 */
@Injectable()
export class WhatsappLocalMediaStorageService {
  private readonly logger = new Logger(WhatsappLocalMediaStorageService.name);

  public constructor(private readonly configService: ConfigService) {}

  private getBaseDir(): string {
    return this.configService.get<string>('WHATSAPP_MEDIA_UPLOAD_DIR', DEFAULT_UPLOAD_DIR);
  }

  private extensionFromMime(mimeType: string | undefined): string {
    if (mimeType == null || mimeType.length === 0) {
      return 'bin';
    }
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    };
    return map[mimeType] ?? mimeType.split('/').pop()?.replace(/[^a-z0-9]/gi, '') ?? 'bin';
  }

  private sanitizeSegment(segment: string): string {
    return segment.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  }

  /**
   * Persists a buffer and returns a path relative to the upload base directory.
   */
  public async saveInboundMedia(input: {
    waId: string;
    whatsappMessageId: string;
    buffer: Buffer;
    mimeType?: string;
    originalFilename?: string;
  }): Promise<SaveMediaResult> {
    const baseDir = path.resolve(this.getBaseDir());
    const waSegment = this.sanitizeSegment(normalizeWaId(input.waId) || 'unknown');
    const msgSegment = this.sanitizeSegment(input.whatsappMessageId);
    const ext =
      input.originalFilename != null && input.originalFilename.includes('.')
        ? path.extname(input.originalFilename).replace(/^\./, '').slice(0, 10) || this.extensionFromMime(input.mimeType)
        : this.extensionFromMime(input.mimeType);
    const fileName = `${msgSegment}.${ext}`;
    const dir = path.join(baseDir, waSegment, msgSegment);
    await fs.mkdir(dir, { recursive: true });
    const absolutePath = path.join(dir, fileName);
    await fs.writeFile(absolutePath, input.buffer);
    const relativePath = path.relative(baseDir, absolutePath).split(path.sep).join('/');
    this.logger.log(`Saved inbound media to ${relativePath}`);
    return { relativePath, byteSize: input.buffer.length };
  }

  /**
   * Resolves a stored relative path to an absolute path; returns null if outside base.
   */
  public resolveSafeAbsolutePath(relativePath: string): string | null {
    const baseDir = path.resolve(this.getBaseDir());
    const resolved = path.resolve(baseDir, relativePath);
    if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
      return null;
    }
    return resolved;
  }
}
