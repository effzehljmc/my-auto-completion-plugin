import { DocumentContext } from './ai_service';
import { MyAutoCompletionSettings } from '../settings';

export interface AgentMemory {
    recentFiles: string[];
    recentCommands: string[];
    userPreferences: Partial<MyAutoCompletionSettings>;
    documentContexts: DocumentContext[];
}

export class MemoryService {
    private memory: AgentMemory = {
        recentFiles: [],
        recentCommands: [],
        userPreferences: {},
        documentContexts: []
    };

    private readonly MAX_ITEMS = 10;

    updateContext(context: DocumentContext): void {
        this.memory.documentContexts.unshift(context);
        if (this.memory.documentContexts.length > this.MAX_ITEMS) {
            this.memory.documentContexts.pop();
        }
    }

    updateArrayMemory<K extends keyof AgentMemory>(
        key: K,
        value: AgentMemory[K] extends (infer T)[] ? T : never
    ): void {
        const arr = this.memory[key] as any[];
        if (!Array.isArray(arr)) return;

        // Add to front of array
        arr.unshift(value);

        // Keep only unique values
        const unique = Array.from(new Set(arr));

        // Limit array size
        if (unique.length > this.MAX_ITEMS) {
            unique.length = this.MAX_ITEMS;
        }

        this.memory[key] = unique as AgentMemory[K];
    }

    getState(): AgentMemory {
        return { ...this.memory };
    }

    getEnhancedContext(context: DocumentContext): DocumentContext {
        return {
            ...context,
            previousParagraphs: [
                ...context.previousParagraphs,
                ...this.memory.documentContexts
                    .filter(ctx => ctx.sourceFile?.path !== context.sourceFile?.path)
                    .flatMap(ctx => ctx.previousParagraphs)
                    .slice(0, this.MAX_ITEMS)
            ]
        };
    }

    cleanup(): void {
        this.memory = {
            recentFiles: [],
            recentCommands: [],
            userPreferences: {},
            documentContexts: []
        };
    }
} 