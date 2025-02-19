import { App, TFile } from 'obsidian';
import { AIService, DocumentContext } from './ai_service';
import { CommandService } from './command_service';
import { FileNavigationService } from './file_navigation_service';
import { MemoryService } from './memory_service';
import { ActionGeneratorService } from './action_generator_service';
import { ProviderService } from './provider_service';
import { SettingsService } from './settings_service';
import { UIService } from './ui_service';
import { TOKEN_LIMITS, DEFAULT_MODEL, SYSTEM_PROMPTS } from '../constants';
import { IntentAnalysis } from '../types';

interface DocumentMetadata {
    date: string | null;
    author: string | null;
    tags: string[] | null;
    type: 'meeting' | 'research' | 'technical' | 'note' | 'other';
    customFields: Record<string, unknown>;
}

interface EnhancedDocumentContext extends DocumentContext {
    metadata?: DocumentMetadata;
    keyPoints?: string[];
    references?: string[];
    relatedDocuments?: string[];
}

export class ChatAgentService {
    private lastLogTimestamp: number = 0;
    private commandService: CommandService;
    private fileNavigationService: FileNavigationService;
    private memoryService: MemoryService;
    private actionGeneratorService: ActionGeneratorService;

    private readonly SYSTEM_PROMPT = SYSTEM_PROMPTS.CHAT_AGENT;
    private readonly DEFAULT_MODEL = DEFAULT_MODEL;

    // Add public method to handle messages
    async handleMessage(message: string, context?: DocumentContext): Promise<string> {
        return this.processMessage(message, context);
    }

    // Add logging utility
    private log(category: string, message: string, data?: any) {
        const now = Date.now();
        const timeSinceLastLog = now - this.lastLogTimestamp;
        this.lastLogTimestamp = now;
        
        console.log(`🤖 [${new Date().toISOString()}] [ChatAgent] [${category}] ${message}`, 
            data ? {
                ...data,
                timeSinceLastLog
            } : undefined
        );
    }

    constructor(
        private app: App,
        private aiService: AIService,
        private providerService: ProviderService,
        private uiService: UIService,
        private settingsService: SettingsService
    ) {
        this.log('Init', 'Initializing ChatAgentService');
        this.initializeServices();
    }

    private initializeServices() {
        this.log('Init', 'Setting up services');
        // Initialize all sub-services
        this.memoryService = new MemoryService();
        this.fileNavigationService = new FileNavigationService(this.app, this.memoryService);
        this.commandService = new CommandService(
            this.app,
            this.aiService,
            this.fileNavigationService,
            this.memoryService
        );
        this.actionGeneratorService = new ActionGeneratorService(
            this.commandService,
            this.aiService
        );
        
        // Register file open event handler
        this.app.workspace.on('file-open', (file) => {
            this.log('FileEvent', 'File opened', { path: file?.path });
            this.fileNavigationService.notifyFileOpen(file);
        });
        this.log('Init', 'Services initialized successfully');
    }

    private async findRelevantFile(message: string, context?: DocumentContext): Promise<TFile | null> {
        const files = this.app.vault.getMarkdownFiles();
        const normalizedQuery = message.toLowerCase();
        
        this.log('FileMatch', 'Starting file search', { 
            query: message,
            normalizedQuery,
            totalFiles: files.length,
            hasContext: !!context
        });

        // If we have a current file in context and it matches our query, use it
        if (context?.sourceFile) {
            const fileName = context.sourceFile.basename.toLowerCase();
            this.log('FileMatch', 'Checking current file', { 
                fileName,
                isRelevant: this.isFileNameRelevant(fileName, normalizedQuery)
            });
            
            if (this.isFileNameRelevant(fileName, normalizedQuery)) {
                this.log('FileMatch', 'Using current file', { fileName });
                return context.sourceFile;
            }
        }

        // First, look for exact matches
        this.log('FileMatch', 'Looking for exact matches');
        for (const file of files) {
            const fileName = file.basename.toLowerCase();
            const isRelevant = this.isFileNameRelevant(fileName, normalizedQuery);
            
            this.log('FileMatch', 'Checking file for exact match', { 
                fileName,
                isRelevant
            });
            
            if (isRelevant) {
                this.log('FileMatch', 'Found exact match', { fileName });
                return file;
            }
        }

        // Then look for partial matches
        this.log('FileMatch', 'Looking for partial matches');
        for (const file of files) {
            const fileName = file.basename.toLowerCase();
            const words = normalizedQuery.split(' ');
            const significantWords = words.filter(word => 
                word.length > 3 && 
                !['the', 'and', 'for', 'with', 'this', 'that'].includes(word)
            );
            
            const matchingWords = significantWords.filter(word => 
                fileName.includes(word)
            );
            
            this.log('FileMatch', 'Checking file for partial match', { 
                fileName,
                significantWords,
                matchingWords,
                matchCount: matchingWords.length
            });
            
            if (matchingWords.length >= 2) {
                this.log('FileMatch', 'Found partial match', { 
                    fileName,
                    matchingWords 
                });
                return file;
            }
        }

        this.log('FileMatch', 'No matching file found');
        return null;
    }

