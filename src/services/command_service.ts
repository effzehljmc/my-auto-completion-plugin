import { App } from 'obsidian';
import { AIService, DocumentContext } from './ai_service';
import { FileNavigationService } from './file_navigation_service';
import { MemoryService } from './memory_service';

export interface Command {
    name: string;
    description: string;
    usage: string;
    examples: string[];
    execute: (context: DocumentContext, args?: string[]) => Promise<string>;
}

export interface CommandParseResult {
    command: Command;
    args: string[];
    confidence: number;
}

export class CommandService {
    private commands: Map<string, Command> = new Map();
    private readonly CONFIDENCE_THRESHOLD = 0.7;

    constructor(
        private app: App,
        private aiService: AIService,
        private fileNavigationService: FileNavigationService,
        private memoryService: MemoryService
    ) {
        this.registerDefaultCommands();
    }

    private registerDefaultCommands() {
        this.commands.set('format', {
            name: 'Format',
            description: 'Format the current document according to specified style',
            usage: '/format [style]',
            examples: [
                '/format markdown',
                '/format academic',
                '/format clean'
            ],
            execute: async (context, args) => {
                if (!context.sourceFile) {
                    return "Please open a document to format.";
                }

                try {
                    const style = args?.[0] || 'markdown';
                    const content = await this.fileNavigationService.readFileContent(context.sourceFile);
                    
                    // Get formatting suggestions from AI
                    const formattedContent = await this.aiService.generateContent(
                        `Format this content in ${style} style, maintaining the original information but improving:
                        - Heading structure
                        - Paragraph organization
                        - List formatting
                        - Code block formatting
                        - Link and reference formatting
                        
                        Original content:
                        ${content}`,
                        context
                    );

                    await this.fileNavigationService.modifyFile(context.sourceFile, formattedContent);
                    return `Document formatted successfully using ${style} style.`;
                } catch (error) {
                    throw new Error(`Failed to format document: ${error.message}`);
                }
            }
        });

        this.commands.set('summarize', {
            name: 'Summarize',
            description: 'Generate a summary of the current document or specified section',
            usage: '/summarize [section]',
            examples: [
                '/summarize',
                '/summarize introduction',
                '/summarize methodology'
            ],
            execute: async (context, args) => {
                if (!context.sourceFile) {
                    return "Please open a document to summarize.";
                }

                try {
                    const content = await this.fileNavigationService.readFileContent(context.sourceFile);
                    const section = args?.[0];
                    
                    let prompt = `Provide a comprehensive summary of this document`;
                    if (section) {
                        prompt += ` focusing on the ${section} section`;
                    }
                    prompt += `, highlighting key points and main ideas.`;

                    return await this.aiService.generateContent(prompt, {
                        ...context,
                        previousParagraphs: [content]
                    });
                } catch (error) {
                    throw new Error(`Failed to summarize document: ${error.message}`);
                }
            }
        });

        this.commands.set('search', {
            name: 'Search',
            description: 'Search for files or content in the vault',
            usage: '/search <query> [--type=note|meeting|research]',
            examples: [
                '/search project planning',
                '/search meeting notes --type=meeting',
                '/search research findings --type=research'
            ],
            execute: async (context, args) => {
                if (!args?.length) {
                    return "Please provide a search query.";
                }

                try {
                    const query = args[0];
                    const typeArg = args.find(arg => arg.startsWith('--type='));
                    const type = typeArg ? typeArg.split('=')[1] : null;

                    const files = await this.fileNavigationService.searchFiles(query);
                    if (!files.length) {
                        return "No matching files found.";
                    }

                    // Use AI to analyze search results
                    const results = await Promise.all(files.slice(0, 5).map(async file => {
                        const content = await this.fileNavigationService.readFileContent(file);
                        const analysis = await this.aiService.generateContent(
                            `Analyze how relevant this document is to the search query "${query}"
                            ${type ? `considering it should be a ${type} document.` : ''}
                            
                            Document: "${content.slice(0, 500)}..."
                            
                            Respond with JSON:
                            {
                                "relevance": number (0-1),
                                "matchReason": string,
                                "preview": string
                            }`,
                            context
                        );
                        
                        const { relevance, matchReason, preview } = JSON.parse(analysis);
                        return {
                            file,
                            relevance,
                            matchReason,
                            preview
                        };
                    }));

                    // Sort by relevance and format results
                    const formattedResults = results
                        .sort((a, b) => b.relevance - a.relevance)
                        .map(result => 
                            `- [[${result.file.basename}]] (${Math.round(result.relevance * 100)}% match)
                             Reason: ${result.matchReason}
                             Preview: ${result.preview}`
                        )
                        .join('\n\n');

                    return `Found ${files.length} matching files. Most relevant results:\n\n${formattedResults}`;
                } catch (error) {
                    throw new Error(`Search failed: ${error.message}`);
                }
            }
        });

        this.commands.set('create', {
            name: 'Create',
            description: 'Create a new note with optional template',
            usage: '/create <name> [--template=meeting|research|note]',
            examples: [
                '/create "Project Meeting 2024-01-01" --template=meeting',
                '/create "Research Findings" --template=research',
                '/create "Quick Note"'
            ],
            execute: async (context, args) => {
                if (!args?.length) {
                    return "Please provide a name for the new note.";
                }

                try {
                    const name = args[0].replace(/"/g, '');
                    const templateArg = args.find(arg => arg.startsWith('--template='));
                    const template = templateArg ? templateArg.split('=')[1] : 'note';

                    // Get template content from AI
                    const templateContent = await this.aiService.generateContent(
                        `Generate a ${template} template with appropriate sections and structure.
                        Include common headings, placeholders, and formatting for a ${template} document.`,
                        context
                    );

                    const file = await this.fileNavigationService.createFile(
                        `${name}.md`,
                        templateContent
                    );

                    await this.fileNavigationService.openFile(file);
                    return `Created new ${template} note: ${name}`;
                } catch (error) {
                    throw new Error(`Failed to create note: ${error.message}`);
                }
            }
        });
    }

    async parseCommand(message: string): Promise<CommandParseResult | null> {
        try {
            // First, check for explicit command syntax (/command)
            const explicitMatch = message.match(/^\/(\w+)(\s+.*)?$/);
            if (explicitMatch) {
                const [, commandName, argsString] = explicitMatch;
                const command = this.commands.get(commandName.toLowerCase());
                if (command) {
                    return {
                        command,
                        args: argsString ? this.parseArgs(argsString.trim()) : [],
                        confidence: 1.0
                    };
                }
            }

            // If no explicit command, use AI to detect command intent
            const commandAnalysis = await this.aiService.generateContent(
                `Analyze if this message contains a command request and extract command details.
                
                Available commands:
                ${Array.from(this.commands.entries())
                    .map(([name, cmd]) => `${name}: ${cmd.description}
                    Usage: ${cmd.usage}
                    Examples: ${cmd.examples.join(', ')}`)
                    .join('\n')}
                
                Message: "${message}"
                
                Respond with JSON:
                {
                    "isCommand": boolean,
                    "commandName": string | null,
                    "confidence": number (0-1),
                    "args": string[] | null,
                    "reasoning": string
                }`,
                { previousParagraphs: [], currentHeading: '', documentStructure: { headings: [] } }
            );

            const analysis = JSON.parse(commandAnalysis);
            if (analysis.isCommand && analysis.confidence >= this.CONFIDENCE_THRESHOLD) {
                const command = this.commands.get(analysis.commandName);
                if (command) {
                    return {
                        command,
                        args: analysis.args || [],
                        confidence: analysis.confidence
                    };
                }
            }
        } catch (error) {
            console.error('Error parsing command:', error);
        }
        return null;
    }

    private parseArgs(argsString: string): string[] {
        const args: string[] = [];
        let currentArg = '';
        let inQuotes = false;

        for (let i = 0; i < argsString.length; i++) {
            const char = argsString[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ' ' && !inQuotes) {
                if (currentArg) {
                    args.push(currentArg);
                    currentArg = '';
                }
            } else {
                currentArg += char;
            }
        }

        if (currentArg) {
            args.push(currentArg);
        }

        return args;
    }

    async executeCommand(command: Command, context: DocumentContext, args?: string[]): Promise<string> {
        try {
            const result = await command.execute(context, args);
            this.memoryService.updateArrayMemory('recentCommands', command.name);
            return result;
        } catch (error) {
            console.error(`Error executing command ${command.name}:`, error);
            throw error;
        }
    }

    getCommands(): Map<string, Command> {
        return this.commands;
    }

    cleanup(): void {
        this.commands.clear();
    }
} 