import { App, Modal, Setting, TextAreaComponent, Notice, setIcon } from 'obsidian';
import { AIService, DocumentContext } from '../services/ai_service';

export class AIPromptModal extends Modal {
    private result: string;
    private onSubmit: (result: string) => void;
    private promptInput: TextAreaComponent;
    private aiService: AIService;
    private context: DocumentContext;
    private isGenerating = false;

    constructor(
        app: App,
        aiService: AIService,
        context: DocumentContext,
        onSubmit: (result: string) => void
    ) {
        super(app);
        this.aiService = aiService;
        this.context = context;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('ai-prompt-modal');

        // Header with icon
        const headerContainer = contentEl.createDiv('ai-prompt-header');
        const iconContainer = headerContainer.createDiv('ai-prompt-icon');
        setIcon(iconContainer, 'bot');
        headerContainer.createEl('h2', { text: 'AI Content Generation' });

        // Prompt input
        new Setting(contentEl)
            .setName('Your prompt')
            .setDesc('Describe what you want to generate')
            .addTextArea((text) => {
                this.promptInput = text;
                text.setPlaceholder('Generate a summary of...')
                    .setValue(this.result || '')
                    .onChange((value) => {
                        this.result = value;
                    });
                text.inputEl.addClass('ai-prompt-input');
                text.inputEl.rows = 4;

                // Add keyboard shortcuts
                text.inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        this.generate();
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        this.close();
                    }
                });
            });

        // Context display
        if (this.context.currentHeading) {
            new Setting(contentEl)
                .setName('Current context')
                .setDesc('The AI will consider this context')
                .addText(text => {
                    text.setValue(this.context.currentHeading)
                        .setDisabled(true);
                });
        }

        // Keyboard shortcuts info
        const shortcutsInfo = contentEl.createDiv('ai-prompt-shortcuts');
        shortcutsInfo.createSpan({ text: '⌘/Ctrl + Enter to generate • Esc to cancel' });

        // Buttons
        const buttonContainer = contentEl.createDiv('ai-prompt-buttons');
        
        // Generate button
        const generateButton = buttonContainer.createEl('button', {
            text: 'Generate',
            cls: 'mod-cta'
        });
        generateButton.addEventListener('click', () => this.generate());

        // Cancel button
        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel'
        });
        cancelButton.addEventListener('click', () => {
            this.close();
        });

        // Focus input
        this.promptInput.inputEl.focus();
    }

    private async generate() {
        if (!this.result || this.isGenerating) return;

        this.isGenerating = true;
        const generateButton = this.contentEl.querySelector('button.mod-cta') as HTMLButtonElement;
        if (generateButton) {
            generateButton.setAttr('disabled', 'true');
            generateButton.setText('Generating...');
            setIcon(generateButton, 'loader-2');
            generateButton.addClass('loading');
        }
        
        try {
            const content = await this.aiService.generateContent(
                this.result,
                this.context
            );
            this.onSubmit(content);
            new Notice('Content generated successfully');
            this.close();
        } catch (error) {
            console.error('Generation failed:', error);
            // Show error in UI
            const errorDiv = this.contentEl.createDiv('ai-prompt-error');
            setIcon(errorDiv.createDiv('ai-prompt-error-icon'), 'alert-circle');
            errorDiv.createDiv('ai-prompt-error-message').setText(error.message || 'Generation failed');
        } finally {
            this.isGenerating = false;
            if (generateButton) {
                generateButton.removeAttribute('disabled');
                generateButton.setText('Generate');
                generateButton.removeClass('loading');
            }
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
} 