    private isFileNameRelevant(fileName: string, query: string): boolean {
        this.log('FileMatch', 'Checking relevance', { 
            fileName,
            query
        });

        // Extract the target file name from the query
        const targetFileName = query.match(/(?:summary of|summarize|about)\s+(?:the\s+)?([^.?!]+)(?:\s+note)?/i)?.[1]?.toLowerCase();
        
        if (!targetFileName) {
            this.log('FileMatch', 'No target file name found in query');
            return false;
        }

        this.log('FileMatch', 'Extracted target file name', { targetFileName });

        // Normalize file name and target
        const normalizedFileName = fileName.toLowerCase();
        const normalizedTarget = targetFileName.trim();

        // Check for exact match first
        if (normalizedFileName === normalizedTarget) {
            this.log('FileMatch', 'Exact match found', { 
                fileName,
                targetFileName 
            });
            return true;
        }

        // Split into words and check for significant word matches
        const fileWords = normalizedFileName.split(/\W+/);
        const targetWords = normalizedTarget.split(/\W+/).filter(word => 
            // Filter out common words that shouldn't affect matching
            !['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of'].includes(word)
        );

        // Calculate how many significant words match
        const matchingWords = targetWords.filter(word => fileWords.includes(word));
        const matchRatio = matchingWords.length / targetWords.length;

        this.log('FileMatch', 'Word match analysis', { 
            fileWords,
            targetWords,
            matchingWords,
            matchRatio
        });

        // Require a high match ratio (80% or more of significant words must match)
        const isRelevant = matchRatio >= 0.8;

        this.log('FileMatch', `Relevance ${isRelevant ? 'found' : 'not found'}`, { 
            matchRatio,
            threshold: 0.8
        });

        return isRelevant;
    }

    private async processMessage(
        message: string,
        context?: DocumentContext
    ): Promise<string> {
        this.log('Process', 'Starting message processing', {
            message,
            hasContext: !!context,
            currentFile: context?.sourceFile?.basename
        });

        try {
            // First, try to find a relevant file based on the message
            const relevantFile = await this.findRelevantFile(message, context);
            if (relevantFile) {
                this.log('Process', 'Found relevant file', { 
                    file: relevantFile.basename,
                    path: relevantFile.path,
                    matchedFrom: context?.sourceFile === relevantFile ? 'context' : 'search'
                });
                
                // Read the file content and enhance the context
                const fileContent = await this.fileNavigationService.readFileContent(relevantFile);
                context = {
                    ...context,
                    sourceFile: relevantFile,
                    content: fileContent,
                    currentParagraph: fileContent
                };
            } else {
                this.log('Process', 'No relevant file found for query');
            }

            const intentAnalysis = await this.analyzeIntent(message, context);
            this.log('Process', 'Intent analyzed', { 
                intent: intentAnalysis.intent,
                confidence: intentAnalysis.confidence,
                subIntent: intentAnalysis.subIntent
            });

            // Handle different intents based on confidence and type
            if (intentAnalysis.confidence >= 0.7) {
                switch (intentAnalysis.intent) {
                    case 'summarize':
                        const targetFile = context?.sourceFile;
                        if (!targetFile) {
                            this.log('Process', 'No target file for summary');
                            return "Could you please specify which document you'd like me to summarize?";
                        }
                        if (!context?.content) {
                            this.log('Process', 'No content in context, reading file');
                            context.content = await this.fileNavigationService.readFileContent(targetFile);
                        }
                        return await this.handleSummarizeIntent(message, context, intentAnalysis);
                    case 'command':
                        return await this.handleCommandIntent(message, context);
                    case 'action':
                        return await this.handleActionIntent(message, context);
                    case 'question':
                        return await this.handleQuestionIntent(message, context, intentAnalysis);
                }
            }

            // For low confidence or unhandled intents, generate a general response
            this.log('Process', 'Using general response for low confidence/unhandled intent');
            return await this.aiService.generateContent(
                `Respond to this user message in a helpful and natural way: ${message}`,
                this.memoryService.getEnhancedContext(context)
            );
        } catch (error) {
            this.log('Error', 'Message processing failed', { error });
            return "I encountered an error while processing your request. Please try again.";
        }
    }

