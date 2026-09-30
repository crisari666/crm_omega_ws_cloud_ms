import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mammoth = require('mammoth') as {
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};

const MAX_CV_TEXT_CHARS = 20000;
const PDF_MIME_TYPE = 'application/pdf';
const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Extracts plain text from CV files (PDF / DOCX) stored on local disk.
 */
@Injectable()
export class CvTextExtractorService {
  private readonly logger = new Logger(CvTextExtractorService.name);

  /**
   * Returns true when the file type can be parsed as a CV.
   */
  public isSupportedCvFile(input: { mimeType: string; filename: string }): boolean {
    return this.resolveKind(input) != null;
  }

  /**
   * Returns normalized text (capped), or an empty string when extraction fails.
   */
  public async extractText(input: {
    absolutePath: string;
    mimeType: string;
    filename?: string;
  }): Promise<string> {
    const kind = this.resolveKind({
      mimeType: input.mimeType,
      filename: input.filename ?? input.absolutePath,
    });
    if (kind == null) {
      return '';
    }
    try {
      const buffer = await readFile(input.absolutePath);
      const raw =
        kind === 'pdf'
          ? await this.extractPdfText(buffer)
          : (await mammoth.extractRawText({ buffer })).value;
      return this.normalizeText(raw);
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

  private resolveKind(input: { mimeType: string; filename: string }): 'pdf' | 'docx' | null {
    const mimeType = (input.mimeType ?? '').toLowerCase();
    const extension = path.extname(input.filename ?? '').toLowerCase();
    if (mimeType === PDF_MIME_TYPE || extension === '.pdf') return 'pdf';
    if (mimeType === DOCX_MIME_TYPE || extension === '.docx') return 'docx';
    return null;
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
