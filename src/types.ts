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