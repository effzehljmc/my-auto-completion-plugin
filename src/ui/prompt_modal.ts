import { App, Modal, Setting, TextAreaComponent } from 'obsidian';
import { AIService, DocumentContext } from '../services/ai_service';

export class AIPromptModal extends Modal {
    private result: string;
    private onSubmit: (result: string) => void;
    private promptInput: TextAreaComponent;
    private aiService: AIService;
    private context: DocumentContext;

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
        contentEl.addClass('ai-prompt-modal');

        // Header
        contentEl.createEl('h2', { text: 'AI Content Generation' });
        
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

        // Buttons
        const buttonContainer = contentEl.createDiv('ai-prompt-buttons');
        
        // Generate button
        const generateButton = buttonContainer.createEl('button', {
            text: 'Generate',
            cls: 'mod-cta'
        });
        generateButton.addEventListener('click', async () => {
            if (!this.result) return;
            
            generateButton.setAttr('disabled', 'true');
            generateButton.setText('Generating...');
            
            try {
                const content = await this.aiService.generateContent(
                    this.result,
                    this.context
                );
                this.onSubmit(content);
                this.close();
            } catch (error) {
                console.error('Generation failed:', error);
                // Show error in UI
                const errorDiv = contentEl.createDiv('ai-prompt-error');
                errorDiv.setText('Generation failed: ' + error.message);
            } finally {
                generateButton.removeAttribute('disabled');
                generateButton.setText('Generate');
            }
        });

        // Cancel button
        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel'
        });
        cancelButton.addEventListener('click', () => {
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// Styles for the modal
const styles = `
.ai-prompt-modal {
    padding: 20px;
}

.ai-prompt-input {
    width: 100%;
    min-height: 100px;
    font-family: var(--font-monospace);
    resize: vertical;
}

.ai-prompt-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 20px;
}

.ai-prompt-error {
    color: var(--text-error);
    margin-top: 10px;
    padding: 10px;
    border: 1px solid var(--background-modifier-error);
    border-radius: 4px;
}
`; 