/**
 * AIService provides AI-powered functionality for the auto-completion plugin.
 * Handles API communication, context processing, and response parsing.
 */

import { App, Editor, TFile } from 'obsidian';
import { SettingsService } from './settings_service';

export interface AICompletionRequest {
    prompt: string;
    context?: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
}

export interface AICompletionResponse {
    text: string;
    confidence: number;
}

export interface DocumentContext {
    previousParagraphs: string[];
    currentHeading?: string;
    documentStructure: {
        title?: string;
        headings: string[];
    };
}

export class AIService {
    private app: App;
    private settingsService: SettingsService;
    private apiKey: string;
    private readonly BASE_URL = 'https://api.openai.com/v1';
    private readonly MAX_CONTEXT_LENGTH = 2048;
    private readonly MIN_TOKENS = 50;
    private readonly DEFAULT_TEMPERATURE = 0.7;

    constructor(app: App, settingsService: SettingsService) {
        this.app = app;
        this.settingsService = settingsService;
    }

    /**
     * Initialize the AI service with API key and settings
     */
    async initialize() {
        const settings = this.settingsService.getSettings();
        this.apiKey = settings.aiApiKey;
        if (!this.apiKey) {
            console.warn('AI Service: No API key provided');
        }
    }

    /**
     * Get real-time completion suggestions as user types
     * Implements dynamic token and temperature adjustment based on context
     */
    async getCompletionSuggestions(
        currentText: string,
        context: DocumentContext
    ): Promise<AICompletionResponse[]> {
        if (!this.apiKey) return [];

        try {
            const settings = this.settingsService.getSettings();
            const contextStr = this.formatContext(context);
            
            // Dynamically adjust tokens based on context length
            const maxTokens = this.calculateMaxTokens(contextStr, currentText);
            
            // Adjust temperature based on context specificity
            const temperature = this.calculateTemperature(context);

            const response = await this.makeAIRequest({
                prompt: currentText,
                context: contextStr,
                maxTokens,
                temperature,
                model: settings.aiModel
            });

            return this.parseCompletionResponse(response);
        } catch (error) {
            console.error('Error getting completion suggestions:', error);
            return [];
        }
    }

    /**
     * Generate content based on a user prompt
     */
    async generateContent(
        prompt: string,
        context: DocumentContext
    ): Promise<string> {
        if (!this.apiKey) {
            throw new Error('AI Service: API key not configured');
        }

        try {
            const settings = this.settingsService.getSettings();
            const response = await this.makeAIRequest({
                prompt,
                context: this.formatContext(context),
                maxTokens: settings.aiMaxTokens,
                temperature: settings.aiTemperature,
                model: settings.aiModel
            });

            return this.parseContentResponse(response);
        } catch (error) {
            console.error('Error generating content:', error);
            throw error;
        }
    }

    /**
     * Generate a summary of the current document
     */
    async generateSummary(file: TFile): Promise<string> {
        if (!this.apiKey) {
            throw new Error('AI Service: API key not configured');
        }

        try {
            const content = await this.app.vault.read(file);
            const response = await this.makeAIRequest({
                prompt: 'Generate a concise summary of the following text:\n\n' + content,
                maxTokens: 200,
                temperature: 0.3
            });

            return this.parseContentResponse(response);
        } catch (error) {
            console.error('Error generating summary:', error);
            throw error;
        }
    }

    /**
     * Check and suggest improvements for Markdown formatting
     */
    async checkMarkdownFormatting(
        text: string,
        editor: Editor
    ): Promise<string[]> {
        if (!this.apiKey) return [];

        try {
            const response = await this.makeAIRequest({
                prompt: 'Check and suggest improvements for the following Markdown:\n\n' + text,
                maxTokens: 100,
                temperature: 0.2
            });

            return this.parseFormattingSuggestions(response);
        } catch (error) {
            console.error('Error checking Markdown formatting:', error);
            return [];
        }
    }

