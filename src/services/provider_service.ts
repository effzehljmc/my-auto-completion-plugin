import { App, TFile, Vault } from 'obsidian';
import { SuggestionProvider } from '../provider/provider';
import { Callout } from '../provider/callout_provider';
import { FileScanner } from '../provider/scanner_provider';
import { WordList, WordListSuggestionProvider } from '../provider/word_list_provider';
import { SettingsService } from './settings_service';
import MyAutoCompletionPlugin from '../main';
import { MyAutoCompletionSettings } from '../settings';

interface LoadableSuggestionProvider extends SuggestionProvider {
    loadSuggestions?: (
        vault: Vault,
        pluginOrSettings: MyAutoCompletionPlugin | MyAutoCompletionSettings
    ) => Promise<void>;
}

export class ProviderService {
    private providers: LoadableSuggestionProvider[] = [];
    private app: App;
    private settingsService: SettingsService;
    private plugin: MyAutoCompletionPlugin;

    constructor(app: App, settingsService: SettingsService, plugin: MyAutoCompletionPlugin) {
        this.app = app;
        this.settingsService = settingsService;
        this.plugin = plugin;
        this.initializeProviders();
    }

    private initializeProviders() {
        try {
            const settings = this.settingsService.getSettings();
            
            // Clear existing providers
            this.providers = [];
            
            // Add enabled providers
            if (settings.calloutProviderEnabled) {
                this.providers.push(Callout);
            }
            if (settings.fileScannerProviderEnabled) {
                this.providers.push(FileScanner);
            }
            if (settings.wordListProviderEnabled) {
                this.providers.push(WordList);
            }

            // Register workspace events for provider updates
            this.app.workspace.onLayoutReady(() => {
                this.loadAllProviders();
            });
        } catch (error) {
            console.error('Failed to initialize providers:', error);
            // Initialize with default providers
            this.providers = [FileScanner];
        }
    }

    getProviders(): LoadableSuggestionProvider[] {
        return this.providers;
    }

    async reloadProviders() {
        await this.initializeProviders();
        await this.loadAllProviders();
    }

    async loadAllProviders() {
        for (const provider of this.providers) {
            try {
                if (provider.loadSuggestions) {
                    const settings = this.settingsService.getSettings();
                    await provider.loadSuggestions(
                        this.app.vault,
                        provider instanceof WordListSuggestionProvider 
                            ? settings 
                            : this.plugin
                    );
                }
            } catch (error) {
                console.error(`Failed to load provider: ${provider.constructor.name}`, error);
            }
        }
    }

    async scanCurrentFile(file: TFile) {
        try {
            const settings = this.settingsService.getSettings();
            if (!file || !settings.fileScannerScanCurrent || !settings.fileScannerProviderEnabled) {
                return;
            }
            await FileScanner.scanFile(settings, file, true);
        } catch (error) {
            console.error('Failed to scan current file:', error);
        }
    }

    /**
     * Clean up resources when the service is unloaded
     */
    unload() {
        this.providers = [];
    }
} 