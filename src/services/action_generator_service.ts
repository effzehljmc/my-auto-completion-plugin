import { DocumentContext } from './ai_service';
import { AIService } from './ai_service';
import { CommandService, Command } from './command_service';

export interface AgentAction {
    type: 'suggestion' | 'correction' | 'navigation' | 'command';
    confidence: number;
    description: string;
    execute: () => Promise<void>;
    metadata?: {
        priority?: number;
        category?: string;
        impact?: 'low' | 'medium' | 'high';
        requiresConfirmation?: boolean;
    };
}

export interface ActionAnalysis {
    primaryIntent: string;
    confidence: number;
    suggestedActions: string[];
    requiresFileAccess: boolean;
    isDestructive: boolean;
    reasoning: string;
}

export interface ActionSuggestion {
    type: AgentAction['type'];
    confidence: number;
    description: string;
    command?: string;
    args?: string[];
    reasoning: string;
    metadata?: AgentAction['metadata'];
}

export interface ActionExecutionResult {
    success: boolean;
    message: string;
    error?: Error;
    data?: any;
}

interface CommandParseResult {
    command: Command;
    args: string[];
    confidence: number;
}

export class ActionGeneratorService {
    private readonly CONFIDENCE_THRESHOLD = 0.7;
    private readonly ACTION_TYPES = ['suggestion', 'correction', 'navigation', 'command'] as const;
    private readonly MAX_CONCURRENT_ACTIONS = 3;
    private readonly ACTION_QUEUE: AgentAction[] = [];

    constructor(
        private commandService: CommandService,
        private aiService: AIService
    ) {}

    async generateActions(message: string, context: DocumentContext): Promise<AgentAction[]> {
        try {
            // First, use AI to analyze the message intent and potential actions
            const intentAnalysis = await this.analyzeIntent(message, context);
            const actions: AgentAction[] = [];

            // Adjust confidence based on action characteristics
            const baseConfidence = this.adjustConfidence(intentAnalysis);

            // Generate specific actions based on intent
            if (intentAnalysis.suggestedActions.length > 0) {
                const actionPromises = intentAnalysis.suggestedActions.map(actionType =>
                    this.createAction(actionType, message, context, baseConfidence, intentAnalysis)
                );
                const generatedActions = await Promise.all(actionPromises);
                actions.push(...generatedActions.filter((a): a is AgentAction => a !== null));
            }

            // Get additional AI-suggested actions
            const aiSuggestions = await this.getAISuggestedActions(message, context);
            const aiActions = await this.convertSuggestionsToActions(aiSuggestions, context);
            actions.push(...aiActions);

            // Filter and sort actions
            const finalActions = this.filterAndSortActions(actions);

            // Add actions to queue if they require sequential execution
            this.queueSequentialActions(finalActions);

            return finalActions;
        } catch (error) {
            console.error('Error generating actions:', error);
            return this.getDefaultActions(message, context);
        }
    }

    private async analyzeIntent(message: string, context: DocumentContext): Promise<ActionAnalysis> {
        const analysis = await this.aiService.generateContent(
            `Analyze this message and determine the user's intent and potential actions:
            Message: "${message}"
            
            Consider:
            1. What is the primary intent?
            2. What specific actions would help achieve this intent?
            3. Does this require accessing or modifying files?
            4. Could any suggested actions be destructive?
            
            Respond with JSON:
            {
                "primaryIntent": string,
                "confidence": number (0-1),
                "suggestedActions": string[],
                "requiresFileAccess": boolean,
                "isDestructive": boolean,
                "reasoning": string
            }`,
            context
        );

        return JSON.parse(analysis);
    }

    private adjustConfidence(analysis: ActionAnalysis): number {
        let confidence = analysis.confidence;

        // Reduce confidence for potentially risky operations
        if (analysis.requiresFileAccess) {
            confidence *= 0.9;
        }
        if (analysis.isDestructive) {
            confidence *= 0.6;
        }

        // Adjust based on intent clarity
        if (analysis.reasoning.includes('unclear') || analysis.reasoning.includes('ambiguous')) {
            confidence *= 0.8;
        }

        return Math.min(Math.max(confidence, 0), 1);
    }

    private async createAction(
        actionType: AgentAction['type'],
        message: string,
        context: DocumentContext,
        baseConfidence: number,
        analysis: ActionAnalysis
    ): Promise<AgentAction | null> {
        try {
            // Parse command if action is command-type
            const command = await this.commandService.parseCommand(message);
            if (!command && actionType === 'command') return null;

            const metadata = {
                priority: this.calculatePriority(actionType, analysis),
                category: this.categorizeAction(actionType, analysis),
                impact: this.determineImpact(analysis) as 'low' | 'medium' | 'high',
                requiresConfirmation: analysis.isDestructive || analysis.requiresFileAccess
            };

            return {
                type: this.validateActionType(actionType),
                confidence: this.calculateActionConfidence(baseConfidence, actionType, analysis),
                description: this.generateActionDescription(actionType, command, analysis),
                metadata,
                execute: async () => {
                    try {
                        if (command) {
                            const result = await this.commandService.executeCommand(
                                command.command,
                                context,
                                command.args
                            );
                            console.log(`Action executed successfully: ${result}`);
                        }
                    } catch (error) {
                        console.error(`Action execution failed: ${error.message}`);
                        throw error;
                    }
                }
            };
        } catch (error) {
            console.error('Error creating action:', error);
            return null;
        }
    }

