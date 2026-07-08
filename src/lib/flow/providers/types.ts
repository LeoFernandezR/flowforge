export interface GenerateStructuredArgs {
  prompt: string;
  input: string;
  jsonSchema: object;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generateStructured(args: GenerateStructuredArgs): Promise<unknown>;
}
