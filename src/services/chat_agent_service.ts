import { App, TFile } from 'obsidian';
import { AIService } from './ai_service';
import { CommandService } from './command_service';
import { FileNavigationService } from './file_navigation_service';
import { MemoryService } from './memory_service';
import { ActionGeneratorService } from './action_generator_service';
import { ProviderService } from './provider_service';
import { UIService } from './ui_service';
import { SettingsService } from './settings_service';

interface DocumentStructure {
    title: string;
    headings: string[];
}

interface DocumentContext {
    previousParagraphs: string[];
    currentHeading: string;
    documentStructure: DocumentStructure;
    sourceFile?: TFile;
    content?: string;
    currentParagraph?: string;
}

interface DocumentMetadata {
    date: string | null;
    author: string | null;
    tags: string[] | null;
    type: 'meeting' | 'research' | 'technical' | 'note' | 'other';
    customFields: Record<string, unknown>;
}

interface DocumentAnalysis {
    relevanceScore: number;
    documentType: 'meeting' | 'research' | 'technical' | 'note' | 'other';
    confidence: number;
    reasoning: string;
}

interface QueryIntent {
    queryType: 'summary' | 'question' | 'search' | 'create' | 'general' | 'format';
    documentType: 'meeting' | 'research' | 'technical' | 'note' | 'other';
    confidence: number;
    expectedMetadata: {
        topic: string;
        keywords?: string[];
        category?: string;
    };
}

interface DocumentMatch {
    file: TFile;
    content: string;
    documentType: string;
    relevanceScore: number;
    metadata: {
        type: string;
        topic: string | null;
        keywords: string[] | null;
    };
}

export class ChatAgentService {
    private lastLogTimestamp = 0;
    private commandService: CommandService;
    private fileNavigationService: FileNavigationService;
    private memoryService: MemoryService;
    private actionGeneratorService: ActionGeneratorService;
    private readonly SYSTEM_PROMPT = "You are a helpful AI assistant that helps users find and understand their documents.";
    private readonly DEFAULT_MODEL = "gpt-4";
    private chatState: {
        currentDocument: TFile | null;
        messageHistory: Array<{
            content: string;
            documentContext?: DocumentContext;
            intent?: any;
            timestamp: number;
        }>;
        lastActiveDocument: TFile | null;
    } = {
        currentDocument: null,
        messageHistory: [],
        lastActiveDocument: null
    };

    // Document type detection cache to avoid repeated analysis
    private documentTypeCache: Map<string, DocumentMetadata> = new Map();

    // Add public method to handle messages
    async handleMessage(message: string, context?: DocumentContext): Promise<string> {
        return this.processMessage(message, context);
    }