    private async getAISuggestedActions(
        message: string,
        context: DocumentContext
    ): Promise<ActionSuggestion[]> {
        const suggestionAnalysis = await this.aiService.generateContent(
            `Analyze this message and suggest additional actions that might be helpful:
            Message: "${message}"
            
            Consider actions that might:
            1. Help achieve the user's goal more effectively
            2. Provide additional useful information
            3. Improve the result quality
            
            Respond with JSON array of actions:
            [
                {
                    "type": "suggestion" | "correction" | "navigation" | "command",
                    "confidence": number (0-1),
                    "description": string,
                    "command": string | null,
                    "args": string[] | null,
                    "reasoning": string,
                    "metadata": {
                        "priority": number (1-5),
                        "category": string,
                        "impact": "low" | "medium" | "high",
                        "requiresConfirmation": boolean
                    }
                }
            ]`,
            context
        );

        return JSON.parse(suggestionAnalysis);
    }

    private async convertSuggestionsToActions(
        suggestions: ActionSuggestion[],
        context: DocumentContext
    ): Promise<AgentAction[]> {
        return Promise.all(
            suggestions
                .filter(suggestion => suggestion.confidence >= this.CONFIDENCE_THRESHOLD)
                .map(async suggestion => ({
                    type: suggestion.type,
                    confidence: suggestion.confidence,
                    description: suggestion.description,
                    metadata: suggestion.metadata,
                    execute: async () => {
                        if (suggestion.command) {
                            const command = await this.commandService.parseCommand(
                                `/${suggestion.command} ${suggestion.args?.join(' ') || ''}`
                            );
                            if (command) {
                                await this.commandService.executeCommand(
                                    command.command,
                                    context,
                                    command.args
                                );
                            }
                        }
                    }
                }))
        );
    }

    private validateActionType(type: string): AgentAction['type'] {
        if (this.ACTION_TYPES.includes(type as any)) {
            return type as AgentAction['type'];
        }
        return 'suggestion';
    }

    private calculateActionConfidence(
        baseConfidence: number,
        actionType: string,
        analysis: ActionAnalysis
    ): number {
        let confidence = baseConfidence;

        switch (actionType) {
            case 'correction':
                confidence *= 0.9; // Slightly lower confidence for corrections
                break;
            case 'navigation':
                confidence *= 0.95; // High confidence for navigation
                break;
            case 'command':
                confidence *= 0.8; // Lower confidence for commands
                break;
            default:
                confidence *= 0.85;
        }

        return Math.max(0, Math.min(1, confidence));
    }

    private calculatePriority(actionType: string, analysis: ActionAnalysis): number {
        let priority = 3; // Default medium priority

        if (analysis.isDestructive) priority = 5; // Highest priority for destructive actions
        if (actionType === 'correction') priority = 4;
        if (actionType === 'suggestion') priority = 2;
        if (actionType === 'navigation') priority = 1;

        return priority;
    }

    private categorizeAction(actionType: string, analysis: ActionAnalysis): string {
        if (analysis.isDestructive) return 'destructive';
        if (analysis.requiresFileAccess) return 'file-operation';
        if (actionType === 'command') return 'command';
        return 'general';
    }

    private determineImpact(analysis: ActionAnalysis): string {
        if (analysis.isDestructive) return 'high';
        if (analysis.requiresFileAccess) return 'medium';
        return 'low';
    }

    private generateActionDescription(
        actionType: string,
        command: { command: any; args: string[]; confidence: number; } | null,
        analysis: ActionAnalysis
    ): string {
        if (command) {
            return `Execute command: ${command.command.name} ${command.args.join(' ')}`;
        }
        return `${actionType.charAt(0).toUpperCase() + actionType.slice(1)}: ${analysis.reasoning}`;
    }

    private filterAndSortActions(actions: AgentAction[]): AgentAction[] {
        return actions
            .filter(action => action.confidence >= this.CONFIDENCE_THRESHOLD)
            .sort((a: AgentAction, b: AgentAction) => {
                // Sort by priority first
                const priorityDiff = (b.metadata?.priority || 0) - (a.metadata?.priority || 0);
                if (priorityDiff !== 0) return priorityDiff;
                
                // Then by confidence
                return b.confidence - a.confidence;
            })
            .slice(0, 5); // Limit to top 5 actions
    }

    private queueSequentialActions(actions: AgentAction[]): void {
        const sequentialActions = actions.filter(
            action => action.metadata?.requiresConfirmation
        );
        this.ACTION_QUEUE.push(...sequentialActions);
        
        // Ensure queue doesn't grow too large
        if (this.ACTION_QUEUE.length > this.MAX_CONCURRENT_ACTIONS) {
            this.ACTION_QUEUE.length = this.MAX_CONCURRENT_ACTIONS;
        }
    }

    private getDefaultActions(message: string, context: DocumentContext): AgentAction[] {
        return [{
            type: 'suggestion',
            confidence: 0.5,
            description: 'Process message safely without file modifications',
            metadata: {
                priority: 1,
                category: 'safe',
                impact: 'low',
                requiresConfirmation: false
            },
            execute: async () => {
                await this.aiService.generateContent(message, context);
            }
        }];
    }

    async executeQueuedActions(): Promise<ActionExecutionResult[]> {
        const results: ActionExecutionResult[] = [];
        
        while (this.ACTION_QUEUE.length > 0) {
            const action = this.ACTION_QUEUE.shift();
            if (!action) break;

            try {
                await action.execute();
                results.push({
                    success: true,
                    message: `Successfully executed: ${action.description}`
                });
            } catch (error) {
                results.push({
                    success: false,
                    message: `Failed to execute: ${action.description}`,
                    error: error as Error
                });
            }
        }

        return results;
    }

    cleanup(): void {
        this.ACTION_QUEUE.length = 0;
    }
} 