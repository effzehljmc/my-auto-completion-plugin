import { MyAutoCompletionSettings, DEFAULT_SETTINGS } from '../settings';
import { Plugin } from 'obsidian';

export class SettingsService {
    private plugin: Plugin;
    private settings: MyAutoCompletionSettings;

    constructor(plugin: Plugin) {
        this.plugin = plugin;
    }

    async loadSettings(): Promise<MyAutoCompletionSettings> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.plugin.loadData());
        return this.settings;
    }

    async saveSettings(): Promise<void> {
        await this.plugin.saveData(this.settings);
    }

    getSettings(): MyAutoCompletionSettings {
        return this.settings;
    }

    async updateSetting<K extends keyof MyAutoCompletionSettings>(
        key: K,
        value: MyAutoCompletionSettings[K]
    ): Promise<void> {
        this.settings[key] = value;
        await this.saveSettings();
    }
} 