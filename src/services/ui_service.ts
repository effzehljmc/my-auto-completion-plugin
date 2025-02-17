import { App } from 'obsidian';
import SuggestionPopup from '../popup';
import SnippetManager from '../snippet_manager';
import { SettingsService } from './settings_service';
import { AIService, AICompletionResponse, DocumentContext } from './ai_service';
import PeriodInserter from '../period_inserter';
import { AIPromptModal } from '../ui/prompt_modal';
import { FormattingSuggestions } from '../ui/formatting_suggestions';

export class UIService {
    private suggestionPopup: SuggestionPopup;
    private snippetManager: SnippetManager;
    private periodInserter: PeriodInserter;
    private formattingSuggestions: FormattingSuggestions;
    private app: App;
    private settingsService: SettingsService;
    private aiService: AIService;

    constructor(app: App, settingsService: SettingsService, aiService: AIService) {
        this.app = app;
        this.settingsService = settingsService;
        this.aiService = aiService;
        this.initializeComponents();
    }

    private initializeComponents() {
        this.snippetManager = new SnippetManager();
        this.suggestionPopup = new SuggestionPopup(
            this.app,
            this.settingsService.getSettings(),
            this.snippetManager
        );
        this.periodInserter = new PeriodInserter();
        this.formattingSuggestions = new FormattingSuggestions(this.app, this.aiService);

        // Register event listener for editor changes
        this.app.workspace.on('editor-change', (editor) => {
            if (editor) {
                this.formattingSuggestions.checkFormatting(editor);
            }
        });
    }

    /**
     * Show AI prompt modal and handle content generation
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
     */
    async getCombinedSuggestions(currentText: string, context: DocumentContext): Promise<AICompletionResponse[]> {
        // Get AI suggestions
        const aiSuggestions = await this.aiService.getCompletionSuggestions(currentText, context);
        
        // TODO: Combine with provider suggestions
        // TODO: Sort and deduplicate suggestions
        
        return aiSuggestions;
    }

    /**
     * Handle suggestion selection and formatting
     */
    async handleSuggestionSelection(suggestion: AICompletionResponse, editor: any) {
        // Apply the suggestion
        this.suggestionPopup.applySelectedItem();
        this.suggestionPopup.postApplySelectedItem(editor);

        // Check formatting
        const currentText = editor.getValue();
        const formattingSuggestions = await this.aiService.checkMarkdownFormatting(currentText, editor);
        
        // TODO: Show formatting suggestions in a nice UI
        console.log('Formatting suggestions:', formattingSuggestions);
    }

    /**
     * Generate content based on prompt
     */
    async generateContent(prompt: string, context: DocumentContext): Promise<string> {
        return await this.aiService.generateContent(prompt, context);
    }

    getSuggestionPopup(): SuggestionPopup {
        return this.suggestionPopup;
    }

    getSnippetManager(): SnippetManager {
        return this.snippetManager;
    }

    getPeriodInserter(): PeriodInserter {
        return this.periodInserter;
    }

    unload() {
        this.snippetManager.onunload();
        this.formattingSuggestions.remove();
    }
} 