    // Add logging utility
    private log(category: string, message: string, data?: Record<string, unknown>) {
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

    private lastCreatedFile: TFile | null = null;

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

    private async findRelevantDocument(
        message: string,
        context?: DocumentContext
    ): Promise<{ content: string; file: TFile; type: string } | null> {
        this.log('Search', 'Looking for relevant document', { query: message });
        
        try {
            // 1. First check if we have a document from current context
            if (context?.sourceFile) {
                const content = context.content || await this.app.vault.read(context.sourceFile);
                this.log('Search', 'Using document from current context', { file: context.sourceFile.basename });
                return {
                    content,
                    file: context.sourceFile,
                    type: this.documentTypeCache.get(context.sourceFile.path)?.type || 'note'
                };
            }

            // 2. Check chat state for current document
            if (this.chatState.currentDocument) {
                const content = await this.app.vault.read(this.chatState.currentDocument);
                this.log('Search', 'Using current document from chat state', { file: this.chatState.currentDocument.basename });
                return {
                    content,
                    file: this.chatState.currentDocument,
                    type: this.documentTypeCache.get(this.chatState.currentDocument.path)?.type || 'note'
                };
            }

            // 3. Check recent messages for document context
            const recentMessages = this.chatState.messageHistory.slice(-3);
            for (const msg of recentMessages) {
                if (msg.documentContext?.sourceFile) {
                    const content = await this.app.vault.read(msg.documentContext.sourceFile);
                    this.log('Search', 'Using document from recent messages', { file: msg.documentContext.sourceFile.basename });
                    return {
                        content,
                        file: msg.documentContext.sourceFile,
                        type: this.documentTypeCache.get(msg.documentContext.sourceFile.path)?.type || 'note'
                    };
                }
            }

            // 4. Only proceed with new document search if the message clearly indicates a different document
            // Check if the message seems to be asking about a specific different document
            const isSearchingNewDoc = /\b(find|search|look for|about|in|the|document|note|called|named|titled)\b/i.test(message) &&
                                    !/\b(it|this|that|the same|previous)\b/i.test(message);

            if (isSearchingNewDoc) {
                // Proceed with regular search
                const files = this.app.vault.getMarkdownFiles();
                
                // Quick initial filtering based on filename
                const candidates = files.filter(file => {
                    const fileName = file.basename.toLowerCase();
                    return this.checkFileRelevance(fileName, message);
                });

                if (candidates.length === 0) {
                    this.log('Search', 'No candidate files found for new search');
                    return null;
                }

                // Sort candidates by initial relevance
                const sortedCandidates = candidates.sort((a, b) => 
                    this.calculateInitialScore(b.basename, message) -
                    this.calculateInitialScore(a.basename, message)
                );

                // Analyze top candidates in detail
                const maxCandidates = 3; // Limit detailed analysis to top 3 candidates
                for (const file of sortedCandidates.slice(0, maxCandidates)) {
                    try {
                        const content = await this.fileNavigationService.readFileContent(file);
                        const contentSample = this.createContentSample(content);
                        
                        const analysisPrompt = `Analyze this document's relevance to the query.
                        Query: "${message}"
                        Content sample: "${contentSample}"
                        
                        Return a JSON object:
                        {
                            "relevanceScore": number (0-1),
                            "documentType": "meeting" | "research" | "technical" | "note" | "other",
                            "confidence": number (0-1),
                            "reasoning": string
                        }`;

                        const documentContext: DocumentContext = {
                            previousParagraphs: [],
                            currentHeading: '',
                            documentStructure: {
                                title: file.basename,
                                headings: []
                            },
                            sourceFile: file,
                            content: content
                        };

                        const analysisResult = await this.aiService.generateContent(
                            analysisPrompt,
                            documentContext,
                            { response_format: { type: "json_object" } }
                        );

                        const analysis: DocumentAnalysis = JSON.parse(analysisResult);

                        if (analysis.relevanceScore > 0.7 && analysis.confidence > 0.7) {
                            this.log('Search', 'Found relevant document', {
                                file: file.basename,
                                type: analysis.documentType,
                                score: analysis.relevanceScore
                            });

                            // Cache the document type
                            this.documentTypeCache.set(file.path, {
                                type: analysis.documentType,
                                date: null,
                                author: null,
                                tags: [],
                                customFields: {}
                            });

                            return {
                                content,
                                file,
                                type: analysis.documentType
                            };
                        }
                    } catch (error) {
                        this.log('Error', 'Error analyzing candidate', { 
                            error,
                            file: file.basename 
                        });
                        continue; // Continue with next candidate if one fails
                    }
                }

                this.log('Search', 'No relevant documents found after analysis');
                return null;
            } else {
                this.log('Search', 'No clear indication of new document search, using last discussed document');
                return null; // Will fall back to last discussed document in the intent handlers
            }
        } catch (error) {
            this.log('Error', 'Error finding relevant document', { error });
            return null;
        }
    }

    /**
     * Creates a representative sample of the document content
     */
    private createContentSample(content: string): string {
        // Split content into lines
        const lines = content.split('\n');
        
        // Get document sections
        const beginning = lines.slice(0, 5).join('\n');
        const middle = lines.length > 10 
            ? lines.slice(Math.floor(lines.length / 2) - 2, Math.floor(lines.length / 2) + 3).join('\n')
            : '';
        const end = lines.length > 5 
            ? lines.slice(-5).join('\n')
            : '';

        // Extract headings
        const headings = lines
            .filter(line => line.trim().startsWith('#'))
            .slice(0, 3)
            .join('\n');

        // Combine samples with clear separation
        return `Start:
${beginning}

Key headings:
${headings}

Middle section:
${middle}

End section:
${end}`.slice(0, 1500); // Limit sample size
    }

    private async analyzeQueryIntent(message: string): Promise<QueryIntent | null> {
        try {
            const prompt = `Analyze what type of request this message represents.
            Message: "${message}"
            
            Return a JSON object:
            {
                "queryType": "summary" | "question" | "search" | "create" | "general" | "format",
                "documentType": "meeting" | "research" | "technical" | "note" | "other",
                "confidence": number (0-1),
                "expectedMetadata": {
                    "topic": string,
                    "keywords": string[],
                    "category": string
                }
            }
            
            Examples:
            - "summarize the meeting notes from yesterday" -> summary + meeting
            - "what did we discuss about AI research?" -> question + research
            - "find documents about project planning" -> search + technical
            - "create a new note about machine learning basics" -> create + research
            - "format this note" -> format + note
            `;

            const analysisResult = await this.aiService.generateContent(
                prompt,
                undefined,
                { response_format: { type: "json_object" } }
            );

            const analysis: QueryIntent = JSON.parse(analysisResult);
            return analysis;
        } catch (error) {
            this.log('Error', 'Error analyzing query intent', { error });
            return null;
        }
    }

    private async filterCandidateFiles(
        files: TFile[],
        queryIntent: QueryIntent,
        message: string
    ): Promise<TFile[]> {
        const normalizedQuery = message.toLowerCase();
        const keywords = queryIntent.expectedMetadata.keywords || [];
        const topic = queryIntent.expectedMetadata.topic;

        // Add topic words to keywords if present
        if (topic) {
            keywords.push(...topic.toLowerCase().split(/\s+/));
        }

        // First pass: Quick filtering based on filename and frontmatter
        const candidates = files.filter(file => {
            // Check filename
            const fileName = file.basename.toLowerCase();
            if (this.checkFileRelevance(fileName, normalizedQuery)) {
                return true;
            }

            // Check frontmatter cache if available
            const cachedMetadata = this.documentTypeCache.get(file.path);
            if (cachedMetadata) {
                if (cachedMetadata.type === queryIntent.documentType) {
                    return true;
                }
                if (cachedMetadata.tags?.some(tag => keywords.includes(tag.toLowerCase()))) {
                    return true;
                }
            }

            return false;
        });

        // Sort candidates by initial relevance
        return candidates.sort((a, b) => 
            this.calculateInitialScore(b.basename, normalizedQuery) -
            this.calculateInitialScore(a.basename, normalizedQuery)
        );
    }

    private async analyzeDocument(
        file: TFile,
        queryIntent: QueryIntent,
        message: string
    ): Promise<DocumentMatch | null> {
        try {
            // Check cache first
            const cachedMetadata = this.documentTypeCache.get(file.path);
            const content = await this.fileNavigationService.readFileContent(file);
            const contentSample = this.createContentSample(content);

            // Prepare analysis prompt
            const analysisPrompt = `Analyze this document's relevance to the query.

Query: "${message}"
Expected type: ${queryIntent.documentType}
Expected topic: ${queryIntent.expectedMetadata.topic || 'any'}
Expected keywords: ${queryIntent.expectedMetadata.keywords ? JSON.stringify(queryIntent.expectedMetadata.keywords) : 'any'}

${cachedMetadata ? `Previously detected type: ${cachedMetadata.type}` : ''}

Content sample: "${contentSample}"

Return a JSON object:
{
    "relevanceScore": number (0-1),
    "documentType": "meeting" | "research" | "technical" | "note" | "other",
    "topicMatch": number (0-1),
    "keywordMatches": number,
    "confidence": number (0-1)
}`;

            const documentContext: DocumentContext = {
                previousParagraphs: [],
                currentHeading: '',
                documentStructure: {
                    title: file.basename,
                    headings: []
                },
                sourceFile: file,
                content: content
            };

            const analysisResult = await this.aiService.generateContent(
                analysisPrompt,
                documentContext,
                { response_format: { type: "json_object" } }
            );

            const analysis: DocumentAnalysis = JSON.parse(analysisResult);

            // Cache the document type if confidence is high
            if (analysis.confidence > 0.8) {
                this.documentTypeCache.set(file.path, {
                    type: analysis.documentType,
                    date: null,
                    author: null,
                    tags: queryIntent.expectedMetadata.keywords || [],
                    customFields: {}
                });
            }

            // Calculate final relevance score
            const finalScore = this.calculateFinalScore(analysis, queryIntent);

            return {
                file,
                content,
                documentType: analysis.documentType,
                relevanceScore: finalScore,
                metadata: {
                    type: analysis.documentType,
                    topic: queryIntent.expectedMetadata.topic,
                    keywords: queryIntent.expectedMetadata.keywords
                }
            };
        } catch (error) {
            this.log('Error', 'Error analyzing document', { error, file: file.basename });
            return null;
        }
    }

    private calculateFinalScore(analysis: DocumentAnalysis, queryIntent: QueryIntent): number {
        let score = analysis.relevanceScore;

        // Boost score if document type matches exactly
        if (analysis.documentType === queryIntent.documentType) {
            score *= 1.2;
        }

        // Boost score based on confidence
        score *= (1 + analysis.confidence * 0.3);

        // Cap final score at 1
        return Math.min(score, 1);
    }

    private chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    private checkFileRelevance(fileName: string, query: string): boolean {
        const normalizedFileName = fileName.toLowerCase();
        const normalizedQuery = query.toLowerCase();
        
        // Split into significant words
        const queryWords = normalizedQuery.split(/\s+/).filter(word => 
            word.length > 2 && 
            !['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with'].includes(word)
        );

        // Check if any significant words are in the filename
        return queryWords.some(word => normalizedFileName.includes(word));
    }

    private calculateInitialScore(fileName: string, query: string): number {
        let score = 0;
        const normalizedFileName = fileName.toLowerCase();
        const normalizedQuery = query.toLowerCase();
        
        // Split into words and filter out common words
        const fileWords = normalizedFileName.split(/[\s-_]+/);
        const queryWords = normalizedQuery.split(/\s+/).filter(word => 
            word.length > 2 && 
            !['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with'].includes(word)
        );

        // Check for exact filename match
        if (normalizedFileName === normalizedQuery) {
            score += 1;
        }

        // Check for filename containing the entire query
        if (normalizedFileName.includes(normalizedQuery)) {
            score += 0.8;
        }

        // Check for individual word matches
        const matchingWords = queryWords.filter(word => fileWords.some(fw => fw.includes(word)));
        score += (matchingWords.length / queryWords.length) * 0.6;

        // Bonus for matching words in order
        const queryRegex = new RegExp(queryWords.join('.*'), 'i');
        if (queryRegex.test(normalizedFileName)) {
            score += 0.3;
        }

        return score;
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
            // First analyze the query intent
            const queryIntent = await this.analyzeQueryIntent(message);
            if (!queryIntent) {
                return "I'm having trouble understanding what you'd like me to do. Could you please rephrase your request?";
            }

            this.log('Process', 'Query intent analyzed', {
                type: queryIntent.documentType,
                confidence: queryIntent.confidence,
                topic: queryIntent.expectedMetadata.topic
            });

            // Try to find a relevant document based on the message
            const relevantDoc = await this.findRelevantDocument(message, context);
            
            // Create or update context with the found document
            if (relevantDoc) {
                this.log('Process', 'Found relevant document', { 
                    file: relevantDoc.file.basename,
                    type: relevantDoc.type,
                    matchedFrom: context?.sourceFile === relevantDoc.file ? 'context' : 'search'
                });
                
                context = {
                    previousParagraphs: [],
                    currentHeading: '',
                    documentStructure: {
                        title: relevantDoc.file.basename,
                        headings: []
                    },
                    sourceFile: relevantDoc.file,
                    content: relevantDoc.content,
                    currentParagraph: relevantDoc.content
                };
            } else {
                this.log('Process', 'No relevant document found for query');
            }

            // Handle different types of intents with the updated context
            switch (queryIntent.queryType) {
                case 'summary':
                    return this.handleSummarizeIntent(message, context || {
                        previousParagraphs: [],
                        currentHeading: '',
                        documentStructure: {
                            title: '',
                            headings: []
                        }
                    }, queryIntent);
                case 'question':
                    return this.handleQuestionIntent(message, context || {
                        previousParagraphs: [],
                        currentHeading: '',
                        documentStructure: {
                            title: '',
                            headings: []
                        }
                    }, queryIntent);
                case 'search':
                    return this.handleSearchIntent(message, context || {
                        previousParagraphs: [],
                        currentHeading: '',
                        documentStructure: {
                            title: '',
                            headings: []
                        }
                    }, queryIntent);
                case 'create':
                    return this.handleCreateIntent(message, context || {
                        previousParagraphs: [],
                        currentHeading: '',
                        documentStructure: {
                            title: '',
                            headings: []
                        }
                    }, queryIntent);
                case 'format':
                    return this.handleFormatIntent(message, context || {
                        previousParagraphs: [],
                        currentHeading: '',
                        documentStructure: {
                            title: '',
                            headings: []
                        }
                    }, queryIntent);
                default:
                    return this.handleGeneralIntent(message, context || {
                        previousParagraphs: [],
                        currentHeading: '',
                        documentStructure: {
                            title: '',
                            headings: []
                        }
                    }, queryIntent);
            }
        } catch (error) {
            this.log('Error', 'Message processing failed', { error });
            return `I encountered an error while processing your request: ${error.message}`;
        }
    }

