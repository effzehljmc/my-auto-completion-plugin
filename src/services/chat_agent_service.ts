import { App, TFile, TFolder } from 'obsidian';
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
    queryType: 'summary' | 'question' | 'search' | 'create' | 'rename' | 'format' | 'move' | 'style' | 'general';
    documentType: 'meeting' | 'research' | 'technical' | 'note' | 'other';
    confidence: number;
    expectedMetadata: {
        topic: string;
        keywords?: string[];
        category?: string;
        newName?: string | null;
        targetFolder?: string | null;
        styleAction?: 'citations' | 'toc' | 'sections' | 'frontmatter' | 'all' | null;
        styleOptions?: {
            citationStyle?: string;
            tocDepth?: number;
            frontmatterFields?: string[];
        };
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

    private async findRelevantDocuments(
        message: string,
        context?: DocumentContext,
        maxResults = 5
    ): Promise<Array<{ content: string; file: TFile; type: string; relevance: number }>> {
        this.log('Search', 'Looking for relevant documents', { query: message, maxResults });
        
        try {
            // Get all markdown files
            const files = this.app.vault.getMarkdownFiles();
            
            // Quick initial filtering based on filename
            const candidates = files.filter(file => {
                const fileName = file.basename.toLowerCase();
                return this.checkFileRelevance(fileName, message);
            });

            if (candidates.length === 0) {
                this.log('Search', 'No candidate files found');
                return [];
            }

            // Sort candidates by initial relevance
            const sortedCandidates = candidates.sort((a, b) => 
                this.calculateInitialScore(b.basename, message) -
                this.calculateInitialScore(a.basename, message)
            );

            const results: Array<{ content: string; file: TFile; type: string; relevance: number }> = [];

            // Analyze top candidates in detail
            const maxCandidates = Math.min(10, sortedCandidates.length); // Analyze up to 10 candidates
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

                    if (analysis.relevanceScore > 0.5) { // Lower threshold for multiple results
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

                        results.push({
                            content,
                            file,
                            type: analysis.documentType,
                            relevance: analysis.relevanceScore
                        });

                        if (results.length >= maxResults) {
                            break;
                        }
                    }
                } catch (error) {
                    this.log('Error', 'Error analyzing candidate', { 
                        error,
                        file: file.basename 
                    });
                    continue;
                }
            }

            // Sort results by relevance
            return results.sort((a, b) => b.relevance - a.relevance);
        } catch (error) {
            this.log('Error', 'Error finding relevant documents', { error });
            return [];
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
                "queryType": "summary" | "question" | "search" | "create" | "rename" | "move" | "style" | "format" | "general",
                "documentType": "meeting" | "research" | "technical" | "note" | "other",
                "confidence": number (0-1),
                "expectedMetadata": {
                    "topic": string,
                    "keywords": string[],
                    "category": string,
                    "newName": string | null,
                    "targetFolder": string | null,
                    "styleAction": "citations" | "toc" | "sections" | "frontmatter" | "all" | null,
                    "styleOptions": {
                        "citationStyle": string | null,
                        "tocDepth": number | null,
                        "frontmatterFields": string[] | null
                    }
                }
            }
            
            Examples:
            - "summarize the meeting notes from yesterday" -> summary + meeting
            - "what did we discuss about AI research?" -> question + research
            - "find documents about project planning" -> search + technical
            - "create a new note about machine learning basics" -> create + research
            - "rename document X to Y" -> rename + type of document
            - "move this note to the research folder" -> move + note
            - "add citations to this document" -> style + note (styleAction: "citations")
            - "create a table of contents" -> style + note (styleAction: "toc")
            - "organize content into sections" -> style + note (styleAction: "sections")
            - "add YAML frontmatter" -> style + note (styleAction: "frontmatter")
            - "format this note" -> format + note
            - "what can I do to improve this note" -> style + note (styleAction: "all")
            - "suggest improvements for this document" -> style + note (styleAction: "all")
            - "help me organize this content better" -> style + note (styleAction: "sections")
            - "what actions are available for this document" -> style + note (styleAction: "all")`;

            // Pre-process the message to detect improvement-related queries
            const normalizedMessage = message.toLowerCase();
            if (
                normalizedMessage.includes('what can i do to improve') ||
                normalizedMessage.includes('suggest improvements') ||
                normalizedMessage.includes('help me organize') ||
                normalizedMessage.includes('what actions are available')
            ) {
                // Override as a style intent for improvement queries
                return {
                    queryType: 'style',
                    documentType: 'note',
                    confidence: 0.9,
                    expectedMetadata: {
                        topic: 'document improvements',
                        keywords: ['improve', 'organize', 'suggestions'],
                        category: 'improvement',
                        newName: null,
                        targetFolder: null,
                        styleAction: 'all',
                        styleOptions: {
                            citationStyle: null,
                            tocDepth: null,
                            frontmatterFields: null
                        }
                    }
                };
            }

            const analysisResult = await this.aiService.generateContent(
                prompt,
                undefined,
                { response_format: { type: "json_object" } }
            );

            const analysis = JSON.parse(analysisResult);
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
            const relevantDoc = await this.findRelevantDocuments(message, context);
            
            // Create or update context with the found document
            if (relevantDoc.length > 0) {
                this.log('Process', 'Found relevant documents', { 
                    files: relevantDoc.map(doc => doc.file.basename),
                    types: relevantDoc.map(doc => doc.type),
                    matchedFrom: context?.sourceFile ? 'context' : 'search'
                });
                
                context = {
                    previousParagraphs: [],
                    currentHeading: '',
                    documentStructure: {
                        title: relevantDoc[0].file.basename,
                        headings: []
                    },
                    sourceFile: relevantDoc[0].file,
                    content: relevantDoc[0].content,
                    currentParagraph: relevantDoc[0].content
                };
            } else {
                this.log('Process', 'No relevant documents found for query');
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
                case 'rename':
                    return this.handleRenameIntent(message, context || {
                        previousParagraphs: [],
                        currentHeading: '',
                        documentStructure: {
                            title: '',
                            headings: []
                        }
                    }, queryIntent);
                case 'move':
                    return this.handleMoveIntent(message, context || {
                        previousParagraphs: [],
                        currentHeading: '',
                        documentStructure: {
                            title: '',
                            headings: []
                        }
                    }, queryIntent);
                case 'style':
                    return this.handleStyleIntent(message, context || {
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
            const relevantDocs = await this.findRelevantDocuments(message, context);
            if (relevantDocs.length === 0) {
                return "I couldn't find any relevant documents matching your search.";
            }

            // Format results into a clear response
            const formattedResults = relevantDocs.map((doc, index) => {
                const relevancePercent = Math.round(doc.relevance * 100);
                return `${index + 1}. [[${doc.file.basename}]] (${doc.type}, ${relevancePercent}% relevant)`;
            }).join('\n');

            return `I found ${relevantDocs.length} relevant document${relevantDocs.length > 1 ? 's' : ''}:\n\n${formattedResults}\n\nWould you like me to summarize any of these documents or answer specific questions about them?`;
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
            if (!context?.sourceFile || !context?.content) {
                return "I couldn't find the document to summarize. Could you please specify which document you'd like me to summarize?";
            }

            const contentSample = this.createContentSample(context.content);
            
            const summaryPrompt = `Create a concise summary of this ${intent.documentType} document.
            
