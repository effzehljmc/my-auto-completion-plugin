# Plugin Architecture

## Class Structure
```mermaid
classDiagram
    class MyAutoCompletionPlugin {
        -settingsService: SettingsService
        -providerService: ProviderService
        -uiService: UIService
        -aiService: AIService
        -chatPanel: ChatPanel
        +onload()
        +onunload()
        +getSettings()
        +saveSettings()
        -setupCommands()
        -onFileOpened()
    }

    class ChatPanel {
        -chats: Chat[]
        -currentChatId: string
        -chatAgent: ChatAgentService
        +getViewType()
        +getDisplayText()
        +getIcon()
        +onOpen()
        -createNewChat()
        -sendMessage()
        -loadChatHistory()
        -saveChatHistory()
    }

    class ChatAgentService {
        -app: App
        -aiService: AIService
        -providerService: ProviderService
        -uiService: UIService
        -settingsService: SettingsService
        +processMessage()
        -readFileContent()
        -openFile()
        -createFile()
        -searchFiles()
        -getCurrentFile()
    }

    class SettingsService {
        -plugin: Plugin
        -settings: MyAutoCompletionSettings
        +loadSettings()
        +saveSettings()
        +getSettings()
        +updateSetting()
    }

    class ProviderService {
        -providers: SuggestionProvider[]
        -app: App
        -settingsService: SettingsService
        +getProviders()
        +reloadProviders()
        +loadAllProviders()
        +scanCurrentFile()
    }

    class UIService {
        -suggestionPopup: SuggestionPopup
        -snippetManager: SnippetManager
        -periodInserter: PeriodInserter
        -app: App
        -settingsService: SettingsService
        +getSuggestionPopup()
        +getSnippetManager()
        +getPeriodInserter()
        +unload()
    }

    class AIService {
        -app: App
        -settingsService: SettingsService
        -apiKey: string
        +initialize()
        +getCompletionSuggestions()
        +generateContent()
        +generateSummary()
        +checkMarkdownFormatting()
    }

    class SuggestionProvider {
        <<interface>>
        +loadSuggestions()
    }

    MyAutoCompletionPlugin --> SettingsService
    MyAutoCompletionPlugin --> ProviderService
    MyAutoCompletionPlugin --> UIService
    MyAutoCompletionPlugin --> AIService
    MyAutoCompletionPlugin --> ChatPanel
    ChatPanel --> ChatAgentService
    ChatAgentService --> AIService
    ChatAgentService --> ProviderService
    ChatAgentService --> UIService
    ChatAgentService --> SettingsService
    ProviderService --> SettingsService
    UIService --> SettingsService
    AIService --> SettingsService
    ProviderService --> SuggestionProvider
    SuggestionProvider <|.. Callout
    SuggestionProvider <|.. FileScanner
    SuggestionProvider <|.. WordList

```

## Interaction Flow
```mermaid
sequenceDiagram
    participant Plugin as MyAutoCompletionPlugin
    participant Settings as SettingsService
    participant Provider as ProviderService
    participant UI as UIService
    participant AI as AIService
    participant Chat as ChatPanel
    participant Agent as ChatAgentService
    participant Editor as EditorView

    Plugin->>Settings: loadSettings()
    activate Settings
    Settings-->>Plugin: settings loaded
    deactivate Settings

    Plugin->>Provider: new ProviderService()
    activate Provider
    Provider->>Settings: getSettings()
    Provider->>Provider: initializeProviders()
    Provider-->>Plugin: provider service ready
    deactivate Provider

    Plugin->>UI: new UIService()
    activate UI
    UI->>Settings: getSettings()
    UI->>UI: initializeComponents()
    UI-->>Plugin: UI service ready
    deactivate UI

    Plugin->>AI: new AIService()
    activate AI
    AI->>Settings: getSettings()
    AI->>AI: initialize()
    AI-->>Plugin: AI service ready
    deactivate AI

    Plugin->>Chat: new ChatPanel()
    activate Chat
    Chat->>Agent: new ChatAgentService()
    Chat->>Chat: loadChatHistory()
    Chat-->>Plugin: chat panel ready
    deactivate Chat

    Plugin->>Editor: register editor extensions
    Plugin->>Editor: register suggestion popup

    Note over Editor: User types in editor

    Editor->>UI: trigger suggestion popup
    activate UI
    UI->>Provider: get suggestions from providers
    Provider-->>UI: return provider suggestions
    UI->>AI: get AI-powered suggestions
    AI-->>UI: return AI suggestions
    UI-->>Editor: show combined suggestions
    deactivate UI

    Note over Editor: User selects suggestion

    Editor->>UI: apply selected suggestion
    activate UI
    UI->>Editor: update editor content
    UI->>AI: request formatting check
    AI-->>UI: return formatting suggestions
    UI-->>Editor: apply formatting improvements
    deactivate UI

    Note over Chat: User sends message

    Chat->>Agent: processMessage()
    activate Agent
    Agent->>AI: analyze message
    AI-->>Agent: return analysis
    Agent->>Editor: get current file context
    Editor-->>Agent: return context
    Agent->>AI: generate response
    AI-->>Agent: return response
    Agent-->>Chat: return formatted response
    deactivate Agent

    Note over Editor: User requests content generation

    Editor->>AI: generate content
    activate AI
    AI->>AI: analyze context
    AI->>AI: generate text
    AI-->>Editor: return generated content
    deactivate AI
```

The architecture follows a modular design with six main services:

1. **SettingsService**
   - Manages plugin settings
   - Handles loading/saving settings
   - Provides settings access to other services

2. **ProviderService**
   - Manages suggestion providers (Callout, FileScanner, WordList)
   - Handles provider lifecycle
   - Coordinates provider operations

3. **UIService**
   - Manages UI components
   - Handles suggestion popup
   - Manages snippet and period insertion

4. **AIService**
   - Provides AI-powered completions and suggestions
   - Handles content generation and formatting
   - Manages API communication with AI service

5. **ChatPanel**
   - Manages chat interface UI
   - Handles chat history persistence
   - Provides model selection
   - Manages message display and input

6. **ChatAgentService**
   - Processes user messages
   - Manages file operations through Obsidian API
   - Coordinates between AI and UI services
   - Handles command detection and execution

The main plugin class (`MyAutoCompletionPlugin`) orchestrates these services and handles:
- Plugin lifecycle (load/unload)
- Command registration
- Editor extension setup
- Event listeners
- Chat panel integration

The interaction flow shows how these components work together when:
- The plugin loads
- The user types in the editor
- Suggestions are displayed and selected
- Content is generated or formatted
- Chat messages are processed and responded to 