import * as fs from 'fs';
import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ProjectResponse } from './interfaces/project-config.interface';

type LotesChatConfigShape = {
  agent?: { think?: { prompt?: string } };
};

const DEFAULT_LOTE_CHAT_CONFIG_PATH = 'config_lotes_chat.json';

@Injectable()
export class DeepSeekService {
  private readonly logger = new Logger(DeepSeekService.name);
  private openaiClient: OpenAI | null = null;
  private cachedLotesSystemPrompt: string | null = null;

  public constructor(private readonly configService: ConfigService) {}

  /**
   * OpenAI-compatible client for DeepSeek (lazy; requires DEEPSEEK_API_KEY).
   */
  private getOpenai(): OpenAI {
    if (this.openaiClient != null) {
      return this.openaiClient;
    }
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (apiKey == null || apiKey.trim().length === 0) {
      throw new Error('DEEPSEEK_API_KEY is not configured');
    }
    this.openaiClient = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey: apiKey.trim(),
    });
    this.logger.log('DeepSeek OpenAI client initialized');
    return this.openaiClient;
  }

  /**
   * System prompt from `config_lotes_chat.json` (agent.think.prompt). Path override: LOTE_CHAT_CONFIG_PATH.
   */
  public getLotesChatSystemPrompt(): string {
    if (this.cachedLotesSystemPrompt != null) {
      return this.cachedLotesSystemPrompt;
    }
    const configuredPath =
      this.configService.get<string>('LOTE_CHAT_CONFIG_PATH') ?? DEFAULT_LOTE_CHAT_CONFIG_PATH;
    const resolvedPath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(process.cwd(), configuredPath);
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = JSON.parse(raw) as LotesChatConfigShape;
    const prompt = parsed.agent?.think?.prompt;
    if (prompt == null || prompt.trim().length === 0) {
      throw new Error(`Missing agent.think.prompt in ${resolvedPath}`);
    }
    this.cachedLotesSystemPrompt = prompt;
    return prompt;
  }

  /**
   * Single-turn reply for La Ceiba WhatsApp-style chat using DeepSeek.
   */
  public async replyLotesChat(input: {
    userMessage: string;
    contactName?: string;
    model?: string;
  }): Promise<string> {
    const system = this.getLotesChatSystemPrompt();
    const nameHint =
      input.contactName != null && input.contactName.trim().length > 0
        ? `\n\n(Contexto: el nombre del contacto es ${input.contactName.trim()}.)`
        : '';
    return this.chatCompletion({
      systemPrompt: system + nameHint,
      userMessage: input.userMessage.trim(),
      model: input.model ?? 'deepseek-chat',
    });
  }

  /**
   * Generic chat completion (system + user) via DeepSeek.
   */
  public async chatCompletion(input: {
    systemPrompt: string;
    userMessage: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string> {
    const client = this.getOpenai();
    const completion = await client.chat.completions.create({
      model: input.model ?? 'deepseek-chat',
      messages: [
        { role: 'system', content: input.systemPrompt },
        { role: 'user', content: input.userMessage },
      ],
      temperature: input.temperature ?? 0.7,
      max_tokens: input.maxTokens ?? 2000,
    });
    const text = completion.choices[0]?.message?.content?.trim() ?? '';
    if (text.length === 0) {
      this.logger.warn('DeepSeek returned empty assistant content');
    }
    return text;
  }

  /**
   * Build the prompt with project configuration and text to analyze.
   */
  private buildPrompt(projectConfig: ProjectResponse, text: string): string {
    const config = projectConfig.config;
    let prompt = `You are an AI agent configured for: ${config.name}\n\n`;
    if (config.description != null && config.description.length > 0) {
      prompt += `Description: ${config.description}\n\n`;
    }
    if (config.domain != null && config.domain.length > 0) {
      prompt += `Domain: ${config.domain}\n\n`;
    }
    if (config.instructions != null && config.instructions.length > 0) {
      prompt += `Instructions:\n${config.instructions.map((inst, idx) => `${idx + 1}. ${inst}`).join('\n')}\n\n`;
    }
    if (config.fields != null && Object.keys(config.fields).length > 0) {
      prompt += `Fields to analyze:\n${Object.entries(config.fields).map(([key, value]) => `- ${key}: ${value}`).join('\n')}\n\n`;
    }
    if (config.output_format != null) {
      prompt += `Output Format: ${JSON.stringify(config.output_format, null, 2)}\n\n`;
    }
    if (config.example_analysis != null && config.example_analysis.length > 0) {
      prompt += `Example Analysis:\n${JSON.stringify(config.example_analysis, null, 2)}\n\n`;
    }
    prompt += `\n---\n\nText to analyze:\n\n${text}\n\n---\n\nPlease analyze this text according to the configuration above. IMPORTANT: Return ONLY a valid JSON object matching the Output Format. Do not include any markdown formatting or explanation.`;
    return prompt;
  }

  /**
   * Analyze text using DeepSeek API (structured JSON output).
   */
  public async analyzeText(projectConfig: ProjectResponse, text: string): Promise<unknown> {
    try {
      this.logger.log('Starting text analysis with DeepSeek model');
      if (text == null || text.trim().length === 0) {
        this.logger.warn('Empty text provided for analysis');
        return { error: 'Text to analyze cannot be empty.' };
      }
      const prompt = this.buildPrompt(projectConfig, text);
      this.logger.debug(`Analysis prompt length: ${prompt.length}`);
      const client = this.getOpenai();
      const startTime = Date.now();
      const completion = await client.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant that analyzes text and returns structured JSON responses.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      });
      const elapsedTime = Date.now() - startTime;
      this.logger.log(`DeepSeek request completed in ${elapsedTime}ms`);
      const analysisResult = completion.choices[0]?.message?.content ?? '{}';
      this.logger.log(`Received response from DeepSeek (${analysisResult.length} characters)`);
      try {
        return JSON.parse(analysisResult) as unknown;
      } catch {
        const cleanResult = analysisResult.replace(/```json\n|\n```|```/g, '').trim();
        try {
          return JSON.parse(cleanResult) as unknown;
        } catch {
          return { raw: analysisResult, error: 'Failed to parse JSON' };
        }
      }
    } catch (error) {
      this.logger.error('Error analyzing text with DeepSeek:', error);
      throw error;
    }
  }
}
