import { EditorPosition, Notice, Plugin, TFile } from "obsidian";
import { MyAutoCompletionSettings, DEFAULT_SETTINGS } from "./settings";
import { FileScanner } from "./provider/scanner_provider";
import { WordList } from "./provider/word_list_provider";
import SuggestionPopup from "./popup";
import MyAutoCompletionSettingsTab from "./settings_tab";
import { markerStateField } from "./marker_state_field";
import { EditorView, ViewUpdate } from "@codemirror/view";
import SnippetManager from "./snippet_manager";
import PeriodInserter from "./period_inserter";
import { SuggestionBlacklist } from "./provider/blacklist";
import { posFromIndex } from "./editor_helpers";
import { SelectionDirection } from "./popup";

class CursorActivityListener {
    private readonly snippetManager: SnippetManager;
    private readonly suggestionPopup: SuggestionPopup;
    private readonly periodInserter: PeriodInserter;

    private cursorTriggeredByChange = false;
    private lastCursorLine = -1;

    constructor(snippetManager: SnippetManager, suggestionPopup: SuggestionPopup, periodInserter: PeriodInserter) {
        this.snippetManager = snippetManager;
        this.suggestionPopup = suggestionPopup;
        this.periodInserter = periodInserter;
    }

    readonly listener = (update: ViewUpdate) => {
        if (update.docChanged) {
            this.handleDocChange();
        }

        if (update.selectionSet) {
            this.handleCursorActivity(posFromIndex(update.state.doc, update.state.selection.main.head))
        }
    };

    private readonly handleDocChange = () => {
        this.cursorTriggeredByChange = true;
    };

    private readonly handleCursorActivity = (cursor: EditorPosition) => {
        this.periodInserter.cancelInsertPeriod()
        
        // This prevents the popup from opening when switching to the previous line
        const didChangeLine = this.lastCursorLine != cursor.line;
        if (didChangeLine)
            this.suggestionPopup.preventNextTrigger();
        this.lastCursorLine = cursor.line;

        // Clear all placeholders when moving cursor somewhere else
        if (!this.snippetManager.placeholderAtPos(cursor)) {
            this.snippetManager.clearAllPlaceholders();
        }

        // Prevents the suggestion popup from flickering when typing
        if (this.cursorTriggeredByChange) {
            this.cursorTriggeredByChange = false;
            if (!didChangeLine)
                return;
        }

        this.suggestionPopup.close();
    };
}

export default class MyAutoCompletionPlugin extends Plugin {

    settings: MyAutoCompletionSettings;

    private snippetManager: SnippetManager;
    private _suggestionPopup: SuggestionPopup;
    private _periodInserter: PeriodInserter;

    async onload() {
        await this.loadSettings();

        this.snippetManager = new SnippetManager();
        this._suggestionPopup = new SuggestionPopup(this.app, this.settings, this.snippetManager);
        this._periodInserter = new PeriodInserter();

        this.registerEditorSuggest(this._suggestionPopup);

        this.registerEvent(this.app.workspace.on('file-open', this.onFileOpened, this));

        this.registerEditorExtension(markerStateField);
        this.registerEditorExtension(EditorView.updateListener.of(new CursorActivityListener(this.snippetManager, this._suggestionPopup, this._periodInserter).listener));

        this.addSettingTab(new MyAutoCompletionSettingsTab(this.app, this));

        this.setupCommands();

        if ((this.app.vault as any).config?.legacyEditor) {
            console.log("My Auto Completion: Without Live Preview enabled, most features will not work properly!");
        }
    }

    onunload() {
        this.snippetManager.onunload();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private setupCommands() {
        this.addCommand({
            id: 'scan-vault',
            name: 'Scan vault',
            callback: async () => {
                await FileScanner.scanFiles(this.settings, this.app.vault.getMarkdownFiles());
                new Notice("Finished scanning vault");
            }
        });

        this.addCommand({
            id: 'reload-word-lists',
            name: 'Reload word lists',
            callback: async () => {
                const count = await WordList.loadFromFiles(this.app.vault, this.settings);
                new Notice(`Loaded ${count} words`);
            }
        });

        this.addCommand({
            id: 'my-auto-completion-select-next-suggestion',
            name: 'Select next suggestion',
            hotkeys: [
                {
                    key: "ArrowDown",
                    modifiers: []
                }
            ],
            repeatable: true,
            editorCallback: (_) => {
                this._suggestionPopup.selectNextItem(SelectionDirection.NEXT);
            },
            // @ts-ignore
            isVisible: () => this._suggestionPopup.isVisible(),
        });

        this.addCommand({
            id: 'my-auto-completion-select-previous-suggestion',
            name: 'Select previous suggestion',
            hotkeys: [
                {
                    key: "ArrowUp",
                    modifiers: []
                }
            ],
            repeatable: true,
            editorCallback: (_) => {
                this._suggestionPopup.selectNextItem(SelectionDirection.PREVIOUS);
            },
            // @ts-ignore
            isVisible: () => this._suggestionPopup.isVisible(),
        });

        this.addCommand({
            id: 'my-auto-completion-insert-selected-suggestion',
            name: 'Insert selected suggestion',
            hotkeys: [
                {
                    key: "Enter",
                    modifiers: []
                }
            ],
            editorCallback: (editor) => {
                this._suggestionPopup.applySelectedItem();
                this._suggestionPopup.postApplySelectedItem(editor);
                this._periodInserter.allowInsertPeriod();
            },
            // @ts-ignore
            isVisible: () => this._suggestionPopup.isVisible(),
        });
    }

    private async onFileOpened(file: TFile) {
        if (!file || !this.settings.fileScannerScanCurrent || !this.settings.fileScannerProviderEnabled)
            return;

        await FileScanner.scanFile(this.settings, file, true);
    }
}
