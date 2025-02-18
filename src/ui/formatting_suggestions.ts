import { App, Editor, Notice, setIcon } from "obsidian";
import { AIService } from "../services/ai_service";

export class FormattingSuggestions {
    private container: HTMLElement;
    private suggestions: string[] = [];
    private editor: Editor;
    private aiService: AIService;
    private app: App;
    private debounceTimeout: NodeJS.Timeout;

    constructor(app: App, aiService: AIService) {
        this.app = app;
        this.aiService = aiService;
        this.setupContainer();
    }

    private setupContainer() {
        this.container = document.createElement('div');
        this.container.addClass('formatting-suggestions-container');
        this.container.style.display = 'none';
        document.body.appendChild(this.container);
    }

    async checkFormatting(editor: Editor) {
        this.editor = editor;
        
        // Debounce the formatting check
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
        }

        this.debounceTimeout = setTimeout(async () => {
            const text = editor.getValue();
            try {
                this.suggestions = await this.aiService.checkMarkdownFormatting(text, editor);
                this.updateUI();
            } catch (error) {
                console.error('Error checking formatting:', error);
            }
        }, 1000); // Check formatting after 1 second of no typing
    }

    private updateUI() {
        if (!this.editor || this.suggestions.length === 0) {
            this.hide();
            return;
        }

        this.container.empty();
        
        // Create header
        const header = this.container.createDiv('formatting-suggestions-header');
        header.createSpan({ text: 'Formatting Suggestions' });
        
        // Create close button
        const closeButton = header.createDiv('formatting-suggestions-close');
        setIcon(closeButton, 'x');
        closeButton.addEventListener('click', () => this.hide());

        // Create suggestions list
        const list = this.container.createDiv('formatting-suggestions-list');
        
        this.suggestions.forEach((suggestion) => {
            const item = list.createDiv('formatting-suggestions-item');
            
            // Create fix button
            const fixButton = item.createDiv('formatting-suggestions-fix');
            setIcon(fixButton, 'check');
            fixButton.addEventListener('click', () => this.applySuggestion(suggestion));
            
            // Create suggestion text
            const text = item.createDiv('formatting-suggestions-text');
            text.setText(suggestion);
        });

        this.show();
    }

    private async applySuggestion(suggestion: string) {
        if (!this.editor) return;

        try {
            // Apply the formatting fix
            const cursor = this.editor.getCursor();
            const line = this.editor.getLine(cursor.line);
            
            // Example: If suggestion is about adding a heading
            if (suggestion.toLowerCase().includes('heading')) {
                if (!line.startsWith('#')) {
                    this.editor.replaceRange('# ', { line: cursor.line, ch: 0 });
                }
            }
            // Example: If suggestion is about adding bold
            else if (suggestion.toLowerCase().includes('bold')) {
                const selection = this.editor.getSelection();
                if (selection) {
                    this.editor.replaceSelection(`**${selection}**`);
                }
            }
            // Example: If suggestion is about adding italic
            else if (suggestion.toLowerCase().includes('italic')) {
                const selection = this.editor.getSelection();
                if (selection) {
                    this.editor.replaceSelection(`_${selection}_`);
                }
            }
            // Example: If suggestion is about adding code block
            else if (suggestion.toLowerCase().includes('code')) {
                const selection = this.editor.getSelection();
                if (selection) {
                    this.editor.replaceSelection(`\`${selection}\``);
                }
            }
            // Add more formatting fixes as needed

            new Notice('Formatting applied');
            
            // Refresh suggestions
            await this.checkFormatting(this.editor);
        } catch (error) {
            console.error('Error applying formatting:', error);
            new Notice('Failed to apply formatting');
        }
    }

    private show() {
        if (!this.editor) return;

        const editorElement = (this.editor as any).cm.dom.querySelector('.cm-content');
        if (!editorElement) return;

        const rect = editorElement.getBoundingClientRect();
        
        this.container.style.display = 'block';
        this.container.style.top = `${rect.top + 30}px`; // Position below the cursor line
        this.container.style.left = `${rect.left + 10}px`;
    }

    private hide() {
        this.container.style.display = 'none';
    }

    public remove() {
        if (this.debounceTimeout) {
            clearTimeout(this.debounceTimeout);
        }
        this.container.remove();
    }
} 