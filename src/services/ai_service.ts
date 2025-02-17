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
     */
    async getCompletionSuggestions(
        currentText: string,
        context: DocumentContext
    ): Promise<AICompletionResponse[]> {
        if (!this.apiKey) return [];

        try {
            const settings = this.settingsService.getSettings();
            const response = await this.makeAIRequest({
                prompt: currentText,
                context: this.formatContext(context),
                maxTokens: 50,
                temperature: settings.aiTemperature,
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
     */
    private async makeAIRequest(request: AICompletionRequest): Promise<any> {
        // TODO: Implement actual API call
        // This is a placeholder that simulates an API response
        return {
            choices: [{
                text: request.prompt.length > 20 
                    ? request.prompt.substring(0, 20) + '...'
                    : request.prompt,
                confidence: 0.9
            }]
        };
    }

    /**
     * Parse the API response for completion suggestions
     */
    private parseCompletionResponse(response: any): AICompletionResponse[] {
        // TODO: Implement actual response parsing
        return response.choices.map((choice: any) => ({
            text: choice.text,
            confidence: choice.confidence
        }));
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