import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';

const MAX_CV_TEXT_CHARS = 20000;
const PDF_MIME_TYPE = 'application/pdf';
const PDF_EXTENSION = '.pdf';

/**
 * Extracts plain text from PDF CV files stored on local disk.
 */
@Injectable()
export class CvTextExtractorService {
  private readonly logger = new Logger(CvTextExtractorService.name);

  /**
   * Returns true when the file is a PDF (the only accepted CV format).
   */
  public isPdfFile(input: { mimeType: string; filename: string }): boolean {
    const mimeType = (input.mimeType ?? '').toLowerCase();
    const extension = path.extname(input.filename ?? '').toLowerCase();
    return mimeType === PDF_MIME_TYPE || extension === PDF_EXTENSION;
  }

  /**
   * Returns normalized text (capped), or an empty string when extraction fails.
   */
  public async extractText(input: {
    absolutePath: string;
    mimeType: string;
    filename?: string;
  }): Promise<string> {
    const isPdf = this.isPdfFile({
      mimeType: input.mimeType,
      filename: input.filename ?? input.absolutePath,
    });
    if (!isPdf) {
      return '';
    }
    try {
      const buffer = await readFile(input.absolutePath);
      return this.normalizeText(await this.extractPdfText(buffer));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`extractText failed for ${input.absolutePath}: ${message}`);
      return '';
    }
  }

  private async extractPdfText(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }

  private normalizeText(raw: string): string {
    return (raw ?? '')
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_CV_TEXT_CHARS);
  }
}
