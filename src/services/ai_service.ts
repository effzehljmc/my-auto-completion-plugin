/**
 * AIService provides AI-powered functionality for the auto-completion plugin.
 * Handles API communication, context processing, and response parsing.
 */

import { App, Editor, TFile } from 'obsidian';
import { SettingsService } from './settings_service';
import { TOKEN_LIMITS, DEFAULT_MODEL, SYSTEM_PROMPTS } from '../constants';
import { AIRequestOptions, DocumentContext, IntentAnalysis } from '../types';

export interface AICompletionRequest {
    prompt: string;
    context?: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
    response_format?: { type: "json_object" | "text" };
}

export interface AICompletionResponse {
    text: string;
    confidence: number;
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

/**
 * Custom error class for AI service related errors
 */
export class AIServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly details?: any
    ) {
        super(message);
        this.name = 'AIServiceError';
    }
}

export class AIService {
    private app: App;
    private settingsService: SettingsService;
    private apiKey: string;
    private readonly BASE_URL = 'https://api.openai.com/v1';
    private readonly MAX_CONTEXT_LENGTH = 4096;
    private readonly MIN_TOKENS = 50;
    private readonly DEFAULT_TEMPERATURE = 0.7;
    private readonly SYSTEM_PROMPT = SYSTEM_PROMPTS.AI_SERVICE;

    /**
     * Monitoring interface for tracking AI service performance and errors
     */
    private monitoring = {
        jsonParsingStats: {
            totalAttempts: 0,
            successfulParses: 0,
            failedParses: 0,
            repairAttempts: 0,
            successfulRepairs: 0,
            commonErrors: new Map<string, number>()
        },
        responseStats: {
            totalResponses: 0,
            markdownResponses: 0,
            cleanResponses: 0,
            averageResponseTime: 0,
            totalResponseTime: 0
        },
        errorStats: new Map<string, number>()
    };

    constructor(app: App, settingsService: SettingsService) {
        this.app = app;
        this.settingsService = settingsService;
    }