    private async handleSearchIntent(
        message: string,
        context: DocumentContext,
        intent: QueryIntent
    ): Promise<string> {
        this.log('Search', 'Handling search intent', { 
            message,
            hasContext: !!context,
            intent: intent.documentType
        });

        try {
            const relevantDoc = await this.findRelevantDocument(message, context);
            if (!relevantDoc) {
                return "I couldn't find any relevant documents matching your search.";
            }

            return `I found a relevant ${relevantDoc.type} document: "${relevantDoc.file.basename}". Would you like me to summarize it or answer specific questions about it?`;
        } catch (error) {
            this.log('Error', 'Error handling search intent', { error });
            return `I encountered an error while searching: ${error.message}`;
        }
    }

    private async handleGeneralIntent(
        message: string,
        context: DocumentContext,
        intent: QueryIntent
    ): Promise<string> {
        this.log('General', 'Handling general intent', { 
            message,
            hasContext: !!context,
            intent: intent.documentType
        });

        try {
            if (context?.sourceFile) {
                return `I understand you're working with "${context.sourceFile.basename}". What would you like to know about it?`;
            } else {
                return "I'm not sure what you'd like me to do. Could you please be more specific about what you're looking for?";
            }
        } catch (error) {
            this.log('Error', 'Error handling general intent', { error });
            return `I encountered an error: ${error.message}`;
        }
    }

