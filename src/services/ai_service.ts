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
    sourceFile?: TFile;
}

export interface OpenAIChoice {
    message?: {
        content: string;
    };
    text?: string;
    finish_reason: string;
    logprobs: {
        tokens: string[];
        token_logprobs: number[];
        top_logprobs: Record<string, number>[];
    } | null;
}

export interface OpenAIResponse {
    choices: OpenAIChoice[];
    model: string;
    object: string;
    created: number;
}

export class AIService {
    private app: App;
    private settingsService: SettingsService;
    private apiKey: string;
    private readonly BASE_URL = 'https://api.openai.com/v1';
    private readonly MAX_CONTEXT_LENGTH = 2048;
    private readonly MIN_TOKENS = 50;
    private readonly DEFAULT_TEMPERATURE = 0.7;
    private readonly SYSTEM_PROMPT = `You are an intelligent assistant in Obsidian, with access to the user's notes.
Your primary functions are:
1. Understanding user queries and finding relevant notes
2. Providing information and summaries from notes
3. Maintaining context across conversations
4. Helping users find and understand their notes

When responding:
- Be concise but informative
- If you reference a note, mention its title
- If you're unsure about something, say so
- If you need more context, ask for it`;

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
     * Analyzes the query to determine if it references a specific note
     * Uses LLM to understand the user's intent and find relevant notes
     */
    private async detectReferencedNote(query: string): Promise<TFile | null> {
        const files = this.app.vault.getMarkdownFiles();
        
        try {
            // First, use LLM to understand what the user is looking for
            const intentResponse = await this.makeAIRequest({
                prompt: `Given this user request: "${query}"
Please analyze if the user is asking about a specific note or document.
If yes, extract key details about what note they're looking for.
If no, explain why not.
Format your response as JSON:
{
    "isRequestingNote": boolean,
    "noteDescription": string or null,
    "confidence": number (0-1),
    "reasoning": string
}`,
                maxTokens: 200,
                temperature: 0.3
            });

            const intent = JSON.parse(intentResponse.choices[0]?.message?.content || '{}');
            
            if (!intent.isRequestingNote || intent.confidence < 0.6) {
                return null;
            }

            // If user is looking for a note, get the most relevant files
            const relevantFiles: Array<{file: TFile; relevance: number}> = [];
            
            for (const file of files) {
                try {
                    const content = await this.app.vault.cachedRead(file);
                    
                    // Use LLM to evaluate file relevance
                    const relevanceResponse = await this.makeAIRequest({
                        prompt: `Given this user's request: "${intent.noteDescription}"
And this note titled "${file.basename}":
---
${content.slice(0, 500)}... (truncated)
---
Rate how relevant this note is to the user's request.
Format response as JSON: { "relevance": number (0-1), "reasoning": string }`,
                        maxTokens: 100,
                        temperature: 0.2
                    });

                    const relevance = JSON.parse(relevanceResponse.choices[0]?.message?.content || '{}');
                    
                    if (relevance.relevance > 0.7) {
                        relevantFiles.push({
                            file,
                            relevance: relevance.relevance
                        });
                    }
                } catch (error) {
                    console.warn(`Failed to analyze file ${file.path}:`, error);
                }
            }

            // Sort by relevance and return the most relevant file
            if (relevantFiles.length > 0) {
                relevantFiles.sort((a, b) => b.relevance - a.relevance);
                return relevantFiles[0].file;
            }
        } catch (error) {
            console.error('Error in semantic note detection:', error);
        }
        
        return null;
    }

    /**
     * Get context from a specific file, optimized for performance
     */
    private async getFileContext(file: TFile): Promise<DocumentContext> {
        // Use Obsidian's cache API for better performance
        const fileCache = this.app.metadataCache.getFileCache(file);
        
        let headings: string[] = [];
        let paragraphs: string[] = [];
        
        if (fileCache) {
            // Extract headings from cache
            headings = (fileCache.headings || []).map(h => h.heading);
            
            // Get sections from cache
            if (fileCache.sections) {
                // Only get the first few paragraphs for context
                const relevantSections = fileCache.sections.slice(0, 3);
                
                // Read only the needed portions of the file
                const content = await this.app.vault.cachedRead(file);
                paragraphs = relevantSections.map(section => 
                    content.slice(section.position.start.offset, section.position.end.offset).trim()
                );
            }
        }
        
        return {
            previousParagraphs: paragraphs,
            documentStructure: {
                title: file.basename,
                headings: headings
            },
            sourceFile: file
        };
    }

