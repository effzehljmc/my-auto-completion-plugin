import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import { AIService } from '../services/ai_service';
import { SettingsService } from '../services/settings_service';
import MyAutoCompletionPlugin from '../main';
import { ChatAgentService } from '../services/chat_agent_service';
import { ProviderService } from '../services/provider_service';
import { UIService } from '../services/ui_service';

export const CHAT_VIEW_TYPE = 'my-auto-completion-chat';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

interface Chat {
    id: string;
    title: string;
    messages: ChatMessage[];
    createdAt: number;
}

export class ChatPanel extends ItemView {
    private chats: Chat[] = [];
    private currentChatId: string | null = null;
    private chatContainer: HTMLElement;
    private inputContainer: HTMLElement;
    private modelSelect: HTMLSelectElement;
    private chatListContainer: HTMLElement;
    private plugin: MyAutoCompletionPlugin;
    private chatAgent: ChatAgentService;

    constructor(
        leaf: WorkspaceLeaf,
        private aiService: AIService,
        private settingsService: SettingsService,
        private providerService: ProviderService,
        private uiService: UIService,
        plugin: MyAutoCompletionPlugin
    ) {
        super(leaf);
        this.plugin = plugin;
        this.chatAgent = new ChatAgentService(
            this.app,
            aiService,
            providerService,
            uiService,
            settingsService
        );
        this.loadChatHistory();
    }

    getViewType(): string {
        return CHAT_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Obsidian Agent';
    }

    getIcon(): string {
        return 'message-square';
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        this.contentEl = contentEl;

        // Create main container with split view
        const mainContainer = contentEl.createDiv('chat-main-container');
        
        // Create sidebar for chat list
        const sidebarContainer = mainContainer.createDiv('chat-sidebar');
        
        // Create new chat button
        const newChatButton = sidebarContainer.createEl('button', {
            cls: 'chat-new-button',
            attr: { title: 'New Chat' }
        });
        setIcon(newChatButton, 'plus');
        
        // Create chat list container
        this.chatListContainer = sidebarContainer.createDiv('chat-list');
        
        // Create chat content container
        const chatContentContainer = mainContainer.createDiv('chat-content');

        // Create header with model selection
        const headerEl = chatContentContainer.createDiv('chat-header');
        
        const modelContainer = headerEl.createDiv('model-container');
        modelContainer.createSpan({ text: 'Model: ' });
        
        this.modelSelect = modelContainer.createEl('select', { cls: 'model-select' });
        const models = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o'];
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
        this.chatContainer = chatContentContainer.createDiv('chat-container');

        // Create input container
        this.inputContainer = chatContentContainer.createDiv('chat-input-container');
        const textarea = this.inputContainer.createEl('textarea', {
            cls: 'chat-input',
            attr: { placeholder: 'Type your message...' }
        });

        const sendButton = this.inputContainer.createEl('button', {
            cls: 'chat-send-button'
        });
        setIcon(sendButton, 'arrow-up');

        // Add event listeners
        textarea.addEventListener('keydown', async (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const content = textarea.value.trim();
                if (content) {
                    textarea.value = '';
                    await this.sendMessage(content);
                }
            }
        });

        sendButton.addEventListener('click', async () => {
            const content = textarea.value.trim();
            if (content) {
                textarea.value = '';
                await this.sendMessage(content);
            }
        });

        newChatButton.addEventListener('click', () => {
            this.createNewChat();
        });

        // Load chat history
        await this.loadChatHistory();
        
        // Create new chat if none exists
        if (this.chats.length === 0) {
            this.createNewChat();
        } else {
            this.currentChatId = this.chats[0].id;
        }
        
        this.renderChatList();
        this.renderMessages();

