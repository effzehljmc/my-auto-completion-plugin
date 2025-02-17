import { Suggestion, SuggestionProvider } from "./provider/provider";
import { WordList } from "./provider/word_list_provider";
import { FileScanner } from "./provider/scanner_provider";
import {
    App,
    Editor,
    EditorPosition,
    EditorSuggest,
    EditorSuggestContext,
    EditorSuggestTriggerInfo,
    getIcon,
    TFile
} from "obsidian";
import SnippetManager from "./snippet_manager";
import { MyAutoCompletionSettings } from "./settings";
import {matchWordBackwards} from "./editor_helpers";
import { SuggestionBlacklist } from "./provider/blacklist";
import { Callout } from "./provider/callout_provider";

const PROVIDERS: SuggestionProvider[] = [Callout, FileScanner, WordList];

export default class SuggestionPopup extends EditorSuggest<Suggestion> {
    /**
     * Hacky variable to prevent the suggestion window from immediately re-opening after completing a suggestion
     */
    private justClosed: boolean;
    private separatorChar: string;

    private characterRegex: string;
    private compiledCharacterRegex: RegExp;
    private focused = false;

    private readonly snippetManager: SnippetManager;
    private readonly settings: MyAutoCompletionSettings;
    private readonly disableSnippets: boolean;

    constructor(app: App, settings: MyAutoCompletionSettings, snippetManager: SnippetManager) {
        super(app);
        this.disableSnippets = (app.vault as any).config?.legacyEditor;
        this.settings = settings;
        this.snippetManager = snippetManager;

        //Remove default key registrations
        const self = this as any;
        self.scope.keys = [];
    }

    open() {
        super.open();
        this.focused = this.settings.autoFocus;

        if (!this.focused) {
            for (const c of (this as any).suggestions.containerEl.children)
                c.removeClass("is-selected");
        }
    }

    close() {
        super.close();
        this.focused = false;
    }

    getSuggestions(
        context: EditorSuggestContext
    ): Suggestion[] | Promise<Suggestion[]> {
        let suggestions: Suggestion[] = [];

        for (const provider of PROVIDERS) {
            suggestions = [...suggestions, ...provider.getSuggestions({
                ...context,
                separatorChar: this.separatorChar
            }, this.settings)];

            if (provider.blocksAllOtherProviders && suggestions.length > 0) {
                suggestions.forEach((suggestion) => {
                    if (!suggestion.overrideStart)
                        return;

                    // Fixes popup position
                    this.context.start = suggestion.overrideStart;
                });
                break;
            }
        }

        const seen = new Set<string>();
        suggestions = suggestions.filter((suggestion) => {
            if (seen.has(suggestion.displayName))
                return false;

            seen.add(suggestion.displayName);
            return true;
        });
        return suggestions.length === 0 ? null : suggestions.filter(s => !SuggestionBlacklist.has(s));
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        return this.internalOnTrigger(editor, cursor, !file);
    }

    private internalOnTrigger(editor: Editor, cursor: EditorPosition, manualTrigger: boolean): EditorSuggestTriggerInfo | null {
        if (this.justClosed) {
            this.justClosed = false;
            return null;
        }

        if (!this.settings.autoTrigger && !manualTrigger) {
            this.close();
            return null;
        }

        const {
            query,
            separatorChar
        } = matchWordBackwards(editor, cursor, (char) => this.getCharacterRegex().test(char), this.settings.maxLookBackDistance);
        this.separatorChar = separatorChar;

        return {
            start: {
                ...cursor,
                ch: cursor.ch - query.length,
            },
            end: cursor,
            query: query,
        };
    }

    renderSuggestion(value: Suggestion, el: HTMLElement): void {
        el.addClass("my-auto-completion-suggestion-item");
        if (value.color != null) {
            el.style.setProperty("--my-auto-completion-suggestion-color", value.color);
        }

        const container = el.createDiv({ cls: "my-auto-completion-suggestion-container" });

        // Add the icon.
        if (value.icon != null) {
            const icon = getIcon(value.icon);
            if (icon != null) {
                icon.addClass("my-auto-completion-suggestion-icon");
                container.appendChild(icon);
            }
        }

        const content = container.createDiv({ cls: "my-auto-completion-suggestion-content" });

        // Add the text.
        const text = content.createDiv({ cls: "my-auto-completion-suggestion-text" });
        text.setText(value.displayName);

        // Add preview if available
        if (value.preview) {
            const preview = content.createDiv({ cls: "my-auto-completion-suggestion-preview" });
            preview.setText(value.preview);
        }

        el.appendChild(container);
    }