    /**
     * Make an API request to the AI service
     * Implements proper API communication with error handling
     */
    private async makeAIRequest(request: AICompletionRequest): Promise<any> {
        const settings = this.settingsService.getSettings();
        const endpoint = `${this.BASE_URL}/chat/completions`;

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: request.model || settings.aiModel,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a helpful assistant providing context-aware suggestions.'
                        },
                        {
                            role: 'user',
                            content: request.context ? 
                                `Context:\n${request.context}\n\nInput: ${request.prompt}` :
                                request.prompt
                        }
                    ],
                    max_tokens: request.maxTokens || settings.aiMaxTokens,
                    temperature: request.temperature ?? settings.aiTemperature,
                    n: 5, // Number of suggestions to generate
                    stop: ['\n', '.', '?', '!'] // Stop sequences for completions
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`API Error: ${error.message || response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    /**
     * Parse the API response for completion suggestions
     * Implements proper response parsing with confidence scoring
     */
    private parseCompletionResponse(response: any): AICompletionResponse[] {
        if (!response.choices || !response.choices.length) {
            return [];
        }

        return response.choices.map((choice: any) => {
            const text = choice.message?.content || '';
            // Calculate confidence based on response metadata
            const confidence = this.calculateConfidence(
                choice.finish_reason,
                choice.logprobs,
                text
            );

            return {
                text: text.trim(),
                confidence
            };
        });
    }

    /**
     * Calculate confidence score for a suggestion
     * @private
     */
    private calculateConfidence(
        finishReason: string,
        logprobs: any,
        text: string
    ): number {
        let confidence = 0.5; // Base confidence

        // Adjust based on finish reason
        if (finishReason === 'stop') {
            confidence += 0.2;
        }

        // Adjust based on text length and quality
        if (text.length > 3) {
            confidence += 0.1;
        }
        if (text.match(/^[A-Z][a-z]/)) { // Proper capitalization
            confidence += 0.1;
        }

        // Ensure confidence is between 0 and 1
        return Math.min(Math.max(confidence, 0), 1);
    }

    /**
     * Calculate maximum tokens based on context length
     * @private
     */
    private calculateMaxTokens(context: string, currentText: string): number {
        const totalLength = (context?.length || 0) + currentText.length;
        const availableTokens = this.MAX_CONTEXT_LENGTH - Math.ceil(totalLength / 4);
        return Math.max(this.MIN_TOKENS, Math.min(availableTokens, 200));
    }

    /**
     * Calculate temperature based on context specificity
     * @private
     */
    private calculateTemperature(context: DocumentContext): number {
        let temperature = this.DEFAULT_TEMPERATURE;

        // Reduce temperature if we have specific context
        if (context.currentHeading) {
            temperature -= 0.1;
        }
        if (context.documentStructure.title) {
            temperature -= 0.1;
        }
        if (context.previousParagraphs.length > 0) {
            temperature -= 0.1;
        }

        // Ensure temperature stays within reasonable bounds
        return Math.min(Math.max(temperature, 0.1), 0.9);
    }

    /**
     * Parse the API response for content generation
     */
    private parseContentResponse(response: any): string {
        // TODO: Implement actual response parsing
        return response.choices[0].text;
    }

    /**
     * Parse the API response for formatting suggestions
     */
    private parseFormattingSuggestions(response: any): string[] {
        // TODO: Implement actual response parsing
        return [
            'Consider using a level-2 heading here',
            'Add a code block for this snippet'
        ];
    }

    /**
     * Format document context for AI prompts
     */
    private formatContext(context: DocumentContext): string {
        const parts: string[] = [];
        
        if (context.documentStructure.title) {
            parts.push(`Title: ${context.documentStructure.title}`);
        }
        
        if (context.currentHeading) {
            parts.push(`Current section: ${context.currentHeading}`);
        }
        
        if (context.previousParagraphs.length > 0) {
            parts.push('Previous context:\n' + context.previousParagraphs.join('\n'));
        }
        
        return parts.join('\n\n');
    }
} 