    private async findMeetingNotes(message: string): Promise<{ content: string; file: TFile } | null> {
        this.log('Search', 'Looking for meeting notes', { query: message });
        try {
            // First try to find files with explicit meeting-related names
            const files = await this.fileNavigationService.searchFiles('meeting');
            this.log('Search', 'Found potential meeting files', { count: files.length });
            
            // Use AI to analyze which files are most likely to be meeting notes
            const fileAnalysisPromises = files.map(async (file: TFile) => {
                this.log('Analysis', 'Analyzing file for meeting content', { file: file.path });
                const content = await this.fileNavigationService.readFileContent(file);
                const relevanceAnalysis = await this.aiService.generateContent(
                    `Analyze if this content is likely to be meeting notes.
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
                    { previousParagraphs: [], currentHeading: '', documentStructure: { headings: [] } },
                    { response_format: { type: "json_object" } }
                );

                try {
                    const analysis = JSON.parse(relevanceAnalysis);
                    this.log('Analysis', 'File analysis complete', { 
                        file: file.path, 
                        isMeetingNotes: analysis.isMeetingNotes,
                        confidence: analysis.confidence 
                    });
                    return {
                        file,
                        content,
                        relevance: analysis.relevanceScore,
                        isMeetingNotes: analysis.isMeetingNotes,
                        confidence: analysis.confidence
                    };
                } catch (error) {
                    this.log('Error', 'Failed to parse file analysis', { error: error.message });
                    return null;
                }
            });

            interface FileAnalysis {
                file: TFile;
                content: string;
                relevance: number;
                isMeetingNotes: boolean;
                confidence: number;
            }

            const fileAnalyses = (await Promise.all(fileAnalysisPromises))
                .filter((analysis: unknown): analysis is FileAnalysis => 
                    analysis !== null && 
                    typeof analysis === 'object' &&
                    'file' in analysis &&
                    'content' in analysis &&
                    'relevance' in analysis &&
                    'isMeetingNotes' in analysis &&
                    'confidence' in analysis
                );
            
            // Find the most relevant meeting notes
            const relevantFiles = fileAnalyses
                .filter((analysis: FileAnalysis) => analysis.isMeetingNotes && analysis.confidence > 0.7)
                .sort((a: FileAnalysis, b: FileAnalysis) => b.relevance - a.relevance);

            const mostRelevant = relevantFiles[0];
            if (mostRelevant) {
                return {
                    content: mostRelevant.content,
                    file: mostRelevant.file
                };
            }
        } catch (error) {
            console.error('Error finding meeting notes:', error);
        }
        return null;
    }

    private async createEnhancedContext(
        content: string,
        file: TFile,
        baseContext: DocumentContext
    ): Promise<EnhancedDocumentContext> {
        this.log('Context', 'Creating enhanced context', {
            fileBasename: file.basename,
            contentLength: content.length,
            hasBaseContext: !!baseContext
        });

        try {
            // First, determine the document type
            const typeAnalysis = await this.aiService.generateContent(
                `Analyze this document and determine its type and structure.
                Content: "${content.slice(0, 1000)}..."
                
                Respond with JSON:
                {
                    "type": "meeting" | "research" | "technical" | "note" | "other",
                    "confidence": number (0-1),
                    "reasoning": string
                }`,
                baseContext,
                { response_format: { type: "json_object" } }
            );

            this.log('Context', 'Document type analysis received', {
                analysisLength: typeAnalysis.length
            });

            const typeInfo = JSON.parse(typeAnalysis);

            this.log('Context', 'Document type determined', {
                type: typeInfo.type,
                confidence: typeInfo.confidence
            });

            // Now analyze the content based on the detected type
            const analysisPrompt = this.getAnalysisPromptForType(typeInfo.type, content);
            const contentAnalysis = await this.aiService.generateContent(analysisPrompt, baseContext, { response_format: { type: "json_object" } });
            const analysis = JSON.parse(contentAnalysis);

            this.log('Context', 'Detailed analysis received', {
                analysisLength: contentAnalysis.length
            });

            this.log('Context', 'Analysis parsed', {
                hasKeyPoints: !!analysis.keyPoints,
                hasReferences: !!analysis.references,
                keyPointCount: analysis.keyPoints?.length
            });

            // Create enhanced context with type-specific processing
            const enhancedContext: EnhancedDocumentContext = {
                ...this.createBasicContext(content, file, baseContext),
                metadata: {
                    type: typeInfo.type,
                    date: analysis.metadata?.date || null,
                    author: analysis.metadata?.author || null,
                    tags: analysis.metadata?.tags || null,
                    customFields: analysis.metadata?.customFields || {}
                },
                keyPoints: analysis.keyPoints,
                references: analysis.references,
                relatedDocuments: analysis.relatedDocuments
            };

            return enhancedContext;
        } catch (error) {
            this.log('Error', 'Enhanced context creation failed', { error });
            return this.createBasicContext(content, file, baseContext);
        }
    }

    private createBasicContext(
        content: string,
        file: TFile,
        baseContext: DocumentContext
    ): EnhancedDocumentContext {
        this.log('Context', 'Creating basic context', {
            fileBasename: file.basename,
            contentLength: content.length,
            hasBaseContext: !!baseContext
        });

        const paragraphs = content.split('\n\n').slice(0, 5);
        const headings = content.split('\n')
            .filter(line => line.startsWith('#'))
            .map(line => line.replace(/^#+\s*/, ''));

        this.log('Context', 'Extracted document structure', {
            paragraphCount: paragraphs.length,
            headingCount: headings.length
        });

        return {
            ...baseContext,
            content,
            previousParagraphs: paragraphs,
            currentParagraph: paragraphs[0] || '',
            currentHeading: headings[0] || '',
            documentStructure: {
                title: file.basename,
                headings: headings
            },
            sourceFile: file,
            metadata: {
                date: null,
                author: null,
                tags: null,
                type: 'other',
                customFields: {}
            }
        };
    }

    private getAnalysisPromptForType(type: string, content: string): string {
        const basePrompt = `Analyze this ${type} document and identify its key components.
        Content: "${content}"
        
        Respond with JSON including these base fields:
        {
            "relevantParagraphs": string[],
            "keyHeadings": string[],
            "metadata": {
                "date": string | null,
                "author": string | null,
                "tags": string[] | null,
                "customFields": object
            }`;

        switch (type) {
            case 'meeting':
                return basePrompt + `,
                    "keyPoints": [
                        "decisions made",
                        "action items",
                        "deadlines",
                        "responsibilities"
                    ],
                    "participants": string[]
                }`;

            case 'research':
                return basePrompt + `,
                    "keyPoints": [
                        "research questions",
                        "methodology",
                        "findings",
                        "conclusions"
                    ],
                    "references": string[],
                    "relatedDocuments": string[]
                }`;

            case 'technical':
                return basePrompt + `,
                    "keyPoints": [
                        "core concepts",
                        "implementation details",
                        "requirements",
                        "dependencies"
                    ],
                    "codeBlocks": string[],
                    "relatedDocuments": string[]
                }`;

            case 'note':
                return basePrompt + `,
                    "keyPoints": string[],
                    "relatedDocuments": string[]
                }`;

            default:
                return basePrompt + `}`;
        }
    }

    private async summarizeDocument(context: DocumentContext): Promise<string> {
        const currentFile = context.sourceFile;

        if (!currentFile) {
            return "Please open the document you want to summarize.";
        }

        try {
            const fileContent = await this.fileNavigationService.readFileContent(currentFile);
            this.log('Summary', 'File content loaded', {
                fileSize: fileContent.length,
                fileName: currentFile.basename
            });

            // Create an enhanced context with document-specific analysis
            const enhancedContext = await this.createEnhancedContext(
                fileContent,
                currentFile,
                {
                    ...context,
                    content: fileContent, // Ensure file content is included in context
                    previousParagraphs: fileContent.split('\n\n').slice(0, 5),
                    documentStructure: {
                        title: currentFile.basename,
                        headings: fileContent.split('\n')
                            .filter(line => line.startsWith('#'))
                            .map(line => line.replace(/^#+\s*/, ''))
                    }
                }
            );

            this.log('Summary', 'Enhanced context created', {
                contextType: enhancedContext.metadata?.type,
                hasKeyPoints: !!enhancedContext.keyPoints,
                keyPointsCount: enhancedContext.keyPoints?.length
            });

            // Create the summary prompt
            const summaryPrompt = this.createSummaryPrompt(enhancedContext);
            this.log('Summary', 'Generating summary', {
                promptLength: summaryPrompt.length,
                contextType: enhancedContext.metadata?.type,
                prompt: summaryPrompt.slice(0, 100) + '...'
            });

            // Generate the summary
            const summary = await this.aiService.generateContent(
                summaryPrompt,
                {
                    ...enhancedContext,
                    content: fileContent // Ensure file content is included in final context
                }
            );

            this.log('Summary', 'Summary generated', {
                summaryLength: summary.length,
                processingTime: Date.now(),
                content: summary.slice(0, 100) + '...',
                context: enhancedContext
            });

            return summary;

        } catch (error) {
            this.log('Error', 'Error summarizing document', { error });
            return `I encountered an error while summarizing the document: ${error.message}`;
        }
    }

    private async handleSummarizeIntent(
        message: string,
        context: DocumentContext,
        intent: IntentAnalysis
    ): Promise<string> {
        this.log('Summary', 'Starting summary generation', { 
            subIntent: intent.subIntent,
            hasContext: !!context,
            currentFile: context.sourceFile?.path,
            messageLength: message.length
        });
        
        try {
            // Validate context and get target file
            const targetFile = context.sourceFile;

            if (!targetFile) {
                this.log('Summary', 'No target file found');
                return "Could you please specify which document you'd like me to summarize?";
            }

            // Read file content
            const fileContent = await this.fileNavigationService.readFileContent(targetFile);
            this.log('Summary', 'File content loaded', { 
                fileSize: fileContent.length,
                fileName: targetFile.basename
            });

            // Create enhanced context
            const enhancedContext = await this.createEnhancedContext(fileContent, targetFile, context);
            this.log('Summary', 'Enhanced context created', { 
                contextType: enhancedContext.metadata?.type,
                hasKeyPoints: !!enhancedContext.keyPoints,
                keyPointsCount: enhancedContext.keyPoints?.length
            });

            // Generate summary
            const summaryPrompt = this.createSummaryPrompt(enhancedContext);
            this.log('Summary', 'Generating summary', { 
                promptLength: summaryPrompt.length,
                contextType: enhancedContext.metadata?.type,
                prompt: summaryPrompt // Add the actual prompt to logs
            });

            const summary = await this.aiService.generateContent(summaryPrompt, enhancedContext);
            this.log('Summary', 'Summary generated', { 
                summaryLength: summary.length,
                processingTime: Date.now() - new Date(this.lastLogTimestamp).getTime(),
                content: summary,
                context: enhancedContext // Add the context sent to the API
            });

            return summary;
        } catch (error) {
            this.log('Error', 'Summary generation failed', { error });
            return `I encountered an error while summarizing the document: ${error.message}`;
        }
    }

    private createSummaryPrompt(context: EnhancedDocumentContext): string {
        const docType = context.metadata?.type || 'general';
        
        this.log('Summary', 'Creating summary prompt', {
            documentType: docType,
            hasKeyPoints: !!context.keyPoints,
            hasReferences: !!context.references
        });

        const basePrompt = `Provide a brief and focused summary of this ${docType} document. Focus only on essential information.`;
        
        const typeSpecificPrompts: Record<string, string> = {
            'meeting': `
Format the summary concisely:

Key Decisions:
[List ONLY major decisions, max 3]

Action Items:
[List ONLY critical tasks with owners and deadlines, max 3]

Next Steps:
[List ONLY immediate next actions, max 2]`,

            'research': `
Format the summary concisely:

Key Finding:
[State the single most important finding]

Main Conclusion:
[State the primary conclusion]

Critical Implications:
[List ONLY major implications, max 2]`,

            'technical': `
Format the summary concisely:

Core Concept:
[One-sentence description of the main technical concept]

Key Requirements:
[List ONLY critical requirements, max 3]

Essential Dependencies:
[List ONLY must-have dependencies, max 2]`,

            'note': `
Format the summary concisely:

Main Topic:
[One-sentence description]

Key Points:
[List ONLY essential points, max 3]

Primary Takeaway:
[Single most important conclusion]`,

            'other': `
Format the summary concisely:

Main Topic:
[One-sentence description]

Key Points:
[List ONLY essential points, max 3]

Conclusion:
[Single most important takeaway]`
        };

        const promptTemplate = typeSpecificPrompts[docType] || typeSpecificPrompts['other'];
        
        this.log('Summary', 'Created prompt', {
            promptLength: promptTemplate.length,
            promptType: docType
        });

        return `${basePrompt}

${promptTemplate}

Important: Keep the summary extremely concise. Focus on quality over quantity. Use bullet points for clarity.`;
    }

    private async handleCommandIntent(message: string, context: DocumentContext): Promise<string> {
        const parseResult = await this.commandService.parseCommand(message);
        if (parseResult) {
            return await this.commandService.executeCommand(
                parseResult.command,
                context,
                parseResult.args
            );
        }
        return "I couldn't determine which command to execute. Could you please be more specific?";
    }

    private async handleActionIntent(message: string, context: DocumentContext): Promise<string> {
        const actions = await this.actionGeneratorService.generateActions(message, context);
        
        const executedActions = [];
        for (const action of actions) {
            if (action.confidence > 0.8) {
                try {
                    await action.execute();
                    executedActions.push(action.description);
                } catch (error) {
                    this.log('Error', 'Action execution failed', { error: error.message });
                }
            }
        }

        if (executedActions.length > 0) {
            return executedActions.join('\n');
        }

        return "Could you please be more specific about what you'd like me to do?";
    }

    private async handleQuestionIntent(
        message: string,
        context: DocumentContext,
        intent: IntentAnalysis
    ): Promise<string> {
        if (!context.sourceFile) {
            return "Please open a document first.";
        }

        const content = await this.fileNavigationService.readFileContent(context.sourceFile);
        const enhancedContext = await this.createEnhancedContext(
            content,
            context.sourceFile,
            context
        );

        let prompt = message;
        if (intent.entities.scope) {
            prompt = `Regarding ${intent.entities.scope}: ${message}`;
        }
        if (intent.entities.timeFrame) {
            prompt += `\nTimeframe: ${intent.entities.timeFrame}`;
        }

        return await this.aiService.generateContent(prompt, enhancedContext);
    }

    /**
     * Get agent's memory state
     */
    getMemory() {
        return this.memoryService.getState();
    }

    /**
     * Get available commands
     */
    getCommands() {
        return this.commandService.getCommands();
    }

    /**
     * Clean up resources when the service is unloaded
     */
    onunload() {
        this.log('Cleanup', 'Unloading ChatAgentService');
        this.fileNavigationService.cleanup();
        this.commandService.cleanup();
        this.memoryService.cleanup();
        this.actionGeneratorService.cleanup();
        this.log('Cleanup', 'ChatAgentService unloaded successfully');
    }

    private serializeContext(context: DocumentContext | null): string {
        if (!context) return '';
        
        // Create a sanitized version of the context without circular references
        const sanitizedContext = {
            previousParagraphs: context.previousParagraphs || [],
            currentHeading: context.currentHeading,
            documentStructure: {
                title: context.documentStructure?.title,
                headings: context.documentStructure?.headings || []
            },
            sourceFile: context.sourceFile ? {
                basename: context.sourceFile.basename,
                path: context.sourceFile.path
            } : null
        };
        
        return JSON.stringify(sanitizedContext);
    }

    private validateIntentAnalysis(obj: any): obj is IntentAnalysis {
        return (
            obj &&
            typeof obj === 'object' &&
            ['summarize', 'command', 'question', 'action', 'other'].includes(obj.intent) &&
            (!obj.subIntent || ['meeting', 'research', 'technical', 'general'].includes(obj.subIntent)) &&
            typeof obj.confidence === 'number' &&
            obj.confidence >= 0 &&
            obj.confidence <= 1 &&
            typeof obj.entities === 'object' &&
            typeof obj.requiresContext === 'boolean' &&
            typeof obj.reasoning === 'string'
        );
    }

    private async analyzeIntent(message: string, context?: DocumentContext): Promise<IntentAnalysis> {
        this.log('Intent', 'Starting intent analysis', {
            messageLength: message.length,
            hasContext: !!context
        });

        const response = await this.aiService.generateContent(
            this.createIntentAnalysisPrompt(message, context),
            context,
            {
                maxTokens: TOKEN_LIMITS.INTENT,
                temperature: 0.3,
                model: this.DEFAULT_MODEL,
                response_format: { type: "json_object" }
            }
        );

        return this.parseIntentResponse(response);
    }

    private createIntentAnalysisPrompt(message: string, context?: DocumentContext): string {
        const prompt = `Analyze the intent of this message: "${message}"
        Current context: ${this.serializeContext(context)}
        
        Respond with a JSON object containing:
        {
            "intent": "summarize" | "command" | "question" | "action" | "other",
            "subIntent": "meeting" | "research" | "technical" | "general",
            "confidence": number,
            "entities": {
                "documentType": string,
                "specificDocument": string,
                "timeFrame": string,
                "scope": string
            },
            "requiresContext": boolean,
            "reasoning": string
        }`;
        return prompt;
    }

    private parseIntentResponse(response: string): IntentAnalysis {
        try {
            const analysis = JSON.parse(response);
            if (this.validateIntentAnalysis(analysis)) {
                return analysis;
            } else {
                this.log('Intent', 'Invalid analysis format', { analysis });
                return this.getFallbackIntentAnalysis();
            }
        } catch (error) {
            this.log('Error', 'Failed to parse intent analysis', { error, response });
            return this.getFallbackIntentAnalysis();
        }
    }

    private async retryIntentAnalysis(
        message: string,
        context: DocumentContext,
        attempt = 1
    ): Promise<IntentAnalysis> {
        if (attempt > 3) {
            this.log('Intent', 'Max retries reached, using fallback');
            return this.getFallbackIntentAnalysis();
        }

        this.log('Intent', `Retrying intent analysis (attempt ${attempt})`);

        try {
            const response = await this.aiService.generateContent(
                `IMPORTANT: Analyze this message and return a valid JSON object matching this structure exactly:
                {
                    "intent": "summarize" | "command" | "question" | "action" | "other",
                    "subIntent": "meeting" | "research" | "technical" | "general",
                    "confidence": number,
                    "entities": {
                        "documentType": string,
                        "specificDocument": string,
                        "timeFrame": string,
                        "scope": string
                    },
                    "requiresContext": boolean,
                    "reasoning": string
                }

                Message: "${message}"
                ${context ? `Context: ${this.serializeContext(context)}` : ''}`,
                context,
                { response_format: { type: "json_object" } }
            );

            const analysis = JSON.parse(response);
            if (this.validateIntentAnalysis(analysis)) {
                this.log('Intent', 'Retry successful', { 
                    attempt,
                    intent: analysis.intent,
                    confidence: analysis.confidence
                });
                return analysis;
            }
            
            this.log('Intent', 'Invalid analysis format in retry', { 
                attempt,
                analysis
            });
            return await this.retryIntentAnalysis(message, context, attempt + 1);
        } catch (error) {
            this.log('Error', `Intent analysis retry ${attempt} failed`, { error });
            return await this.retryIntentAnalysis(message, context, attempt + 1);
        }
    }

    private getFallbackIntentAnalysis(): IntentAnalysis {
        return {
            intent: 'other',
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
}