    /**
     * Get real-time completion suggestions with improved context handling
     */
    async getCompletionSuggestions(
        currentText: string,
        context?: DocumentContext,
        conversationHistory?: string
    ): Promise<AICompletionResponse[]> {
        if (!this.apiKey) return [];

        try {
            // Try to detect if query references a different note
            const referencedFile = await this.detectReferencedNote(currentText);
            
            // If query references different note, get that note's context
            if (referencedFile) {
                try {
                    context = await this.getFileContext(referencedFile);
                } catch (error) {
                    console.warn('Failed to get context from referenced file:', error);
                }
            }
            
            // Create a more natural prompt that includes all context
            const prompt = this.createNaturalPrompt(currentText, context, conversationHistory);
            
            const settings = this.settingsService.getSettings();
            const maxTokens = this.calculateMaxTokens(prompt, currentText);
            const temperature = this.calculateTemperature(context);

            const response = await this.makeAIRequest({
                prompt,
                maxTokens,
                temperature,
                model: settings.aiModel
            });

            return this.parseCompletionResponse(response);
        } catch (error) {
            console.error('Error getting completion suggestions:', error);
            throw new Error(`Failed to get completion suggestions: ${error.message}`);
        }
    }

    /**
     * Creates a natural language prompt that includes all relevant context
     */
    private createNaturalPrompt(
        currentText: string,
        context?: DocumentContext,
        conversationHistory?: string
    ): string {
        const parts: string[] = [];

        // Add conversation history if available
        if (conversationHistory) {
            parts.push(`Previous conversation:\n${conversationHistory}`);
        }

        // Add document context if available
        if (context) {
            if (context.documentStructure?.title) {
                parts.push(`You are looking at a note titled "${context.documentStructure.title}"`);
            }
            
            if (context.previousParagraphs?.length > 0) {
                parts.push("Here's the relevant content from the note:\n" + context.previousParagraphs.join('\n'));
            }
            
            if (context.documentStructure?.headings?.length > 0) {
                parts.push("The note contains these sections:\n" + context.documentStructure.headings.join('\n'));
            }
        }

        // Add the current request
        parts.push(`The user asks: ${currentText}`);

        // Add instruction based on the type of request
        if (currentText.toLowerCase().includes('summarize') || currentText.toLowerCase().includes('summary')) {
            parts.push('Please provide a clear and concise summary of the relevant content.');
        } else {
            parts.push('Please provide a helpful response based on the available context.');
        }

        return parts.join('\n\n');
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
    private async makeAIRequest(request: AICompletionRequest): Promise<OpenAIResponse> {
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
    private parseCompletionResponse(response: OpenAIResponse): AICompletionResponse[] {
        if (!response.choices || !response.choices.length) {
            return [];
        }

        return response.choices.map((choice: OpenAIChoice) => {
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
        logprobs: OpenAIChoice['logprobs'],
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
     */
    private calculateTemperature(context?: DocumentContext): number {
        let temperature = this.DEFAULT_TEMPERATURE;

        if (!context) return temperature;

        // Reduce temperature if we have specific context
        if (context.currentHeading) {
            temperature -= 0.1;
        }
        if (context.documentStructure?.title) {
            temperature -= 0.1;
        }
        if (context.previousParagraphs?.length > 0) {
            temperature -= 0.1;
        }

        // Ensure temperature stays within reasonable bounds
        return Math.min(Math.max(temperature, 0.1), 0.9);
    }

    /**
     * Parse the API response for content generation
     */
    private parseContentResponse(response: OpenAIResponse): string {
        return response.choices[0]?.message?.content || '';
    }

    /**
     * Parse the API response for formatting suggestions
     */
    private parseFormattingSuggestions(response: OpenAIResponse): string[] {
        return response.choices[0]?.message?.content?.split('\n').filter(Boolean) || [
            'Consider using a level-2 heading here',
            'Add a code block for this snippet'
        ];
    }

    /**
     * Format document context for AI prompts
     */
    private formatContext(context?: DocumentContext): string {
        if (!context) return '';
        
        const parts: string[] = [];
        
        if (context.documentStructure?.title) {
            parts.push(`Title: ${context.documentStructure.title}`);
        }
        
        if (context.currentHeading) {
            parts.push(`Current section: ${context.currentHeading}`);
        }
        
        if (context.previousParagraphs?.length > 0) {
            parts.push('Previous context:\n' + context.previousParagraphs.join('\n'));
        }
        
        return parts.join('\n\n');
    }

    /**
     * Calculate string similarity using Levenshtein distance
     */
    private calculateStringSimilarity(str1: string, str2: string): number {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        return (longer.length - this.levenshteinDistance(longer, shorter)) / longer.length;
    }

    private levenshteinDistance(str1: string, str2: string): number {
        const matrix: number[][] = [];
        
        for (let i = 0; i <= str1.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str2.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str1.length; i++) {
            for (let j = 1; j <= str2.length; j++) {
                if (str1[i-1] === str2[j-1]) {
                    matrix[i][j] = matrix[i-1][j-1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i-1][j-1] + 1,
                        matrix[i][j-1] + 1,
                        matrix[i-1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str1.length][str2.length];
    }

    private extractParagraphs(lines: string[]): string[] {
        const paragraphs: string[] = [];
        let currentParagraph: string[] = [];
        
        for (const line of lines) {
            if (line.trim() === '') {
                if (currentParagraph.length > 0) {
                    paragraphs.push(currentParagraph.join(' '));
                    currentParagraph = [];
                }
            } else {
                currentParagraph.push(line.trim());
            }
        }
        
        if (currentParagraph.length > 0) {
            paragraphs.push(currentParagraph.join(' '));
        }
        
        return paragraphs;
    }

    private extractHeadings(lines: string[]): string[] {
        return lines
            .filter(line => line.trim().startsWith('#'))
            .map(line => line.trim().replace(/^#+\s*/, ''));
    }

    /**
     * Process a user message and generate a response
     */
    async processMessage(
        message: string,
        conversationHistory?: string
    ): Promise<AICompletionResponse[]> {
        if (!this.apiKey) return [];

        try {
            // First, analyze the message internally
            const internalAnalysis = await this.makeAIRequest({
                prompt: `${this.SYSTEM_PROMPT}

Previous conversation:
${conversationHistory || 'No previous conversation'}

Analyze this message and determine if it requires specific note access.
Message: ${message}

Return JSON only:
{
    "requiresNoteAccess": boolean,
    "noteType": string | null,
    "confidence": number,
    "action": string | null
}`,
                maxTokens: 200,
                temperature: 0.3
            });

            // Parse internal analysis
            const analysis = JSON.parse(internalAnalysis.choices[0]?.message?.content || '{}');

            // If we need to access specific notes
            if (analysis.requiresNoteAccess && analysis.confidence > 0.7) {
                const relevantNotes = await this.findRelevantNotes(message);
                
                if (relevantNotes.length > 0) {
                    // Generate user-facing response based on the notes
                    const userResponse = await this.makeAIRequest({
                        prompt: `Generate a helpful response based on these notes:
                        ${relevantNotes.map(note => this.formatNotePreview(note)).join('\n')}
                        
                        User message: ${message}
                        
                        Provide a natural, direct response that answers the user's question 
                        or fulfills their request without mentioning the internal note analysis.`,
                        maxTokens: 500,
                        temperature: 0.7
                    });

                    return this.parseCompletionResponse(userResponse);
                }
            }

            // For general responses
            const generalResponse = await this.makeAIRequest({
                prompt: `${this.SYSTEM_PROMPT}

Previous conversation:
${conversationHistory || 'No previous conversation'}

User message: ${message}

Provide a helpful, natural response that directly addresses the user's message.`,
                maxTokens: 500,
                temperature: 0.7
            });

            return this.parseCompletionResponse(generalResponse);
        } catch (error) {
            console.error('Error processing message:', error);
            return [{
                text: "I encountered an error while processing your request. Please try again.",
                confidence: 0.5
            }];
        }
    }

    private formatNotePreview(note: { content: string; file: TFile }): string {
        return `Title: ${note.file.basename}
Content preview: ${note.content.slice(0, 500)}...`;
    }

    /**
     * Find notes relevant to the user's query
     */
    private async findRelevantNotes(query: string): Promise<Array<{ content: string; file: TFile }>> {
        const files = this.app.vault.getMarkdownFiles();
        const relevantNotes: Array<{ content: string; file: TFile }> = [];

        // Use metadata cache for quick filtering
        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (!cache) continue;

            // Check title and headings first (fast check)
            const title = file.basename.toLowerCase();
            const headings = cache.headings?.map(h => h.heading.toLowerCase()) || [];
            const queryTerms = query.toLowerCase().split(/\s+/);

            if (queryTerms.some(term => 
                title.includes(term) || 
                headings.some(h => h.includes(term))
            )) {
                try {
                    const content = await this.app.vault.cachedRead(file);
                    relevantNotes.push({ content, file });
                } catch (error) {
                    console.warn(`Failed to read file ${file.path}:`, error);
                }
                continue;
            }

            // If we haven't found enough notes, check content
            if (relevantNotes.length < 3) {
                try {
                    const content = await this.app.vault.cachedRead(file);
                    if (queryTerms.some(term => content.toLowerCase().includes(term))) {
                        relevantNotes.push({ content, file });
                    }
                } catch (error) {
                    console.warn(`Failed to read file ${file.path}:`, error);
                }
            }
        }

        return relevantNotes;
    }
} 