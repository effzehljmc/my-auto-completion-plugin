import { App, TFile } from 'obsidian';
import { AIService, DocumentContext } from './ai_service';
import { CommandService } from './command_service';
import { FileNavigationService } from './file_navigation_service';
import { MemoryService } from './memory_service';
import { ActionGeneratorService } from './action_generator_service';
import { ProviderService } from './provider_service';
import { SettingsService } from './settings_service';
import { UIService } from './ui_service';

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

interface IntentAnalysis {
    intent: 'summarize' | 'command' | 'question' | 'action' | 'other';
    subIntent?: 'meeting' | 'research' | 'technical' | 'general';
    confidence: number;
    entities: {
        documentType?: string;
        specificDocument?: string;
        timeFrame?: string;
        scope?: string;
    };
    requiresContext: boolean;
    reasoning: string;
}

export class ChatAgentService {
    private commandService: CommandService;
    private fileNavigationService: FileNavigationService;
    private memoryService: MemoryService;
    private actionGeneratorService: ActionGeneratorService;

    // Add logging utility
    private log(category: string, message: string, data?: any) {
        const timestamp = new Date().toISOString();
        const logMessage = `🤖 [${timestamp}] [ChatAgent] [${category}] ${message}`;
        
        // Always log to console.info for critical operations
        console.info(logMessage);
        
        // Additional debug information if data is present
        if (data) {
            console.info('Details:', data);
        }
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
                    { previousParagraphs: [], currentHeading: '', documentStructure: { headings: [] } }
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
                baseContext
            );

            const typeInfo = JSON.parse(typeAnalysis);

            // Now analyze the content based on the detected type
            const analysisPrompt = this.getAnalysisPromptForType(typeInfo.type, content);
            const contentAnalysis = await this.aiService.generateContent(analysisPrompt, baseContext);
            const analysis = JSON.parse(contentAnalysis);

            // Create enhanced context with type-specific processing
            const enhancedContext: EnhancedDocumentContext = {
                ...baseContext,
                previousParagraphs: analysis.relevantParagraphs || [],
                documentStructure: {
                    title: file.basename,
                    headings: analysis.keyHeadings || []
                },
                sourceFile: file,
                currentHeading: analysis.keyHeadings?.[0] || '',
                metadata: {
                    date: analysis.metadata?.date || null,
                    author: analysis.metadata?.author || null,
                    tags: analysis.metadata?.tags || null,
                    type: typeInfo.type,
                    customFields: analysis.metadata?.customFields || {}
                }
            };

            // Add type-specific fields
            if (analysis.keyPoints) {
                enhancedContext.keyPoints = analysis.keyPoints;
            }
            if (analysis.references) {
                enhancedContext.references = analysis.references;
            }
            if (analysis.relatedDocuments) {
                enhancedContext.relatedDocuments = analysis.relatedDocuments;
            }

