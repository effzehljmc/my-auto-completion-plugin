import { App, TFile } from 'obsidian';
import { SuggestionProvider } from '../provider/provider';
import { Callout } from '../provider/callout_provider';
import { FileScanner } from '../provider/scanner_provider';
import { WordList } from '../provider/word_list_provider';
import { SettingsService } from './settings_service';

export class ProviderService {
    private providers: SuggestionProvider[] = [];
    private app: App;
    private settingsService: SettingsService;

    constructor(app: App, settingsService: SettingsService) {
        this.app = app;
        this.settingsService = settingsService;
        this.initializeProviders();
    }

    private initializeProviders() {
        const settings = this.settingsService.getSettings();
        
        if (settings.calloutProviderEnabled) {
            this.providers.push(Callout);
        }
        if (settings.fileScannerProviderEnabled) {
            this.providers.push(FileScanner);
        }
        if (settings.wordListProviderEnabled) {
            this.providers.push(WordList);
        }
    }

    getProviders(): SuggestionProvider[] {
        return this.providers;
    }

    async reloadProviders() {
        this.providers = [];
        this.initializeProviders();
        await this.loadAllProviders();
    }

    async loadAllProviders() {
        for (const provider of this.providers) {
            try {
                // @ts-ignore - Some providers may have loadSuggestions method
                await provider.loadSuggestions?.(this.app.vault, this.app);
            } catch (error) {
                console.error(`Failed to load provider: ${provider}`, error);
            }
        }
    }

    async scanCurrentFile(file: TFile) {
        const settings = this.settingsService.getSettings();
        if (!file || !settings.fileScannerScanCurrent || !settings.fileScannerProviderEnabled) {
            return;
        }
        await FileScanner.scanFile(settings, file, true);
    }
} 