    private async handleSummarizeIntent(
        message: string,
        context: DocumentContext,
        intent: QueryIntent
    ): Promise<string> {
        this.log('Summary', 'Handling summarize intent', { 
            message,
            hasContext: !!context,
            intent: intent.documentType
        });

        try {
            // First try to find the relevant document
            const documentInfo = await this.findRelevantDocument(message, context);
            
            if (!documentInfo) {
                this.log('Summary', 'No document found to summarize');
                return "I couldn't find the document to summarize. Could you please specify which document you'd like me to summarize?";
            }

            const { content, file, type } = documentInfo;
            
            this.log('Summary', 'Found document to summarize', {
                file: file.basename,
                type: type
            });

            const contentSample = this.createContentSample(content);
            
            const summaryPrompt = `Create a concise summary of this ${type} document.
            
Document: "${contentSample}"

Focus on:
1. Main points and key findings
2. Important conclusions
3. Any action items or next steps (if applicable)

Keep the summary clear and to-the-point.`;

            const summary = await this.aiService.generateContent(
                summaryPrompt,
                {
                    previousParagraphs: [content],
                    currentHeading: '',
                    documentStructure: {
                        title: file.basename,
                        headings: []
                    },
                    sourceFile: file,
                    content: content
                }
            );

            // Update chat state with the current document
            this.chatState.currentDocument = file;
            this.chatState.messageHistory.push({
                content: message,
                documentContext: {
                    sourceFile: file,
                    content: content,
                    currentHeading: '',
                    previousParagraphs: [],
                    documentStructure: {
                        title: file.basename,
                        headings: []
                    }
                },
                intent: intent,
                timestamp: Date.now()
            });

            return summary;
        } catch (error) {
            this.log('Error', 'Error handling summarize intent', { error });
            throw error; // Let the error propagate up to be handled by the main error handler
        }
    }