Document: "${contentSample}"

Focus on:
1. Main points and key findings
2. Important conclusions
3. Any action items or next steps (if applicable)

Keep the summary clear and to-the-point.`;

            const summary = await this.aiService.generateContent(
                summaryPrompt,
                context
            );

            return summary;
        } catch (error) {
            this.log('Error', 'Error handling summarize intent', { error });
            return `I encountered an error while summarizing: ${error.message}`;
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

    private async handleRenameIntent(
        message: string,
        context: DocumentContext,
        intent: QueryIntent
    ): Promise<string> {
        this.log('Rename', 'Handling rename intent', { 
            message,
            hasContext: !!context,
            intent: intent.documentType
        });

        try {
            if (!context?.sourceFile) {
                return "I couldn't find the file you want to rename. Could you specify which file you'd like to rename?";
            }

            const newName = intent.expectedMetadata.newName;
            if (!newName) {
                return "I couldn't determine the new name for the file. Could you please specify the new name clearly?";
            }

            // Ensure the new name has a .md extension
            const newNameWithExtension = newName.endsWith('.md') ? newName : `${newName}.md`;

            try {
                // Use Obsidian's API to rename the file
                await this.app.fileManager.renameFile(
                    context.sourceFile,
                    `${newNameWithExtension}`
                );

                return `I've renamed the file to "${newName}".`;
            } catch (renameError) {
                this.log('Error', 'Failed to rename file', { error: renameError });
                return `I encountered an error while trying to rename the file: ${renameError.message}`;
            }
        } catch (error) {
            this.log('Error', 'Error handling rename intent', { error });
            return `I encountered an error: ${error.message}`;
        }
    }

    private async handleMoveIntent(
        message: string,
        context: DocumentContext,
        intent: QueryIntent
    ): Promise<string> {
        this.log('Move', 'Handling move intent', { 
            message,
            hasContext: !!context,
            intent: intent.documentType
        });

        try {
            if (!context?.sourceFile) {
                return "I couldn't find the file you want to move. Could you specify which file you'd like to move?";
            }

            const targetFolder = intent.expectedMetadata.targetFolder;
            if (!targetFolder) {
                return "I couldn't determine which folder to move the file to. Could you please specify the target folder?";
            }

            try {
                // Get all folders in the vault
                const folders = this.app.vault.getAllLoadedFiles()
                    .filter((f): f is TFolder => f instanceof TFolder)
                    .map(f => f.path);

                // Find the best matching folder
                const normalizedTarget = targetFolder.toLowerCase();
                const matchingFolder = folders.find(f => 
                    f.toLowerCase().includes(normalizedTarget) ||
                    f.toLowerCase().split('/').pop() === normalizedTarget
                );

                if (!matchingFolder) {
                    // If folder doesn't exist, create it
                    const newFolderPath = targetFolder;
                    try {
                        await this.app.vault.createFolder(newFolderPath);
                        this.log('Move', 'Created new folder', { path: newFolderPath });
                    } catch (folderError) {
                        this.log('Error', 'Failed to create folder', { error: folderError });
                        return `I couldn't create the folder "${targetFolder}". The folder might already exist or there might be permission issues.`;
                    }
                }

                // Construct the new path
                const newPath = `${matchingFolder || targetFolder}/${context.sourceFile.name}`;

                // Move the file using renameFile (which also handles moving)
                await this.app.fileManager.renameFile(
                    context.sourceFile,
                    newPath
                );

                return `I've moved "${context.sourceFile.basename}" to the ${targetFolder} folder.`;
            } catch (moveError) {
                this.log('Error', 'Failed to move file', { error: moveError });
                return `I encountered an error while trying to move the file: ${moveError.message}`;
            }
        } catch (error) {
            this.log('Error', 'Error handling move intent', { error });
            return `I encountered an error: ${error.message}`;
        }
    }

    private async handleStyleIntent(
        message: string,
        context: DocumentContext,
        intent: QueryIntent
    ): Promise<string> {
        this.log('Style', 'Handling style intent', { 
            message,
            hasContext: !!context,
            intent: intent.documentType,
            styleAction: intent.expectedMetadata.styleAction
        });

        try {
            if (!context?.sourceFile) {
                return "I couldn't find the file you want to style. Could you specify which file you'd like to modify?";
            }

            const content = await this.app.vault.read(context.sourceFile);
            let modifiedContent = content;
            const styleAction = intent.expectedMetadata.styleAction;

            // Handle document analysis commands
            if (message.toLowerCase().includes('what can i do') || 
                message.toLowerCase().includes('actions are available')) {
                return await this.analyzeDocumentCapabilities(context.sourceFile, content);
            }

            // Handle improvement suggestions
            if (message.toLowerCase().includes('suggest improvements') || 
                message.toLowerCase().includes('help me organize')) {
                return await this.suggestDocumentImprovements(context.sourceFile, content);
            }

            switch (styleAction) {
                case 'citations':
                    modifiedContent = await this.addCitations(content);
                    break;
                case 'toc':
                    modifiedContent = await this.addTableOfContents(content, intent.expectedMetadata.styleOptions?.tocDepth);
                    break;
                case 'sections':
                    modifiedContent = await this.organizeSections(content);
                    break;
                case 'frontmatter':
                    modifiedContent = await this.addFrontmatter(content, intent.expectedMetadata.styleOptions?.frontmatterFields);
                    break;
                case 'all':
                    modifiedContent = await this.applyAllStyles(content);
                    break;
                default:
                    return "I'm not sure what kind of styling you'd like me to apply. Could you specify if you want citations, table of contents, sections, or frontmatter?";
            }

            // Update the file with the modified content
            await this.app.vault.modify(context.sourceFile, modifiedContent);

            // Open the styled file
            const leaf = this.app.workspace.getLeaf();
            await leaf.openFile(context.sourceFile);

            const actionMap = {
                'citations': 'added proper citations to',
                'toc': 'added a table of contents to',
                'sections': 'organized the content into sections in',
                'frontmatter': 'added YAML frontmatter to',
                'all': 'applied all styling improvements to'
            };

            return `I've ${actionMap[styleAction] || 'styled'} "${context.sourceFile.basename}". The file is now open for your review.`;
        } catch (error) {
            this.log('Error', 'Error handling style intent', { error });
            return `I encountered an error: ${error.message}`;
        }
    }

    private async analyzeDocumentCapabilities(file: TFile, content: string): Promise<string> {
        const prompt = `Analyze this document and list all possible actions that could be taken to improve or work with it.
        Consider the document's current state and structure.
        
        Document Title: ${file.basename}
        Content:
        ${content}
        
        Return a JSON object with this structure:
        {
            "currentFeatures": string[],
            "possibleImprovements": string[],
            "recommendedActions": string[],
            "documentType": string,
            "complexity": "low" | "medium" | "high"
        }`;

        try {
            const analysisResult = await this.aiService.generateContent(
                prompt,
                undefined,
                { response_format: { type: "json_object" } }
            );

            const analysis = JSON.parse(analysisResult);

            return `Here's what you can do with "${file.basename}":

Current Features:
${analysis.currentFeatures.map((f: string) => `- ${f}`).join('\n')}

Possible Improvements:
${analysis.possibleImprovements.map((i: string) => `- ${i}`).join('\n')}

Recommended Actions:
${analysis.recommendedActions.map((a: string) => `- ${a}`).join('\n')}

This appears to be a ${analysis.complexity} complexity ${analysis.documentType.toLowerCase()} document.

Would you like me to help you implement any of these improvements?`;
        } catch (error) {
            this.log('Error', 'Error analyzing document capabilities', { error });
            return "I encountered an error while analyzing the document's capabilities. Please try again.";
        }
    }

    private async suggestDocumentImprovements(file: TFile, content: string): Promise<string> {
        const prompt = `Analyze this document and suggest specific improvements for better organization and clarity.
        Consider structure, formatting, content organization, and metadata.
        
        Document Title: ${file.basename}
        Content:
        ${content}
        
        Return a JSON object with this structure:
        {
            "structuralImprovements": {
                "description": string,
                "suggestions": string[]
            },
            "contentOrganization": {
                "description": string,
                "suggestions": string[]
            },
            "metadata": {
                "description": string,
                "suggestions": string[]
            },
            "formatting": {
                "description": string,
                "suggestions": string[]
            },
            "priority": "high" | "medium" | "low"
        }`;

        try {
            const analysisResult = await this.aiService.generateContent(
                prompt,
                undefined,
                { response_format: { type: "json_object" } }
            );

            const analysis = JSON.parse(analysisResult);

            return `I've analyzed "${file.basename}" and here are my suggestions for improvement:

Structure:
${analysis.structuralImprovements.description}
${analysis.structuralImprovements.suggestions.map((s: string) => `- ${s}`).join('\n')}

Content Organization:
${analysis.contentOrganization.description}
${analysis.contentOrganization.suggestions.map((s: string) => `- ${s}`).join('\n')}

Metadata:
${analysis.metadata.description}
${analysis.metadata.suggestions.map((s: string) => `- ${s}`).join('\n')}

Formatting:
${analysis.formatting.description}
${analysis.formatting.suggestions.map((s: string) => `- ${s}`).join('\n')}

These improvements are considered ${analysis.priority} priority. Would you like me to help you implement any of these changes?`;
        } catch (error) {
            this.log('Error', 'Error suggesting improvements', { error });
            return "I encountered an error while analyzing potential improvements. Please try again.";
        }
    }

    private async addCitations(content: string): Promise<string> {
        const prompt = `Add proper academic citations to this document. Identify references and add citations in a consistent format.
        Original content:
        ${content}
        
        Return the content with proper citations added. Use a consistent citation style and add a References section at the end.`;

        return this.aiService.generateContent(prompt);
    }

    private async addTableOfContents(content: string, depth = 3): Promise<string> {
        const prompt = `Create a table of contents for this document and add it after the frontmatter (if any) and before the main content.
        Maximum heading depth: ${depth}
        Original content:
        ${content}
        
        Return the content with a properly formatted table of contents added.`;

        return this.aiService.generateContent(prompt);
    }

    private async organizeSections(content: string): Promise<string> {
        const prompt = `Organize this content into logical sections with proper headings and structure.
        Original content:
        ${content}
        
        Return the content organized into clear sections with appropriate heading levels and consistent formatting.`;

        return this.aiService.generateContent(prompt);
    }

    private async addFrontmatter(content: string, fields?: string[]): Promise<string> {
        const defaultFields = ['title', 'date', 'tags', 'type', 'status'];
        const targetFields = fields || defaultFields;

        const prompt = `Add YAML frontmatter to this document including these fields: ${targetFields.join(', ')}.
        Extract relevant information from the content where possible.
        Original content:
        ${content}
        
        Return the content with proper YAML frontmatter added at the top.`;

        return this.aiService.generateContent(prompt);
    }

    private async applyAllStyles(content: string): Promise<string> {
        // Apply all styling improvements in a specific order
        let modifiedContent = content;
        
        // 1. First add frontmatter (if not present)
        modifiedContent = await this.addFrontmatter(modifiedContent);
        
        // 2. Then organize into sections
        modifiedContent = await this.organizeSections(modifiedContent);
        
        // 3. Add table of contents after frontmatter
        modifiedContent = await this.addTableOfContents(modifiedContent);
        
        // 4. Finally add citations
        modifiedContent = await this.addCitations(modifiedContent);
        
        return modifiedContent;
    }
}