    /**
     * Initialize the AI service with API key and settings
     */
    async initialize() {
        const settings = await this.settingsService.getSettings();
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

Return a JSON object with this structure:
{
    "isRequestingNote": boolean,
    "noteDescription": string or null,
    "confidence": number (0-1),
    "reasoning": string
}`,
                maxTokens: 200,
                temperature: 0.3,
                response_format: { type: "json_object" }
            });

            const intent = this.safeJSONParse<{
                isRequestingNote: boolean;
                noteDescription: string | null;
                confidence: number;
                reasoning: string;
            }>(intentResponse.choices[0]?.message?.content || '');
            
            if (!intent || !intent.isRequestingNote || intent.confidence < 0.6) {
                return null;
            }

            // If user is looking for a note, get the most relevant files
            const relevantFiles: Array<{file: TFile; relevance: number}> = [];
            
            for (const file of files) {
                try {
                    const content = await this.app.vault.cachedRead(file);
                    
                    // Use LLM to evaluate file relevance
                    const relevanceResponse = await this.makeAIRequest({
                        prompt: `Analyze if this content is likely to be meeting notes.
                        Consider factors like:
                        - Presence of meeting-related keywords (agenda, attendees, discussion)
                        - Document structure (headings for sections like "Action Items", "Decisions")
                        - Content format (date, time, participant list)
                        
                        Content: "${content.slice(0, 500)}..."
                        
                        Respond with JSON:
                        {
                            "isMeetingNotes": boolean,
                            "confidence": number (0-1),
                            "relevanceScore": number (0-1),
                            "reasoning": string
                        }`,
                        maxTokens: 100,
                        temperature: 0.2,
                        response_format: { type: "json_object" }
                    });

                    const relevance = this.safeJSONParse<{
                        isMeetingNotes: boolean;
                        confidence: number;
                        relevanceScore: number;
                        reasoning: string;
                    }>(relevanceResponse.choices[0]?.message?.content || '');
                    
                    if (relevance && relevance.isMeetingNotes && relevance.confidence > 0.7) {
                        relevantFiles.push({
                            file,
                            relevance: relevance.relevanceScore
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
            currentHeading: headings[0] || '',
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
        try {
            // Create a more natural prompt that includes all context
            const prompt = this.createNaturalPrompt(currentText, context, conversationHistory);
            
            const maxTokens = this.calculateMaxTokens(prompt, currentText);
            const temperature = this.calculateTemperature(context);

            const response = await this.makeAIRequest({
                prompt,
                maxTokens,
                temperature,
                model: this.DEFAULT_MODEL,
                response_format: { type: "json_object" }
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
        context?: DocumentContext,
        options?: AIRequestOptions
    ): Promise<string> {
        try {
            const request: AICompletionRequest = {
                prompt: this.createPromptWithContext(prompt, context),
                response_format: options?.response_format,
                maxTokens: TOKEN_LIMITS.COMPLETION,
                temperature: this.calculateTemperature(context)
            };

            const response = await this.makeAIRequest(request);
            return this.parseContentResponse(response);
        } catch (error) {
            this.handleError(error, 'Content generation failed');
        }
    }

    /**
     * Generate a summary of the current document
     */
    async generateSummary(file: TFile): Promise<string> {
        this.log('Summary', 'Starting summary generation', {
            file: file.path,
            fileName: file.basename
        });

        if (!this.apiKey) {
            const error = new Error('AI Service: API key not configured');
            this.log('Error', 'Summary generation failed - No API key', { error });
            throw error;
        }

        try {
            this.log('Summary', 'Reading file content');
            const content = await this.app.vault.read(file);
            this.log('Summary', 'File content loaded', {
                contentLength: content.length,
                fileName: file.basename
            });

            // Create a more detailed prompt that includes the actual content
            const prompt = `Generate a concise and focused summary of the following document. Be brief but informative, focusing only on the most important points.

Document Title: ${file.basename}
Content:
${content}

Please provide a clear and structured summary that includes ONLY:
1. Key decisions (if any)
2. Critical action items or next steps
3. Essential deadlines (if any)

Keep the summary brief and to the point. Avoid unnecessary details or repetition.`;

            this.log('Summary', 'Created summary prompt', {
                promptLength: prompt.length,
                includesContent: true
            });

            const response = await this.makeAIRequest({
                prompt,
                maxTokens: TOKEN_LIMITS.SUMMARY,
                temperature: 0.1, // Reduced temperature for more focused and concise output
                response_format: { type: "text" }
            });

            this.log('Response', 'Summary generated', {
                responseLength: response.choices[0]?.message?.content?.length || 0,
                model: response.model,
                content: response.choices[0]?.message?.content?.slice(0, 100) + '...',
                finish_reason: response.choices[0]?.finish_reason
            });

            return this.parseContentResponse(response);
        } catch (error) {
            this.log('Error', 'Summary generation failed', {
                error,
                file: file.path,
                errorType: error instanceof AIServiceError ? error.code : 'UNKNOWN'
            });
            throw new Error('Failed to get summary: ' + error.message);
        }
    }

    /**
     * Check and suggest improvements for Markdown formatting
     */
    async checkMarkdownFormatting(text: string, editor: Editor): Promise<string[]> {
        if (!text || !editor) {
            return [];
        }

        try {
            const response = await this.makeAIRequest({
                prompt: `Check this markdown text for formatting issues and suggest improvements:
${text}`,
                maxTokens: TOKEN_LIMITS.ANALYSIS,
                temperature: 0.3
            });

            return this.parseFormattingSuggestions(response);
        } catch (error) {
            this.handleError(error, 'Markdown formatting check failed');
        }
    }

    /**
     * Makes a request to the AI API with improved error handling and token management
     * @private
     * @param request The AI completion request
     * @returns OpenAI API response
     */
    private async makeAIRequest(options: AICompletionRequest): Promise<OpenAIResponse> {
        if (!this.apiKey) {
            throw new AIServiceError('API key not configured', 'AUTH_ERROR');
        }
        
        // Always use gpt-4o for fastest performance
        const requestBody = {
            model: DEFAULT_MODEL,
            messages: [
                {
                    role: 'system',
                    content: this.SYSTEM_PROMPT
                },
                {
                    role: 'user',
                    content: options.prompt
                }
            ],
            max_tokens: options.maxTokens,
            temperature: options.temperature,
            ...(options.response_format && { response_format: options.response_format })
        };

        this.log('API', 'Making API request', {
            endpoint: 'https://api.openai.com/v1/chat/completions',
            requestSize: JSON.stringify(requestBody).length
        });

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                throw new AIServiceError(
                    `API request failed: ${response.statusText}`,
                    'API_ERROR',
                    { status: response.status }
                );
            }

            const data = await response.json();
            
            this.log('API', 'API request successful', {
                responseSize: JSON.stringify(data).length,
                model: data.model,
                usage: data.usage
            });

            return data;
        } catch (error) {
            this.log('Error', 'API request failed', { error });
            throw new AIServiceError(
                'Failed to make API request',
                'API_ERROR',
                { originalError: error }
            );
        }
    }

    /**
     * Parse the API response for completion suggestions
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
     * Process a user message with enhanced error handling and recovery
     */
    async processMessage(
        message: string,
        conversationHistory?: string
    ): Promise<AICompletionResponse[]> {
        if (!this.apiKey) {
            throw new AIServiceError(
                'API key not configured',
                'AUTH_ERROR'
            );
        }

        try {
            // First, analyze the message internally
            const internalAnalysis = await this.makeAIRequest({
                prompt: `${this.SYSTEM_PROMPT}

Previous conversation:
${conversationHistory || 'No previous conversation'}

Analyze this message and determine if it requires specific note access.
Message: ${message}

Return a JSON object with this structure:
{
    "requiresNoteAccess": boolean,
    "noteType": string | null,
    "confidence": number,
    "action": string | null
}`,
                maxTokens: 200,
                temperature: 0.3,
                response_format: { type: "json_object" }
            });

            const analysis = this.safeJSONParse<{
                requiresNoteAccess: boolean;
                noteType: string | null;
                confidence: number;
                action: string | null;
            }>(internalAnalysis.choices[0]?.message?.content || '');

            if (!analysis) {
                throw new AIServiceError(
                    'Failed to parse message analysis',
                    'PARSE_ERROR',
                    { message }
                );
            }

            if (analysis.requiresNoteAccess && analysis.confidence > 0.7) {
                const relevantNotes = await this.findRelevantNotes(message).catch((error): Array<{ content: string; file: TFile }> => {
                    console.warn('Failed to find relevant notes:', error);
                    return [];
                });
                
                if (relevantNotes.length > 0) {
                    try {
                        const userResponse = await this.makeAIRequest({
                            prompt: `Generate a helpful response based on these notes:
                            ${relevantNotes.map(note => this.formatNotePreview(note)).join('\n')}
                            
                            User message: ${message}
                            
                            Provide a natural, direct response that answers the user's question 
                            or fulfills their request without mentioning the internal note analysis.`,
                            maxTokens: 500,
                            temperature: 0.7,
                            response_format: { type: "json_object" }
                        });

                        return this.parseCompletionResponse(userResponse);
                    } catch (error) {
                        throw new AIServiceError(
                            'Failed to generate response from notes',
                            'GENERATION_ERROR',
                            { originalError: error, noteCount: relevantNotes.length }
                        );
                    }
                }
            }

            // Fallback to general response
            const generalResponse = await this.makeAIRequest({
                prompt: `${this.SYSTEM_PROMPT}

Previous conversation:
${conversationHistory || 'No previous conversation'}

User message: ${message}

Provide a helpful, natural response that directly addresses the user's message.`,
                maxTokens: 500,
                temperature: 0.7,
                response_format: { type: "json_object" }
            }).catch(error => {
                throw new AIServiceError(
                    'Failed to generate general response',
                    'GENERATION_ERROR',
                    { originalError: error }
                );
            });

            return this.parseCompletionResponse(generalResponse);
        } catch (error) {
            return this.handleError(error, 'processMessage');
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

    /**
     * Validates the structure of an intent analysis JSON response
     * @private
     * @param jsonStr The JSON string to validate
     * @returns boolean indicating if the structure is valid
     */
    private validateJSONStructure(jsonStr: string): boolean {
        try {
            const obj = JSON.parse(jsonStr);
            return typeof obj.intent === 'string' && 
                   typeof obj.confidence === 'number' &&
                   typeof obj.subIntent === 'string' &&
                   typeof obj.entities === 'object' &&
                   typeof obj.requiresContext === 'boolean' &&
                   typeof obj.reasoning === 'string' &&
                   Object.keys(obj).length >= 6;
        } catch {
            return false;
        }
    }

    /**
     * Retry mechanism for intent analysis when initial parsing fails
     * @private
     * @param message The user message
     * @param context The document context
     * @param attempt The current retry attempt number
     * @returns IntentAnalysis object
     */
    private async retryIntentAnalysis(message: string, context: DocumentContext, attempt = 1): Promise<IntentAnalysis> {
        if (attempt > 2) {
            console.warn('Intent analysis failed after retries, using fallback');
            return this.getFallbackIntentAnalysis();
        }
        
        const retryPrompt = `Please reformat this response as valid JSON without markdown:
            ${message}
            
            Use this exact structure:
            {
                "intent": "...", 
                "subIntent": "...",
                "confidence": 0.0,
                "entities": {},
                "requiresContext": true/false,
                "reasoning": "..."
            }`;

        const retryResponse = await this.makeAIRequest({
            prompt: retryPrompt,
            maxTokens: Math.min(4096 - retryPrompt.length, 500),
            temperature: 0.3,
            model: this.settingsService.getSettings().aiModel,
            response_format: { type: "json_object" }
        });

        const cleanedResponse = retryResponse.choices[0]?.message?.content
            ?.replace(/```(json)?/g, '')
            .trim();

        if (!cleanedResponse || !this.validateJSONStructure(cleanedResponse)) {
            return this.retryIntentAnalysis(message, context, attempt + 1);
        }

        return JSON.parse(cleanedResponse);
    }

    /**
     * Provides a fallback intent analysis when all retries fail
     * @private
     * @returns A safe fallback IntentAnalysis object
     */
    private getFallbackIntentAnalysis(): IntentAnalysis {
        return {
            intent: 'other',
            subIntent: 'general',
            confidence: 0.5,
            entities: {
                documentType: '',
                specificDocument: '',
                timeFrame: '',
                scope: ''
            },
            requiresContext: false,
            reasoning: 'Fallback due to analysis failure'
        };
    }

    /**
     * Analyze user intent with improved error handling and validation
     * @private
     * @param message The user message
     * @param context The document context
     * @returns IntentAnalysis object
     */
    private async analyzeIntent(message: string, context: DocumentContext): Promise<IntentAnalysis> {
        const settings = this.settingsService.getSettings();
        const prompt = `Analyze the user's intent in this message: "${message}"
        ${context ? `\nContext: ${JSON.stringify(context)}` : ''}
        
        Return a JSON object with this structure:
        {
            "intent": "summarize|command|action|question|general",
            "subIntent": "specific action or topic",
            "confidence": 0.0 to 1.0,
            "entities": {
                "key": "value"
            },
            "requiresContext": true/false,
            "reasoning": "explanation of the analysis"
        }`;

        const response = await this.makeAIRequest({
            prompt,
            maxTokens: this.TOKEN_LIMITS.INTENT,
            temperature: 0.3,
            model: settings.aiModel,
            response_format: { type: "json_object" }
        });

        const responseContent = response.choices[0]?.message?.content;
        if (!responseContent) {
            throw new AIServiceError(
                'Empty response from AI service',
                'GENERATION_ERROR',
                { type: 'intent' }
            );
        }

        try {
            // Direct JSON parse attempt first
            const intentAnalysis = JSON.parse(responseContent);
            
            // Validate required structure
            if (!this.validateJSONStructure(responseContent)) {
                throw new AIServiceError(
                    'Invalid intent analysis response',
                    'PARSE_ERROR',
                    { type: 'intent', response: responseContent }
                );
            }

            return intentAnalysis;
        } catch (parseError) {
            this.logMonitoringData('Error', 'Intent analysis parsing failed', {
                error: parseError,
                response: responseContent
            });
            
            // Return a safe fallback structure
            return this.getFallbackIntentAnalysis();
        }
    }

    /**
     * Create enhanced context for document processing with improved error handling
     */
    private async createEnhancedContext(content: string, type: string): Promise<any> {
        try {
            const prompt = `Analyze this ${type} document and create a structured context. Return only a JSON object with no additional text or formatting.

Document content:
${content.slice(0, 2000)}... (truncated)

The response must be a valid JSON object with exactly this structure:
{
    "mainTopics": string[],
    "keyPoints": string[],
    "documentStructure": {
        "type": string,
        "sections": string[]
    },
    "entities": Record<string, any>
}`;

            const response = await this.makeAIRequest({
                prompt,
                maxTokens: Math.min(4096 - prompt.length, 1000),
                temperature: 0.2,
                model: this.settingsService.getSettings().aiModel,
                response_format: { type: "json_object" }
            });

            const responseContent = response.choices[0]?.message?.content;
            if (!responseContent) {
                throw new AIServiceError(
                    'Empty response from AI service',
                    'GENERATION_ERROR',
                    { type }
                );
            }

            try {
                // Direct JSON parse attempt first
                const context = JSON.parse(responseContent);
                
                // Validate required structure
                if (!this.validateContextStructure(context)) {
                    throw new AIServiceError(
                        'Invalid context structure',
                        'PARSE_ERROR',
                        { type, context }
                    );
                }

                return context;
            } catch (parseError) {
                this.logMonitoringData('Error', 'Context parsing failed', {
                    error: parseError,
                    response: responseContent
                });
                
                // Return a safe fallback structure
                return {
                    mainTopics: [],
                    keyPoints: [],
                    documentStructure: {
                        type: type,
                        sections: []
                    },
                    entities: {}
                };
            }
        } catch (error) {
            this.logMonitoringData('Error', 'Enhanced context creation failed', {
                error,
                type,
                contentLength: content.length
            });
            return this.handleError(error, 'createEnhancedContext');
        }
    }

    /**
     * Validates the structure of the context object
     * @private
     * @param context The context object to validate
     * @returns boolean indicating if the structure is valid
     */
    private validateContextStructure(context: any): boolean {
        return (
            Array.isArray(context.mainTopics) &&
            Array.isArray(context.keyPoints) &&
            typeof context.documentStructure === 'object' &&
            typeof context.documentStructure.type === 'string' &&
            Array.isArray(context.documentStructure.sections) &&
            typeof context.entities === 'object'
        );
    }

    /**
     * Get monitoring statistics
     * @returns Current monitoring statistics
     */
    public getMonitoringStats() {
        return {
            ...this.monitoring,
            jsonParsingStats: {
                ...this.monitoring.jsonParsingStats,
                successRate: this.monitoring.jsonParsingStats.successfulParses / 
                    this.monitoring.jsonParsingStats.totalAttempts,
                repairSuccessRate: this.monitoring.jsonParsingStats.successfulRepairs /
                    this.monitoring.jsonParsingStats.repairAttempts
            },
            responseStats: {
                ...this.monitoring.responseStats,
                markdownRate: this.monitoring.responseStats.markdownResponses /
                    this.monitoring.responseStats.totalResponses
            }
        };
    }

    /**
     * Get a user-friendly error message based on the error type
     * @private
     * @param error The error to process
     * @returns A user-friendly error message
     */
    private getErrorMessage(error: unknown): string {
        if (error instanceof AIServiceError) {
            switch (error.code) {
                case 'AUTH_ERROR':
                    return "I'm having trouble accessing the AI service. Please check your API key configuration.";
                case 'RATE_LIMIT':
                    return "I'm receiving too many requests right now. Please try again in a moment.";
                case 'PARSE_ERROR':
                    return "I had trouble understanding the response. Let me try a simpler approach.";
                case 'GENERATION_ERROR':
                    return "I encountered an issue while generating the response. Please try rephrasing your request.";
                case 'ANALYSIS_ERROR':
                    return "I had trouble analyzing your message. Could you try expressing it differently?";
                default:
                    return "I encountered an unexpected issue. Please try again.";
            }
        }
        return "I encountered an error while processing your request. Please try again.";
    }

    private log(category: string, message: string, data?: any) {
        console.log(`🤖 [${new Date().toISOString()}] [AI] [${category}] ${message}${data ? '\nDetails: ' + JSON.stringify(data, null, 2) : ''}`);
    }

    private async analyzeDocument(content: string, context?: DocumentContext): Promise<any> {
        this.log('Analysis', 'Starting document analysis', {
            contentLength: content.length,
            hasContext: !!context
        });

        const response = await this.makeAIRequest({
            prompt: `Analyze this document and create a structured context. Return only a JSON object with no additional text or formatting.

Document content:
${content.slice(0, 2000)}... (truncated)

The response must be a valid JSON object with exactly this structure:
{
    "mainTopics": string[],
    "keyPoints": string[],
    "documentStructure": {
        "type": string,
        "sections": string[]
    },
    "entities": Record<string, any>
}`,
            maxTokens: this.TOKEN_LIMITS.ANALYSIS,
            temperature: 0.3,
            model: this.settingsService.getSettings().aiModel,
            response_format: { type: "json_object" }
        });

        const responseContent = response.choices[0]?.message?.content;
        if (!responseContent) {
            throw new AIServiceError(
                'Empty response from AI service',
                'GENERATION_ERROR',
                { type: 'document' }
            );
        }

        try {
            // Direct JSON parse attempt first
            const analysis = JSON.parse(responseContent);
            
            // Validate required structure
            if (!this.validateContextStructure(analysis)) {
                throw new AIServiceError(
                    'Invalid analysis structure',
                    'PARSE_ERROR',
                    { type: 'document', analysis }
                );
            }

            return analysis;
        } catch (parseError) {
            this.logMonitoringData('Error', 'Analysis parsing failed', {
                error: parseError,
                response: responseContent
            });
            
            // Return a safe fallback structure
            return {
                mainTopics: [],
                keyPoints: [],
                documentStructure: {
                    type: 'document',
                    sections: []
                },
                entities: {}
            };
        }
    }

    private safeJSONParse<T>(jsonString: string): T | null {
        try {
            return JSON.parse(jsonString) as T;
        } catch (error) {
            this.monitoring.jsonParsingStats.failedParses++;
            this.logMonitoringData('jsonParsing', 'Failed to parse JSON', { error, jsonString });
            return null;
        }
    }

    private handleError(error: unknown, context?: string): never {
        const errorMessage = this.getErrorMessage(error);
        this.logMonitoringData('error', errorMessage, { context });
        throw new AIServiceError(errorMessage, 'PROCESSING_ERROR', { originalError: error, context });
    }

    private logMonitoringData(category: string, message: string, data: Record<string, unknown> = {}) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${category}] ${message}`, data);
        
        // Update monitoring stats
        if (category === 'error') {
            const errorType = data.errorType?.toString() || 'unknown';
            this.monitoring.errorStats.set(
                errorType,
                (this.monitoring.errorStats.get(errorType) || 0) + 1
            );
        }
    }

    private createPromptWithContext(prompt: string, context?: DocumentContext): string {
        let fullPrompt = this.SYSTEM_PROMPT + '\n\n';
        
        if (context) {
            fullPrompt += this.formatContext(context) + '\n\n';
        }
        
        return fullPrompt + prompt;
    }
}