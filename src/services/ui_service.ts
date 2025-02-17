import { App } from 'obsidian';
import SuggestionPopup from '../popup';
import SnippetManager from '../snippet_manager';
import { SettingsService } from './settings_service';
import PeriodInserter from '../period_inserter';

export class UIService {
    private suggestionPopup: SuggestionPopup;
    private snippetManager: SnippetManager;
    private periodInserter: PeriodInserter;
    private app: App;
    private settingsService: SettingsService;

    constructor(app: App, settingsService: SettingsService) {
        this.app = app;
        this.settingsService = settingsService;
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
    }
} 