        // Add styles
        this.addStyles();
    }

    private createNewChat() {
        const newChat: Chat = {
            id: Date.now().toString(),
            title: `Chat ${this.chats.length + 1}`,
            messages: [],
            createdAt: Date.now()
        };
        
        this.chats.push(newChat);
        this.currentChatId = newChat.id;
        this.saveChatHistory();
        this.renderChatList();
        this.renderMessages();
    }

    private getCurrentChat(): Chat | undefined {
        return this.chats.find(chat => chat.id === this.currentChatId);
    }

    private async sendMessage(content: string) {
        if (!content.trim()) return;

        const currentChat = this.getCurrentChat();
        if (!currentChat) return;

        try {
            // Add user message
            currentChat.messages.push({
                role: 'user',
                content: content.trim(),
                timestamp: Date.now()
            });

            // Update UI immediately with user message
            this.renderMessages();

            // Get the current file context
            const currentFile = this.app.workspace.getActiveFile();
            const context = currentFile ? {
                previousParagraphs: [] as string[],
                currentHeading: '',
                documentStructure: {
                    title: currentFile.basename,
                    headings: [] as string[]
                },
                sourceFile: currentFile
            } : undefined;

            // Process message using ChatAgentService
            const response = await this.chatAgent.processMessage(content, context);
            
            if (response) {
                // Add assistant message with the user-facing response
                currentChat.messages.push({
                    role: 'assistant',
                    content: response,
                    timestamp: Date.now()
                });

                // Update UI and save
                this.renderMessages();
                await this.saveChatHistory();
            } else {
                // Handle no response
                currentChat.messages.push({
                    role: 'assistant',
                    content: "I'm sorry, but I couldn't process your request. Could you please try again?",
                    timestamp: Date.now()
                });
                this.renderMessages();
                await this.saveChatHistory();
            }
        } catch (error) {
            console.error('Error sending message:', error);
            
            // Add error message to chat
            currentChat.messages.push({
                role: 'assistant',
                content: "I encountered an error while processing your request. Please try again.",
                timestamp: Date.now()
            });
            this.renderMessages();
            await this.saveChatHistory();
        }
    }

    /**
     * Get formatted conversation history for context
     */
    private getConversationHistory(chat: Chat): string {
        return chat.messages
            .slice(-4) // Only use last 4 messages for context
            .map(msg => `${msg.role}: ${msg.content}`)
            .join('\n');
    }

    private generateChatTitle(content: string): string {
        // Generate a short title from the first message
        const words = content.split(' ').slice(0, 4);
        return words.join(' ') + (words.length >= 4 ? '...' : '');
    }

    private async loadChatHistory() {
        try {
            const data = await this.plugin.loadData();
            const savedHistory = data?.chatHistory;
            
            if (savedHistory) {
                // Validate the parsed data
                if (Array.isArray(savedHistory) && savedHistory.every(chat => 
                    typeof chat === 'object' && 
                    typeof chat.id === 'string' &&
                    typeof chat.title === 'string' &&
                    Array.isArray(chat.messages) &&
                    typeof chat.createdAt === 'number'
                )) {
                    this.chats = savedHistory;
                } else {
                    // If data is invalid, start fresh
                    this.chats = [];
                    await this.saveChatHistory(); // Clear invalid data
                }
            }
        } catch (error) {
            console.error('Failed to load chat history:', error);
            this.chats = [];
            await this.saveChatHistory(); // Clear invalid data
        }
    }

    private async saveChatHistory() {
        try {
            const data = await this.plugin.loadData() || {};
            data.chatHistory = this.chats;
            await this.plugin.saveData(data);
        } catch (error) {
            console.error('Failed to save chat history:', error);
        }
    }

    private formatDate(timestamp: number): string {
        try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) {
                return 'Unknown date';
            }
            
            // Check if it's today
            const today = new Date();
            if (date.toDateString() === today.toDateString()) {
                return 'Today';
            }
            
            // Check if it's yesterday
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            if (date.toDateString() === yesterday.toDateString()) {
                return 'Yesterday';
            }
            
            // For other dates, use a more friendly format
            return date.toLocaleDateString(undefined, { 
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch (error) {
            return 'Unknown date';
        }
    }

    private formatTime(timestamp: number): string {
        try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) {
                return '';
            }
            return date.toLocaleTimeString(undefined, { 
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            return '';
        }
    }

    private renderChatList() {
        this.chatListContainer.empty();
        
        this.chats.forEach(chat => {
            const chatEl = this.chatListContainer.createDiv({
                cls: `chat-list-item ${chat.id === this.currentChatId ? 'active' : ''}`
            });
            
            // Create container for title and date
            const contentEl = chatEl.createDiv('chat-list-content');
            
            const titleEl = contentEl.createDiv('chat-list-title');
            titleEl.createSpan({ text: chat.title || 'Untitled Chat' });
            
            const dateEl = contentEl.createDiv('chat-list-date');
            dateEl.createSpan({ text: this.formatDate(chat.createdAt) });
            
            // Add delete button
            const deleteBtn = chatEl.createDiv({
                cls: 'chat-list-delete',
                attr: { 'aria-label': 'Delete chat' }
            });
            setIcon(deleteBtn, 'trash');
            
            // Handle click on chat item (excluding delete button)
            contentEl.addEventListener('click', () => {
                this.currentChatId = chat.id;
                this.renderChatList();
                this.renderMessages();
            });
            
            // Handle delete button click
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteChat(chat.id);
            });
        });
    }

    private async deleteChat(chatId: string) {
        // Remove chat from list
        this.chats = this.chats.filter(c => c.id !== chatId);
        
        // If deleted chat was current, switch to most recent chat
        if (chatId === this.currentChatId) {
            this.currentChatId = this.chats.length > 0 ? this.chats[0].id : null;
        }
        
        // Update UI and save changes
        this.renderChatList();
        this.renderMessages();
        await this.saveChatHistory();
    }

    private renderMessages() {
        this.chatContainer.empty();
        
        const currentChat = this.getCurrentChat();
        if (!currentChat || !Array.isArray(currentChat.messages)) {
            return;
        }
        
        currentChat.messages.forEach(message => {
            if (!message || typeof message !== 'object') return;
            
            const messageEl = this.chatContainer.createDiv(`chat-message ${message.role}`);
            const contentEl = messageEl.createDiv('message-content');
            contentEl.createSpan({ text: message.content || '' });
            
            const timeEl = messageEl.createDiv('message-time');
            const timeStr = this.formatTime(message.timestamp);
            if (timeStr) {
                timeEl.createSpan({ text: timeStr });
            }
        });

        // Scroll to bottom
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    private addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .chat-main-container {
                display: flex;
                height: 100%;
            }
            
            .chat-sidebar {
                width: 200px;
                border-right: 1px solid var(--background-modifier-border);
                display: flex;
                flex-direction: column;
            }
            
            .chat-new-button {
                margin: 10px;
                padding: 8px;
                background-color: var(--interactive-accent);
                color: var(--text-on-accent);
                border: none;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .chat-new-button:hover {
                background-color: var(--interactive-accent-hover);
            }
            
            .chat-list {
                flex: 1;
                overflow-y: auto;
                padding: 10px;
            }
            
            .chat-list-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px;
                margin-bottom: 8px;
                border-radius: 4px;
                cursor: pointer;
                transition: background-color 0.2s;
            }
            
            .chat-list-content {
                flex: 1;
                min-width: 0; /* Enable text truncation */
                margin-right: 8px;
            }
            
            .chat-list-title {
                font-weight: 500;
                margin-bottom: 4px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            
            .chat-list-date {
                font-size: 0.8em;
                opacity: 0.7;
            }
            
            .chat-list-delete {
                opacity: 0;
                color: var(--text-muted);
                cursor: pointer;
                padding: 4px;
                border-radius: 4px;
                transition: all 0.2s;
            }
            
            .chat-list-delete:hover {
                color: var(--text-error);
                background-color: var(--background-modifier-error);
            }
            
            .chat-list-item:hover .chat-list-delete {
                opacity: 1;
            }
            
            .chat-list-item.active .chat-list-delete {
                opacity: 1;
            }
            
            /* Ensure delete button doesn't affect the active state background */
            .chat-list-item.active {
                background-color: var(--background-modifier-active);
            }
            
            .chat-list-item:hover {
                background-color: var(--background-modifier-hover);
            }
            
            .chat-content {
                flex: 1;
                display: flex;
                flex-direction: column;
                height: 100%;
            }
            
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
                min-height: 38px;
                max-height: 200px;
                resize: vertical;
                padding: 8px;
                border-radius: 4px;
                border: 1px solid var(--background-modifier-border);
                background-color: var(--background-modifier-form-field);
            }
            
            .chat-send-button {
                padding: 8px;
                background-color: var(--interactive-accent);
                color: var(--text-on-accent);
                border: none;
                border-radius: 4px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .chat-send-button:hover {
                background-color: var(--interactive-accent-hover);
            }
        `;
        document.head.appendChild(style);
    }
} 