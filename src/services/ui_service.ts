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

import { App, debounce } from 'obsidian';
import SuggestionPopup from '../popup';
import SnippetManager from '../snippet_manager';
import { SettingsService } from './settings_service';
import { AIService, AICompletionResponse, DocumentContext } from './ai_service';
import { ProviderService } from './provider_service';
import PeriodInserter from '../period_inserter';
import { AIPromptModal } from '../ui/prompt_modal';
import { FormattingSuggestions } from '../ui/formatting_suggestions';
import { Suggestion, SuggestionContext } from '../provider/provider';

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
    private formattingSuggestions: FormattingSuggestions;
    private app: App;
    private settingsService: SettingsService;
    private aiService: AIService;
    private providerService: ProviderService;
    private suggestionCache: Map<string, CachedSuggestions>;
    private readonly CACHE_DURATION = 30000; // 30 seconds
    private readonly MAX_CACHE_SIZE = 100;

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
        this.initializeComponents();
    }

    /**
     * Initialize all UI components and set up event listeners
     * @private
     */
    private initializeComponents() {
        this.snippetManager = new SnippetManager();
        this.suggestionPopup = new SuggestionPopup(
            this.app,
            this.settingsService.getSettings(),
            this.snippetManager
        );
        this.periodInserter = new PeriodInserter();
        this.formattingSuggestions = new FormattingSuggestions(this.app, this.aiService);

        // Register event listener for editor changes with debouncing
        this.app.workspace.on('editor-change', 
            debounce((editor) => {
                if (editor) {
                    this.formattingSuggestions.checkFormatting(editor);
                }
            }, 1000, true)
        );
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
     * Get combined suggestions from both AI and providers
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
            // Check cache first
            const cacheKey = `${currentText}-${context.currentHeading || ''}`;
            const cached = this.getCachedSuggestions(cacheKey);
            if (cached) {
                return cached;
            }

            // Get suggestions from both sources
            const [aiSuggestions, providerSuggestions] = await Promise.all([
                this.aiService.getCompletionSuggestions(currentText, context),
                this.getProviderSuggestions(suggestionContext)
            ]);

            // Convert provider suggestions to AI format
            const convertedProviderSuggestions = this.convertProviderSuggestions(providerSuggestions);

            // Add metadata to AI suggestions
            const enhancedAiSuggestions = aiSuggestions.map(s => ({
                ...s,
                metadata: { source: 'ai' as const }
            }));

            // Combine and sort suggestions
            const combinedSuggestions = this.combineSuggestions(
                enhancedAiSuggestions,
                convertedProviderSuggestions
            );

            // Cache the results
            this.cacheSuggestions(cacheKey, combinedSuggestions);

            return combinedSuggestions;
        } catch (error) {
            console.error('Error getting combined suggestions:', error);
            throw new Error('Failed to get suggestions: ' + error.message);
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
    async handleSuggestionSelection(suggestion: EnhancedAICompletionResponse, editor: any) {
        try {
            // Apply the suggestion
            this.suggestionPopup.applySelectedItem();
            this.suggestionPopup.postApplySelectedItem(editor);

            // Check and update formatting suggestions
            await this.formattingSuggestions.checkFormatting(editor);
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

    getFormattingSuggestions(): FormattingSuggestions {
        return this.formattingSuggestions;
    }

    /**
     * Clean up resources when the service is unloaded
     */
    unload() {
        this.snippetManager.onunload();
        this.formattingSuggestions.remove();
        this.suggestionCache.clear();
    }
} 