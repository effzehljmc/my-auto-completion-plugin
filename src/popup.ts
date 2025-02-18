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

    private isNavigating = false;

    constructor(app: App, settings: MyAutoCompletionSettings, snippetManager: SnippetManager) {
        super(app);
        this.disableSnippets = (app.vault as any).config?.legacyEditor;
        this.settings = settings;
        this.snippetManager = snippetManager;
        
        // Instead of overriding the scope keys, we should use the proper methods
        (this as any).suggestEl.addClass("my-auto-completion-suggestion-popup");
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
        console.log('SuggestionPopup.close', { 
            wasVisible: this.isVisible(),
            wasFocused: this.focused,
            wasNavigating: this.isNavigating
        });
        super.close();
        this.focused = false;
        this.isNavigating = false;
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

        const filteredSuggestions = suggestions.filter(s => !SuggestionBlacklist.has(s));
        
        if (filteredSuggestions.length === 0) {
            this.close();
            return null;
        }
        
        return filteredSuggestions;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        console.log('SuggestionPopup.onTrigger', { cursor, hasFile: !!file });
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
        if (!value) return;

        const replacement = value.replacement;
        const start = value.overrideStart ?? this.context.start;
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
        console.log('selectNextItem start', {
            isVisible: this.isVisible(),
            focused: this.focused,
            direction: dir,
            hasSuggestions: !!(this as any).suggestions,
            isNavigating: this.isNavigating
        });

        if (!this.isVisible()) {
            console.log('selectNextItem - not visible, returning');
            return;
        }

        const self = this as any;
        if (!self.suggestions) {
            console.log('selectNextItem - no suggestions, returning');
            return;
        }

        // Set focus if not already focused
        if (!this.focused) {
            this.focused = true;
            if (dir === SelectionDirection.NONE) {
                self.suggestions.setSelectedItem(0);
                return;
            }
        }

        // Calculate next item index
        const currentItem = self.suggestions.selectedItem ?? -1;
        const totalItems = self.suggestions.values.length;
        let nextItem = currentItem + dir;

        // Handle wrapping
        if (nextItem < 0) {
            nextItem = totalItems - 1;
        } else if (nextItem >= totalItems) {
            nextItem = 0;
        }

        // Prevent closing when navigating
        this.justClosed = false;
        this.isNavigating = true;
        
        // Update selection with a synthetic keyboard event
        const evt = new KeyboardEvent('keydown', {
            key: dir === SelectionDirection.NEXT ? 'ArrowDown' : 'ArrowUp',
            code: dir === SelectionDirection.NEXT ? 'ArrowDown' : 'ArrowUp',
            bubbles: true,
            cancelable: true
        });
        
        self.suggestions.setSelectedItem(nextItem, evt);

        console.log('selectNextItem end', {
            previousItem: currentItem,
            newItem: nextItem,
            focused: this.focused,
            isNavigating: this.isNavigating,
            totalItems
        });
    }

    getSelectedItem(): Suggestion {
        const self = this as any;
        return self.suggestions.values[self.suggestions.selectedItem];
    }

    applySelectedItem() {
        const self = this as any;
        if (!self.suggestions || !self.suggestions.values || !self.suggestions.selectedItem) {
            console.log('No suggestion selected or suggestions not initialized');
            return;
        }
        
        const selectedValue = self.suggestions.values[self.suggestions.selectedItem];
        if (!selectedValue) {
            console.log('No valid suggestion selected');
            return;
        }

        // Create synthetic event
        const evt = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        });

        // Call selectSuggestion directly with the synthetic event
        this.selectSuggestion(selectedValue, evt);
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
        const visible = (this as any).isOpen;
        console.log('SuggestionPopup.isVisible', { 
            visible,
            focused: this.focused,
            hasContext: !!this.context,
            isNavigating: this.isNavigating
        });
        return visible;
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

    shouldClose(): boolean {
        if (this.isNavigating) {
            console.log('shouldClose: false - user is navigating');
            return false;
        }
        return true;
    }

    // Add proper keyboard navigation support
    onArrowUp(evt: KeyboardEvent): void {
        if (!this.isVisible()) return;
        
        evt.preventDefault();
        evt.stopPropagation();
        this.isNavigating = true;
        
        const self = this as any;
        const suggestions = self.suggestions;
        if (!suggestions) return;

        const currentIndex = suggestions.selectedItem ?? -1;
        const totalItems = suggestions.values.length;
        const nextIndex = (currentIndex - 1 + totalItems) % totalItems;
        
        suggestions.setSelectedItem(nextIndex);
    }

    onArrowDown(evt: KeyboardEvent): void {
        if (!this.isVisible()) return;

        evt.preventDefault();
        evt.stopPropagation();
        this.isNavigating = true;
        
        const self = this as any;
        const suggestions = self.suggestions;
        if (!suggestions) return;

        const currentIndex = suggestions.selectedItem ?? -1;
        const totalItems = suggestions.values.length;
        const nextIndex = (currentIndex + 1) % totalItems;
        
        suggestions.setSelectedItem(nextIndex);
    }

    onEnter(evt: KeyboardEvent): void {
        if (!this.isVisible()) return;

        const selectedValue = this.getSelectedItem();
        if (selectedValue) {
            evt.preventDefault();
            evt.stopPropagation();
            this.selectSuggestion(selectedValue, evt);
        }
    }

}

export enum SelectionDirection {
    NEXT = 1,
    PREVIOUS = -1,
    NONE = 0,
}