            return enhancedContext;
                } catch (error) {
            console.error('Error creating enhanced context:', error);
            // Fallback to basic context if AI analysis fails
            return this.createBasicContext(content, file, baseContext);
        }
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

    private createBasicContext(
        content: string,
        file: TFile,
        baseContext: DocumentContext
    ): EnhancedDocumentContext {
        const paragraphs = content.split('\n\n').slice(0, 5);
        const headings = content.split('\n')
            .filter(line => line.startsWith('#'))
            .map(line => line.replace(/^#+\s*/, ''));

        return {
            ...baseContext,
            previousParagraphs: paragraphs,
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

    private async summarizeDocument(context: DocumentContext): Promise<string> {
        const currentFile = context.sourceFile;

        if (!currentFile) {
            return "Please open the document you want to summarize.";
        }

        try {
            const fileContent = await this.fileNavigationService.readFileContent(currentFile);

            // Create an enhanced context with document-specific analysis
            const enhancedContext = await this.createEnhancedContext(
                fileContent,
                currentFile,
                context
            );

            // Generate the summary using a more comprehensive prompt
            const summary = await this.aiService.generateContent(
                `Please provide a comprehensive summary of this document. Include:

                1. Main topic or purpose
                2. Key findings or arguments
                3. Important conclusions
                4. Methodology or approach (if applicable)
                5. Significant data or evidence presented
                6. Implications or recommendations

                If the document is research-focused, emphasize:
                - Research questions/objectives
                - Methodology
                - Key findings
                - Conclusions

                If it's a technical document, focus on:
                - Core concepts
                - Technical specifications
                - Implementation details
                - Best practices or guidelines

                Format the summary in a clear, structured way that highlights the most important points.`,
                enhancedContext
            );

            return summary;

        } catch (error) {
            console.error('Error summarizing document:', error);
            return `I encountered an error while summarizing the document: ${error.message}`;
        }
    }

    /**
     * Process a user message and generate appropriate actions and responses
     */
    async processMessage(message: string, context: DocumentContext): Promise<string> {
        this.log('Process', 'Starting message processing', { 
            message,
            hasContext: !!context,
            currentFile: context.sourceFile?.path
        });

        try {
            // Update conversation context
            this.memoryService.updateContext(context);

            // Analyze user intent
            const intent = await this.analyzeIntent(message, context);
            
            // Handle different intents based on confidence and type
            if (intent.confidence >= 0.7) {
                switch (intent.intent) {
                    case 'summarize':
                        return await this.handleSummarizeIntent(message, context, intent);
                    case 'command':
                        return await this.handleCommandIntent(message, context);
                    case 'action':
                        return await this.handleActionIntent(message, context);
                    case 'question':
                        return await this.handleQuestionIntent(message, context, intent);
                }
            }

            // For low confidence or unhandled intents, generate a general response
            return await this.aiService.generateContent(
                `Respond to this user message in a helpful and natural way: ${message}`,
                this.memoryService.getEnhancedContext(context)
            );
        } catch (error) {
            this.log('Error', 'Message processing failed', {
                error: error.message,
                stack: error.stack
            });
            return "I encountered an error while processing your request. Please try again.";
        }
    }

    private async analyzeIntent(message: string, context: DocumentContext): Promise<IntentAnalysis> {
        this.log('Analysis', 'Starting intent analysis', { message });
        try {
            const intentAnalysis = await this.aiService.generateContent(
                `You are a JSON generator. Output a SINGLE valid JSON object.
                DO NOT include any other text, markdown, or formatting.
                DO NOT wrap the JSON in code blocks.
                DO NOT add explanations.
                ONLY return the JSON object itself.

                Analyze this message: "${message}"
                Current document: ${context.sourceFile?.basename || 'None'}
                
                Return this exact structure:
                {
                    "intent": "summarize" | "command" | "question" | "action" | "other",
                    "subIntent": "meeting" | "research" | "technical" | "general" | null,
                    "confidence": number between 0 and 1,
                    "entities": {
                        "documentType": string or null,
                        "specificDocument": string or null,
                        "timeFrame": string or null,
                        "scope": string or null
                    },
                    "requiresContext": boolean,
                    "reasoning": string
                }

                Example of valid response:
                {"intent":"summarize","subIntent":"research","confidence":0.9,"entities":{"documentType":"research","specificDocument":null,"timeFrame":null,"scope":null},"requiresContext":true,"reasoning":"User requests document summary"}`,
                context
            );

            try {
                // Clean the response of any potential markdown or extra text
                const cleanedResponse = intentAnalysis
                    .replace(/```json/g, '')
                    .replace(/```/g, '')
                    .trim();

                // Validate that the response starts with { and ends with }
                if (!cleanedResponse.startsWith('{') || !cleanedResponse.endsWith('}')) {
                    throw new Error('Response is not a valid JSON object');
                }

                const parsedIntent = JSON.parse(cleanedResponse);

                // Validate the parsed object has required fields
                if (!this.isValidIntentAnalysis(parsedIntent)) {
                    throw new Error('Parsed JSON does not match required IntentAnalysis structure');
                }

                return parsedIntent;
            } catch (parseError) {
                this.log('Error', 'Failed to parse intent analysis JSON', { 
                    error: parseError.message,
                    rawResponse: intentAnalysis,
                    cleanedResponse: intentAnalysis
                        .replace(/```json/g, '')
                        .replace(/```/g, '')
                        .trim()
                });
                
                // Return a safe default with the raw response in reasoning
                return {
                    intent: 'other',
                    confidence: 0.5,
                    entities: {},
                    requiresContext: false,
                    reasoning: `Failed to parse response. Raw: ${intentAnalysis.slice(0, 100)}...`
                };
            }
        } catch (error) {
            this.log('Error', 'Intent analysis failed', { error: error.message });
            return {
                intent: 'other',
                confidence: 0.5,
                entities: {},
                requiresContext: false,
                reasoning: 'Failed to analyze intent'
            };
        }
    }

    private isValidIntentAnalysis(obj: any): obj is IntentAnalysis {
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

    private async handleSummarizeIntent(
        message: string,
        context: DocumentContext,
        intent: IntentAnalysis
    ): Promise<string> {
        this.log('Summary', 'Starting summary generation', { 
            subIntent: intent.subIntent,
            hasContext: !!context,
            currentFile: context.sourceFile?.path
        });
        
        try {
            // Validate context and get target file
            const targetFile = context.sourceFile;

            if (!targetFile) {
                this.log('Summary', 'No active file found');
                return "Could you please open the document you'd like me to summarize?";
            }

            this.log('Summary', 'Reading file content', { file: targetFile.path });
            const fileContent = await this.fileNavigationService.readFileContent(targetFile);

            // Create enhanced context with document analysis
            this.log('Summary', 'Creating enhanced context');
            const enhancedContext = await this.createEnhancedContext(
                fileContent,
                targetFile,
                            context
                        );
                        
            this.log('Summary', 'Document type detected', { 
                type: enhancedContext.metadata?.type,
                hasKeyPoints: !!enhancedContext.keyPoints
            });

            // Generate summary based on document type
            const summaryPrompt = this.createSummaryPrompt(enhancedContext);
            
            this.log('Summary', 'Generating final summary');
            const summary = await this.aiService.generateContent(summaryPrompt, enhancedContext);

            this.log('Summary', 'Summary generated successfully', {
                summaryLength: summary.length,
                documentType: enhancedContext.metadata?.type
            });

            return summary;
        } catch (error) {
            this.log('Error', 'Summary generation failed', { 
                error: error.message,
                stack: error.stack
            });
            return "I encountered an error while generating the summary. Please try again.";
        }
    }

    private createSummaryPrompt(context: EnhancedDocumentContext): string {
        const docType = context.metadata?.type || 'general';
        
        const basePrompt = `Provide a clear and structured summary of this ${docType} document.`;
        
        const typeSpecificPrompts: Record<string, string> = {
            'meeting': `
Format the summary as follows:

Key Decisions:
[List the main decisions made during the meeting]

Action Items:
[List specific tasks, who they're assigned to, and deadlines]

Next Steps:
[Outline the agreed-upon next steps]

Additional Notes:
[Include any other important points discussed]`,

            'research': `
Format the summary as follows:

Research Objective:
[State the main research question or objective]

Key Findings:
[List the main research findings]

Methodology:
[Briefly describe the research approach]

Conclusions:
[Summarize the main conclusions]

Implications:
[Note any important implications or recommendations]`,

            'technical': `
Format the summary as follows:

Overview:
[Describe the main technical concept or system]

Key Components:
[List the main technical components or features]

Implementation Details:
[Summarize important technical specifications]

Requirements:
[List any critical requirements or dependencies]

Recommendations:
[Include any technical recommendations or best practices]`,

            'note': `
Format the summary as follows:

Main Topic:
[State the primary topic or theme]

Key Points:
[List the main points or ideas]

Important Details:
[Include any significant details or examples]

Conclusions:
[Summarize any conclusions or takeaways]`,

            'other': `
Format the summary as follows:

Main Topic:
[Describe the primary subject matter]

Key Points:
[List the main points or arguments]

Important Details:
[Include any significant details or evidence]

Conclusions:
[Summarize the main takeaways]`
        };

        const promptTemplate = typeSpecificPrompts[docType] || typeSpecificPrompts['other'];
        
        return `${basePrompt}

${promptTemplate}

Important: Focus on providing a clear, direct summary of the content. Use bullet points where appropriate for better readability.`;
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
} 