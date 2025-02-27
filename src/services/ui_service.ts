/**
 * UIService manages all UI-related functionality for the auto-completion plugin.
 * This includes suggestion popups, formatting suggestions, and content generation dialogs.
 * 
 * Key responsibilities:
 * - Managing suggestion popups and their integration with providers
 * - Handling formatting suggestions and their UI
 * - Managing content generation dialogs
 * - Coordinating between AI and provider suggestions
 * 
 * @file UI Service implementation for the auto-completion plugin
 */

import { App, Editor } from 'obsidian';
import { SettingsService } from './settings_service';
import { AIService, DocumentContext } from './ai_service';
import { ProviderService } from './provider_service';
import SuggestionPopup from '../popup';
import SnippetManager from '../snippet_manager';
import PeriodInserter from '../period_inserter';
import { FormattingSuggestions } from '../ui/formatting_suggestions';
import { Suggestion } from '../provider/provider';
import { AIPromptModal } from '../ui/prompt_modal';
import { SuggestionContext } from '../provider/provider';

// Define missing interfaces
interface AICompletionResponse {
    text: string;
    confidence: number;
}

// Extend AICompletionResponse to include metadata
interface EnhancedAICompletionResponse extends AICompletionResponse {
    metadata?: {
        source: 'ai' | 'provider';
        displayName?: string;
        icon?: string;
        color?: string;
        preview?: string;
    };
}

interface CachedSuggestions {
    timestamp: number;
    suggestions: EnhancedAICompletionResponse[];
}

export class UIService {
    private suggestionPopup: SuggestionPopup;
    private snippetManager: SnippetManager;
    private periodInserter: PeriodInserter;
    private formattingSuggestions: FormattingSuggestions | null = null;
    private app: App;
    private settingsService: SettingsService;
    private aiService: AIService;
    private providerService: ProviderService;
    private suggestionCache: Map<string, CachedSuggestions>;
    private readonly CACHE_DURATION = 30000; // 30 seconds
    private readonly MAX_CACHE_SIZE = 50; // Reduced from 100 to be more memory efficient
    private readonly MAX_SUGGESTIONS_PER_CACHE = 20; // Limit suggestions per cache entry

    constructor(
        app: App,
        settingsService: SettingsService,
        aiService: AIService,
        providerService: ProviderService
    ) {
        this.app = app;
        this.settingsService = settingsService;
        this.aiService = aiService;
        this.providerService = providerService;
        this.suggestionCache = new Map();
        this.snippetManager = new SnippetManager();
        this.periodInserter = new PeriodInserter();
        this.suggestionPopup = new SuggestionPopup(app, settingsService.getSettings(), this.snippetManager);

        // Initialize UI components when workspace is ready
        this.app.workspace.onLayoutReady(() => {
            if (settingsService.getSettings().formattingSuggestionsEnabled) {
                this.formattingSuggestions = new FormattingSuggestions(app, aiService);
            }
            this.registerWorkspaceEvents();
        });
    }

    private registerWorkspaceEvents() {
        // Clear cache when switching files
        this.app.workspace.on('file-open', () => {
            this.suggestionCache.clear();
        });

        // Clear cache when editor changes
        this.app.workspace.on('editor-change', () => {
            this.cleanCache();
        });

        // Handle active leaf changes
        this.app.workspace.on('active-leaf-change', () => {
            this.suggestionPopup.close();
            this.cleanCache();
        });
    }

    /**
     * Show AI prompt modal and handle content generation
     * @param context Current document context
     * @returns Generated content or null if cancelled
     */
    async showPromptModal(context: DocumentContext): Promise<string | null> {
        return new Promise((resolve) => {
            const modal = new AIPromptModal(
                this.app,
                this.aiService,
                context,
                (result) => resolve(result)
            );
            modal.open();
        });
    }

