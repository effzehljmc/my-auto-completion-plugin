import { Plugin, TFile, Notice } from 'obsidian';
import { EditorView, ViewUpdate } from '@codemirror/view';
import MyAutoCompletionSettingsTab from './settings_tab';
import { markerStateField } from './marker_state_field';
import { SelectionDirection } from './popup';
import { SettingsService } from './services/settings_service';
import { ProviderService } from './services/provider_service';
import { UIService } from './services/ui_service';
import { AIService, DocumentContext } from './services/ai_service';

export default class MyAutoCompletionPlugin extends Plugin {
    private settingsService: SettingsService;
    private providerService: ProviderService;
    private uiService: UIService;
    private aiService: AIService;

    async onload() {
        this.settingsService = new SettingsService(this);
        await this.settingsService.loadSettings();

        this.aiService = new AIService(this.app, this.settingsService);
        await this.aiService.initialize();

        this.providerService = new ProviderService(this.app, this.settingsService);
        this.uiService = new UIService(this.app, this.settingsService, this.aiService);

        // Register the suggestion popup
        this.registerEditorSuggest(this.uiService.getSuggestionPopup());

        // Register event listeners
        this.registerEvent(
            this.app.workspace.on('file-open', this.onFileOpened.bind(this))
        );

        // Register editor extensions
        this.registerEditorExtension(markerStateField);
        this.registerEditorExtension(
            EditorView.updateListener.of((update: ViewUpdate) => {
                if (update.docChanged || update.selectionSet) {
                    const snippetManager = this.uiService.getSnippetManager();
                    const suggestionPopup = this.uiService.getSuggestionPopup();
                    const periodInserter = this.uiService.getPeriodInserter();

                    // Handle cursor activity
                    snippetManager.clearAllPlaceholders();
                    periodInserter.cancelInsertPeriod();
                    suggestionPopup.close();
                }
            })
        );

        // Add settings tab
        this.addSettingTab(new MyAutoCompletionSettingsTab(this.app, this));

        this.setupCommands();

        if ((this.app.vault as any).config?.legacyEditor) {
            console.log("My Auto Completion: Without Live Preview enabled, most features will not work properly!");
        }
    }

    onunload() {
        this.uiService.unload();
    }

    getSettings() {
        return this.settingsService.getSettings();
    }

    async saveSettings() {
        await this.settingsService.saveSettings();
    }

    private setupCommands() {
        this.addCommand({
            id: 'generate-content',
            name: 'Generate content from prompt',
            editorCallback: async (editor) => {
                const context = this.getCurrentContext(editor);
                const content = await this.uiService.showPromptModal(context);
                
                if (content) {
                    editor.replaceSelection(content);
                    new Notice("Content generated successfully");
                }
            }
        });

        this.addCommand({
            id: 'scan-vault',
            name: 'Scan vault',
            callback: async () => {
                await this.providerService.loadAllProviders();
                new Notice("Finished scanning vault");
            }
        });

        this.addCommand({
            id: 'reload-word-lists',
            name: 'Reload word lists',
            callback: async () => {
                await this.providerService.reloadProviders();
                new Notice(`Reloaded providers`);
            }
        });

        const suggestionPopup = this.uiService.getSuggestionPopup();
        
        this.addCommand({
            id: 'my-auto-completion-select-next-suggestion',
            name: 'Select next suggestion',
            hotkeys: [{ key: "ArrowDown", modifiers: [] }],
            repeatable: true,
            editorCallback: (_) => {
                suggestionPopup.selectNextItem(SelectionDirection.NEXT);
            },
            // @ts-ignore
            isVisible: () => suggestionPopup.isVisible(),
        });

        this.addCommand({
            id: 'my-auto-completion-select-previous-suggestion',
            name: 'Select previous suggestion',
            hotkeys: [{ key: "ArrowUp", modifiers: [] }],
            repeatable: true,
            editorCallback: (_) => {
                suggestionPopup.selectNextItem(SelectionDirection.PREVIOUS);
            },
            // @ts-ignore
            isVisible: () => suggestionPopup.isVisible(),
        });

        this.addCommand({
            id: 'my-auto-completion-insert-selected-suggestion',
            name: 'Insert selected suggestion',
            hotkeys: [{ key: "Enter", modifiers: [] }],
            editorCallback: (editor) => {
                suggestionPopup.applySelectedItem();
                suggestionPopup.postApplySelectedItem(editor);
                this.uiService.getPeriodInserter().allowInsertPeriod();
            },
            // @ts-ignore
            isVisible: () => suggestionPopup.isVisible(),
        });
    }

    private async onFileOpened(file: TFile) {
        await this.providerService.scanCurrentFile(file);
    }

    private getCurrentContext(editor: any): DocumentContext {
        // TODO: Implement proper context extraction
        return {
            previousParagraphs: [],
            documentStructure: {
                headings: []
            }
        };
    }
}
