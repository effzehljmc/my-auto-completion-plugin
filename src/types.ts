import { TFile } from 'obsidian';

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
    data?: Record<string, unknown>;
}

export interface IntentAnalysis {
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

export interface AIRequestOptions {
    maxTokens?: number;
    temperature?: number;
    model?: string;
    response_format?: { type: "json_object" | "text" };
}

export interface AICompletionRequest {
    prompt: string;
    maxTokens?: number;
    temperature?: number;
    model?: string;
    response_format?: { type: string };
}

export interface DocumentStructure {
    title: string;
    headings: string[];
}

export interface DocumentContext {
    previousParagraphs: string[];
    currentHeading: string;
    documentStructure: DocumentStructure;
    sourceFile?: TFile;
    content?: string;
    currentParagraph?: string;
}

export interface ChatMessage {
    content: string;
    timestamp: number;
    documentContext?: DocumentContext;
    intent?: IntentAnalysis;
}

export interface ChatState {
    currentDocument: TFile | null;
    messageHistory: ChatMessage[];
    lastActiveDocument: TFile | null;
}