    private async handleQuestionIntent(
        message: string,
        context: DocumentContext,
        intent: QueryIntent
    ): Promise<string> {
        this.log('Question', 'Handling question intent', { 
            message,
            hasContext: !!context,
            intent: intent.documentType
        });

        try {
            if (!context?.sourceFile || !context?.content) {
                return "I couldn't find the relevant document to answer your question. Could you please provide more context?";
            }

            const contentSample = this.createContentSample(context.content);
            
            const answerPrompt = `Answer this question about the document: "${message}"

Document content: "${contentSample}"

Provide a clear and specific answer based on the document content. If the answer cannot be found in the document, say so.`;

            const answer = await this.aiService.generateContent(
                answerPrompt,
                context
            );

            return answer;
        } catch (error) {
            this.log('Error', 'Error handling question intent', { error });
            return `I encountered an error while answering your question: ${error.message}`;
        }
    }

    private async handleCreateIntent(
        message: string,
        context: DocumentContext,
        intent: QueryIntent
    ): Promise<string> {
        this.log('Create', 'Handling create intent', { 
            message,
            type: intent.documentType,
            topic: intent.expectedMetadata.topic
        });

        try {
            // Generate a suitable filename
            const sanitizedTopic = intent.expectedMetadata.topic
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '');
            
            const fileName = `${sanitizedTopic}.md`;
            
            // Check if file already exists
            const existingFile = this.app.vault.getAbstractFileByPath(fileName);
            if (existingFile) {
                return `A note with the name "${fileName}" already exists. Please choose a different name or modify the existing note.`;
            }

            // Generate content for the new note
            const contentPrompt = `Create content for a new ${intent.documentType} note about "${intent.expectedMetadata.topic}".
            Include:
            1. A clear title as a level 1 heading
            2. A brief introduction/overview
            3. Main sections with level 2 headings
            4. Key points or concepts as bullet points
            5. References or related topics (if applicable)
            6. Tags in YAML frontmatter
            
            Format in clean, well-structured Markdown with proper YAML frontmatter.`;

            const content = await this.aiService.generateContent(contentPrompt);

            try {
                // Create the file in the root of the vault
                const file = await this.app.vault.create(fileName, content);
                this.lastCreatedFile = file;
                
                // Open the newly created file
                const leaf = this.app.workspace.getLeaf(false);
                await leaf.openFile(file);

                this.log('Create', 'Created new note', { 
                    file: file.basename,
                    type: intent.documentType,
                    topic: intent.expectedMetadata.topic
                });

                return `I've created a new note "${file.basename}" about ${intent.expectedMetadata.topic} and opened it for you.`;
            } catch (fileError) {
                this.log('Error', 'Error creating file', { fileError });
                return `I couldn't create the note. Error: ${fileError.message}`;
            }
        } catch (error) {
            this.log('Error', 'Error in create intent handler', { error });
            return `I encountered an error while creating the note: ${error.message}`;
        }
    }

    private async handleFormatIntent(
        message: string,
        context: DocumentContext,
        intent: QueryIntent
    ): Promise<string> {
        const sourceFile = context?.sourceFile;
        if (!sourceFile) {
            return "I'm not sure which note you'd like me to format. Could you specify the note or create a new one first?";
        }

        try {
            const content = await this.app.vault.read(sourceFile);
            
            // Use the new formatMarkdownContent method
            const improvedContent = await this.aiService.formatMarkdownContent(content);
            
            // Update the file with improved formatting
            await this.app.vault.modify(sourceFile, improvedContent);
            
            // Open the formatted file
            const leaf = this.app.workspace.getLeaf();
            await leaf.openFile(sourceFile);

            return "I've improved the formatting of your note to ensure proper rendering in Obsidian. The note is now open for your review.";
        } catch (error) {
            console.error('Error formatting note:', error);
            return "I encountered an error while trying to format the note. Please try again or check the console for details.";
        }
    }
}