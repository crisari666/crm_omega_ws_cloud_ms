/**
 * Shape used by {@link DeepSeekService.analyzeText} for structured JSON extraction.
 */
export interface ProjectConfigBody {
  name: string;
  description?: string;
  domain?: string;
  instructions?: string[];
  fields?: Record<string, string>;
  output_format?: unknown;
  example_analysis?: unknown[];
}

export interface ProjectResponse {
  config: ProjectConfigBody;
}