    selectSuggestion(value: Suggestion, evt: MouseEvent | KeyboardEvent): void {
        const replacement = value.replacement;
        const start = typeof value !== "string" && value.overrideStart ? value.overrideStart : this.context.start;
        const endPos = value.overrideEnd ?? this.context.end;

        // Get the line content before and after the replacement
        const line = this.context.editor.getLine(start.line);
        const beforeText = line.substring(0, start.ch);
        const afterText = line.substring(endPos.ch);

        // Check if we're in a Markdown formatting context
        const isInBold = this.isInMarkdownFormat(beforeText, "**", afterText);
        const isInItalic = this.isInMarkdownFormat(beforeText, "_", afterText) || 
                          this.isInMarkdownFormat(beforeText, "*", afterText);
        const isInCode = this.isInMarkdownFormat(beforeText, "`", afterText);

        // Apply formatting to replacement if needed
        let formattedReplacement = replacement;
        if (isInBold && !formattedReplacement.includes("**")) {
            formattedReplacement = formattedReplacement.replace(/\*\*/g, "");
        }
        if (isInItalic && !formattedReplacement.includes("_") && !formattedReplacement.includes("*")) {
            formattedReplacement = formattedReplacement.replace(/[_*]/g, "");
        }
        if (isInCode && !formattedReplacement.includes("`")) {
            formattedReplacement = formattedReplacement.replace(/`/g, "");
        }

        // Replace the text while preserving formatting
        this.context.editor.replaceRange(formattedReplacement, start, {
            ...endPos,
            ch: Math.min(endPos.ch, this.context.editor.getLine(endPos.line).length)
        });

        //Check if suggestion is a snippet
        if (formattedReplacement.contains("#") || formattedReplacement.contains("~")) {
            if (!this.disableSnippets) {
                this.snippetManager.handleSnippet(formattedReplacement, start, this.context.editor);
            } else {
                console.log("My Auto Completion: Please enable Live Preview mode to use snippets");
            }
        } else {
            this.context.editor.setCursor({ ...start, ch: start.ch + formattedReplacement.length });
        }

        this.close();
        this.justClosed = true;
    }

    /**
     * Check if the cursor is within a Markdown formatting context
     */
    private isInMarkdownFormat(before: string, marker: string, after: string): boolean {
        const markerCount = (before.match(new RegExp(this.escapeRegExp(marker), "g")) || []).length;
        const afterMarkerCount = (after.match(new RegExp(this.escapeRegExp(marker), "g")) || []).length;
        
        // If we have an odd number of markers before and an odd number after,
        // we're inside a formatting context
        return markerCount % 2 === 1 && afterMarkerCount % 2 === 1;
    }

    /**
     * Escape special characters for RegExp
     */
    private escapeRegExp(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    selectNextItem(dir: SelectionDirection) {
        if (!this.focused) {
            this.focused = true;
            dir = dir === SelectionDirection.PREVIOUS ? dir : SelectionDirection.NONE;
        }

        const self = this as any;
        // HACK: The second parameter has to be an instance of KeyboardEvent to force scrolling the selected item into
        // view
        self.suggestions.setSelectedItem(self.suggestions.selectedItem + dir, new KeyboardEvent("keydown"));
    }

    getSelectedItem(): Suggestion {
        const self = this as any;
        return self.suggestions.values[self.suggestions.selectedItem];
    }

    applySelectedItem() {
        const self = this as any;
        self.suggestions.useSelectedItem();
    }

    postApplySelectedItem(editor: Editor) {
        if (!this.settings.insertSpaceAfterComplete) {
            return
        }
        
        const cursor = editor.getCursor()
        editor.replaceRange(" ", cursor)
        editor.setCursor({line: cursor.line, ch: cursor.ch + 1})
    }

    isVisible(): boolean {
        return (this as any).isOpen;
    }

    isFocused(): boolean {
        return this.focused;
    }

    preventNextTrigger() {
        this.justClosed = true;
    }

    private getCharacterRegex(): RegExp {
        if (this.characterRegex !== this.settings.characterRegex)
            this.compiledCharacterRegex = new RegExp("[" + this.settings.characterRegex + "]", "u");

        return this.compiledCharacterRegex;
    }

}

export enum SelectionDirection {
    NEXT = 1,
    PREVIOUS = -1,
    NONE = 0,
}