    /**
     * Get combined suggestions with improved memory management
     * Implements caching, sorting, and relevance scoring
     * 
     * @param currentText Current text to get suggestions for
     * @param context Current document context
     * @param suggestionContext Editor suggestion context
     * @returns Combined and sorted suggestions
     * @throws Error if suggestion retrieval fails
     */
    async getCombinedSuggestions(
        currentText: string, 
        context: DocumentContext,
        suggestionContext: SuggestionContext
    ): Promise<EnhancedAICompletionResponse[]> {
        try {
            const cacheKey = this.generateCacheKey(currentText, context);
            const cached = this.getCachedSuggestions(cacheKey);
            if (cached) return cached;

            const [aiSuggestions, providerSuggestions] = await Promise.all([
                this.aiService.getCompletionSuggestions(currentText, context),
                this.getProviderSuggestions(suggestionContext)
            ]);

            const convertedProviderSuggestions = this.convertProviderSuggestions(providerSuggestions);
            const enhancedAiSuggestions = this.enhanceAISuggestions(aiSuggestions);
            const combinedSuggestions = this.combineSuggestions(
                enhancedAiSuggestions,
                convertedProviderSuggestions
            );

            // Limit number of suggestions before caching
            const limitedSuggestions = combinedSuggestions.slice(0, this.MAX_SUGGESTIONS_PER_CACHE);
            this.cacheSuggestions(cacheKey, limitedSuggestions);

            return limitedSuggestions;
        } catch (error) {
            console.error('Error getting combined suggestions:', error);
            throw new Error('Failed to get suggestions: ' + error.message);
        }
    }

    private generateCacheKey(currentText: string, context: DocumentContext): string {
        return `${currentText}-${context.currentHeading || ''}-${context.documentStructure?.title || ''}`;
    }

    private enhanceAISuggestions(suggestions: AICompletionResponse[]): EnhancedAICompletionResponse[] {
        return suggestions.map(s => ({
            ...s,
            metadata: { source: 'ai' as const }
        }));
    }

    /**
     * Clean old entries from cache
     */
    private cleanCache() {
        const now = Date.now();
        for (const [key, value] of this.suggestionCache.entries()) {
            if (now - value.timestamp > this.CACHE_DURATION) {
                this.suggestionCache.delete(key);
            }
        }
    }

    /**
     * Get suggestions from all enabled providers
     * @private
     * @param context Suggestion context
     * @returns Array of suggestions from providers
     */
    private async getProviderSuggestions(context: SuggestionContext): Promise<Suggestion[]> {
        const settings = this.settingsService.getSettings();
        const providers = this.providerService.getProviders();
        const allSuggestions: Suggestion[] = [];

        for (const provider of providers) {
            try {
                const suggestions = provider.getSuggestions(context, settings);
                allSuggestions.push(...suggestions);
            } catch (error) {
                console.error(`Error getting suggestions from provider:`, error);
            }
        }

        return allSuggestions;
    }

    /**
     * Convert provider suggestions to AI completion format
     * @private
     * @param suggestions Provider suggestions to convert
     * @returns Converted suggestions in AI format
     */
    private convertProviderSuggestions(suggestions: Suggestion[]): EnhancedAICompletionResponse[] {
        return suggestions.map(suggestion => ({
            text: suggestion.replacement,
            confidence: 0.8, // Default confidence for provider suggestions
            metadata: {
                source: 'provider' as const,
                displayName: suggestion.displayName,
                icon: suggestion.icon,
                color: suggestion.color,
                preview: suggestion.preview
            }
        }));
    }

    /**
     * Combine and sort suggestions based on relevance
     * @private
     * @param aiSuggestions Suggestions from AI
     * @param providerSuggestions Suggestions from providers
     * @returns Combined and sorted suggestions
     */
    private combineSuggestions(
        aiSuggestions: EnhancedAICompletionResponse[],
        providerSuggestions: EnhancedAICompletionResponse[]
    ): EnhancedAICompletionResponse[] {
        const combined = [...aiSuggestions, ...providerSuggestions];
        
        // Remove duplicates
        const uniqueSuggestions = this.removeDuplicates(combined);
        
        // Sort by confidence and relevance
        return uniqueSuggestions.sort((a, b) => {
            // Primary sort by confidence
            const confidenceDiff = b.confidence - a.confidence;
            if (Math.abs(confidenceDiff) > 0.1) {
                return confidenceDiff;
            }
            
            // Secondary sort by text length (prefer shorter suggestions)
            return a.text.length - b.text.length;
        });
    }

