import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import { AIService } from '../services/ai_service';
import { SettingsService } from '../services/settings_service';

export const CHAT_VIEW_TYPE = 'my-auto-completion-chat';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export class ChatPanel extends ItemView {
    private messages: ChatMessage[] = [];
    private chatContainer: HTMLElement;
    private inputContainer: HTMLElement;
    private modelSelect: HTMLSelectElement;

    constructor(
        leaf: WorkspaceLeaf,
        private aiService: AIService,
        private settingsService: SettingsService
    ) {
        super(leaf);
    }

    getViewType(): string {
        return CHAT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'AI Chat';
    }

    getIcon(): string {
        return 'message-square';
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        this.contentEl = contentEl;

        // Create header with model selection
        const headerEl = contentEl.createDiv('chat-header');
        
        const modelContainer = headerEl.createDiv('model-container');
        modelContainer.createSpan({ text: 'Model: ' });
        
        this.modelSelect = modelContainer.createEl('select', { cls: 'model-select' });
        const models = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o']; // Add more models as needed
        models.forEach(model => {
            const option = this.modelSelect.createEl('option', {
                text: model,
                value: model
            });
            if (model === this.settingsService.getSettings().defaultModel) {
                option.selected = true;
            }
        });

        // Create chat container
        this.chatContainer = contentEl.createDiv('chat-container');

        // Create input container
        this.inputContainer = contentEl.createDiv('chat-input-container');
        const textarea = this.inputContainer.createEl('textarea', {
            cls: 'chat-input',
            attr: { placeholder: 'Type your message...' }
        });

        const sendButton = this.inputContainer.createEl('button', {
            cls: 'chat-send-button',
            text: 'Send'
        });
        setIcon(sendButton, 'arrow-up');

        // Add event listeners
        textarea.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage(textarea.value);
                textarea.value = '';
            }
        });

        sendButton.addEventListener('click', () => {
            this.sendMessage(textarea.value);
            textarea.value = '';
        });

        // Load chat history from local storage
        this.loadChatHistory();
        this.renderMessages();

        // Add styles
        this.addStyles();
    }

    private async sendMessage(content: string) {
        if (!content.trim()) return;

        // Add user message
        const userMessage: ChatMessage = {
            role: 'user',
            content: content.trim(),
            timestamp: Date.now()
        };
        this.messages.push(userMessage);
        this.renderMessages();

        try {
            // Check for document-related commands
            if (content.toLowerCase().includes('summarize')) {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) {
                    throw new Error('No active document to summarize');
                }
                
                // Get AI response
                const response = await this.aiService.generateSummary(activeFile);
                
                // Add AI message
                const aiMessage: ChatMessage = {
                    role: 'assistant',
                    content: response,
                    timestamp: Date.now()
                };
                this.messages.push(aiMessage);
            } else {
                // Handle regular chat messages
                const response = await this.aiService.generateContent(content, {
                    previousParagraphs: [],
                    currentHeading: '',
                    documentStructure: {
                        title: '',
                        headings: []
                    }
                });

                // Add AI message
                const aiMessage: ChatMessage = {
                    role: 'assistant',
                    content: response,
                    timestamp: Date.now()
                };
                this.messages.push(aiMessage);
            }
            
            this.renderMessages();
            this.saveChatHistory();
        } catch (error) {
            // Add error message
            const errorMessage: ChatMessage = {
                role: 'assistant',
                content: 'Error: ' + error.message,
                timestamp: Date.now()
            };
            this.messages.push(errorMessage);
            this.renderMessages();
            this.saveChatHistory();
        }
    }

    private renderMessages() {
        this.chatContainer.empty();
        
        this.messages.forEach(message => {
            const messageEl = this.chatContainer.createDiv(`chat-message ${message.role}`);
            const contentEl = messageEl.createDiv('message-content');
            contentEl.createSpan({ text: message.content });
            
            const timeEl = messageEl.createDiv('message-time');
            timeEl.createSpan({ text: new Date(message.timestamp).toLocaleTimeString() });
        });

        // Scroll to bottom
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    private loadChatHistory() {
        const savedHistory = localStorage.getItem('my-auto-completion-chat-history');
        if (savedHistory) {
            this.messages = JSON.parse(savedHistory);
        }
    }

    private saveChatHistory() {
        localStorage.setItem('my-auto-completion-chat-history', JSON.stringify(this.messages));
    }

    private addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .chat-header {
                padding: 10px;
                border-bottom: 1px solid var(--background-modifier-border);
            }
            
            .model-container {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .model-select {
                flex: 1;
            }
            
            .chat-container {
                flex: 1;
                overflow-y: auto;
                padding: 10px;
            }
            
            .chat-message {
                margin-bottom: 10px;
                padding: 8px;
                border-radius: 6px;
                max-width: 85%;
            }
            
            .chat-message.user {
                margin-left: auto;
                background-color: var(--interactive-accent);
                color: var(--text-on-accent);
            }
            
            .chat-message.assistant {
                margin-right: auto;
                background-color: var(--background-modifier-form-field);
            }
            
            .message-content {
                word-break: break-word;
            }
            
            .message-time {
                font-size: 0.8em;
                opacity: 0.7;
                margin-top: 4px;
            }
            
            .chat-input-container {
                display: flex;
                gap: 8px;
                padding: 10px;
                border-top: 1px solid var(--background-modifier-border);
            }
            
            .chat-input {
                flex: 1;
                resize: none;
                min-height: 38px;
                max-height: 150px;
                padding: 8px;
                border-radius: 4px;
                background-color: var(--background-modifier-form-field);
                border: 1px solid var(--background-modifier-border);
            }
            
            .chat-send-button {
                padding: 8px;
                border-radius: 4px;
                background-color: var(--interactive-accent);
                color: var(--text-on-accent);
                cursor: pointer;
            }
            
            .chat-send-button:hover {
                background-color: var(--interactive-accent-hover);
            }
        `;
        document.head.appendChild(style);
    }
} 