    /**
     * Remove duplicate suggestions, preferring AI suggestions over provider ones
     * @private
     * @param suggestions Suggestions to deduplicate
     * @returns Deduplicated suggestions
     */
    private removeDuplicates(suggestions: EnhancedAICompletionResponse[]): EnhancedAICompletionResponse[] {
        const seen = new Map<string, EnhancedAICompletionResponse>();
        
        for (const suggestion of suggestions) {
            const key = suggestion.text.toLowerCase();
            const existing = seen.get(key);
            
            if (!existing || 
                (existing.metadata?.source === 'provider' && suggestion.metadata?.source === 'ai')) {
                seen.set(key, suggestion);
            }
        }
        
        return Array.from(seen.values());
    }

    /**
     * Get cached suggestions if they exist and are still valid
     * @private
     * @param key Cache key
     * @returns Cached suggestions or null if invalid/missing
     */
    private getCachedSuggestions(key: string): EnhancedAICompletionResponse[] | null {
        const cached = this.suggestionCache.get(key);
        if (!cached) return null;

        const now = Date.now();
        if (now - cached.timestamp > this.CACHE_DURATION) {
            this.suggestionCache.delete(key);
            return null;
        }

        return cached.suggestions;
    }

    /**
     * Cache suggestions with timestamp
     * @private
     * @param key Cache key
     * @param suggestions Suggestions to cache
     */
    private cacheSuggestions(key: string, suggestions: EnhancedAICompletionResponse[]): void {
        // Implement LRU-like cache cleanup if needed
        if (this.suggestionCache.size >= this.MAX_CACHE_SIZE) {
            const oldestKey = this.suggestionCache.keys().next().value;
            this.suggestionCache.delete(oldestKey);
        }

        this.suggestionCache.set(key, {
            timestamp: Date.now(),
            suggestions
        });
    }

    /**
     * Handle suggestion selection and formatting
     * @param suggestion Selected suggestion
     * @param editor Editor instance
     */
    async handleSuggestionSelection(
        suggestion: EnhancedAICompletionResponse, 
        editor: Editor
    ) {
        try {
            // Apply the suggestion
            this.suggestionPopup.applySelectedItem();
            this.suggestionPopup.postApplySelectedItem(editor);

            // Check and update formatting suggestions
            await this.formattingSuggestions?.checkFormatting(editor);
        } catch (error) {
            console.error('Error handling suggestion selection:', error);
            // Let the error propagate to be handled by the caller
            throw error;
        }
    }

    /**
     * Generate content based on prompt
     * @param prompt User prompt
     * @param context Document context
     * @returns Generated content
     */
    async generateContent(prompt: string, context: DocumentContext): Promise<string> {
        return await this.aiService.generateContent(prompt, context);
    }

    // Getter methods
    getSuggestionPopup(): SuggestionPopup {
        return this.suggestionPopup;
    }

    getSnippetManager(): SnippetManager {
        return this.snippetManager;
    }

    getPeriodInserter(): PeriodInserter {
        return this.periodInserter;
    }

    getFormattingSuggestions(): FormattingSuggestions | null {
        return this.formattingSuggestions;
    }

    /**
     * Clean up resources when the service is unloaded
     */
    unload() {
        try {
            // Remove workspace event listeners
            this.app.workspace.off('file-open', this.cleanCache);
            this.app.workspace.off('editor-change', this.cleanCache);
            this.app.workspace.off('active-leaf-change', this.cleanCache);

            // Clean up UI components
            if (this.formattingSuggestions) {
                this.formattingSuggestions.remove();
            }
            this.snippetManager?.clearAllPlaceholders();
            this.periodInserter?.cancelInsertPeriod();
            this.suggestionPopup?.close();
            
            // Clear cache
            this.suggestionCache?.clear();
        } catch (error) {
            console.error('Error during UI service unload:', error);
        }
    }
} 