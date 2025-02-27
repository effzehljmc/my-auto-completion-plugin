# Technical Specification

## System Overview
The system is a plugin for Obsidian, designed to enhance user interactions through AI-driven functionalities. The primary purpose is to provide intelligent auto-completion, content generation, and action management within the Obsidian environment. The main components include frontend UI elements, backend services for AI interaction, and integration with Obsidian's APIs. Key roles are played by services like `ActionGeneratorService`, `AIService`, `ChatAgentService`, and `UIService`, which handle core functionalities such as action generation, AI-driven content creation, and user interface interactions.

## Core Functionality

### ActionGeneratorService
- **generateActions(message: string, context: DocumentContext): Promise<AgentAction[]>**
  - Analyzes user input to determine intent and generates a list of `AgentAction` objects. Utilizes AI to analyze the message and suggest actions, filters and sorts actions based on confidence and priority, and queues actions that require sequential execution.
- **analyzeIntent(message: string, context: DocumentContext): Promise<ActionAnalysis>**
  - Uses AI to analyze the user's message and determine the primary intent and potential actions. Returns an `ActionAnalysis` object containing the intent, confidence level, suggested actions, and other metadata.
- **createAction(actionType: AgentAction['type'], message: string, context: DocumentContext, baseConfidence: number, analysis: ActionAnalysis): Promise<AgentAction | null>**
  - Creates a specific `AgentAction` based on the action type, message, context, and analysis. Parses commands if the action type is a command and sets metadata such as priority, category, impact, and whether confirmation is required.
- **getAISuggestedActions(message: string, context: DocumentContext): Promise<ActionSuggestion[]>**
  - Uses AI to suggest additional actions that might be helpful based on the user's message. Returns a list of `ActionSuggestion` objects.
- **convertSuggestionsToActions(suggestions: ActionSuggestion[], context: DocumentContext): Promise<AgentAction[]>**
  - Converts a list of `ActionSuggestion` objects into `AgentAction` objects. Filters suggestions based on confidence threshold.
- **filterAndSortActions(actions: AgentAction[]): AgentAction[]**
  - Filters actions based on confidence threshold and sorts them by priority and confidence. Limits the number of actions to the top 5.
- **queueSequentialActions(actions: AgentAction[]): void**
  - Queues actions that require sequential execution, ensuring they don’t exceed the maximum concurrent actions limit.
- **executeQueuedActions(): Promise<ActionExecutionResult[]>**
  - Executes actions from the queue and returns the results. Handles success and failure cases, logging appropriate messages.
- **cleanup(): void**
  - Clears the action queue.

### AIService
- **getCompletionSuggestions(currentText: string, context?: DocumentContext, conversationHistory?: string): Promise<AICompletionResponse[]>**
  - Retrieves real-time completion suggestions with improved context handling.
- **generateContent(prompt: string, context?: DocumentContext, options?: AIRequestOptions): Promise<string>**
  - Generates content based on a user prompt.
- **generateSummary(file: TFile): Promise<string>**
  - Generates a summary of the current document.
- **checkMarkdownFormatting(text: string, editor: Editor): Promise<string[]>**
  - Checks and suggests improvements for Markdown formatting.
- **processMessage(message: string, conversationHistory?: string): Promise<AICompletionResponse[]>**
  - Processes a user message with enhanced error handling and recovery.

### ChatAgentService
- **handleMessage(message: string, context?: DocumentContext): Promise<string>**
  - Primary entry point for processing user messages. Delegates the message to `processMessage` for further handling.
- **processMessage(message: string, context?: DocumentContext): Promise<string>**
  - Processes the user message by finding relevant files, analyzing intent, and handling different intents (summarize, command, action, question). Coordinates with various sub-services to fulfill the user's request.
- **findRelevantFile(message: string, context?: DocumentContext): Promise<TFile | null>**
  - Searches for a file that is relevant to the user's message. Checks for exact and partial matches based on the file name.
- **isFileNameRelevant(fileName: string, query: string): boolean**
  - Determines if a file name is relevant to a given query using significant word matching.
- **createEnhancedContext(content: string, file: TFile, baseContext: DocumentContext): Promise<EnhancedDocumentContext>**
  - Creates an enhanced context for a document by analyzing its content and structure.
- **summarizeDocument(context: DocumentContext): Promise<string>**
  - Generates a summary of the current document.
- **handleSummarizeIntent(message: string, context: DocumentContext, intent: IntentAnalysis): Promise<string>**
  - Handles the intent to summarize a document.
- **handleCommandIntent(message: string, context: DocumentContext): Promise<string>**
  - Handles command intents by parsing and executing commands using the `CommandService`.
- **handleActionIntent(message: string, context: DocumentContext): Promise<string>**
  - Handles action intents by generating and executing actions using the `ActionGeneratorService`.
- **handleQuestionIntent(message: string, context: DocumentContext, intent: IntentAnalysis): Promise<string>**
  - Handles question intents by generating content based on the user's question and the current context.
- **analyzeIntent(message: string, context?: DocumentContext): Promise<IntentAnalysis>**
  - Analyzes the intent of the user's message. Uses the `AIService` to generate an intent analysis and handles retries if necessary.

### UIService
- **getCombinedSuggestions**
  - Retrieves and combines suggestions from both AI and providers, implementing caching, sorting, and relevance scoring.
- **handleSuggestionSelection**
  - Handles the selection of a suggestion and applies it to the editor.
- **showPromptModal**
  - Displays a modal for content generation based on a given context and handles the generated content.
- **generateContent**
  - Generates content based on a user-provided prompt and document context.

### Complex Business Logic
- **Confidence Adjustment**
  - Adjusts the confidence level of actions based on factors like file access requirements and destructiveness.
- **Action Prioritization and Sorting**
  - Actions are filtered and sorted based on confidence and priority to ensure the most relevant actions are executed first.
- **Sequential Action Execution**
  - Manages a queue for actions that require sequential execution, ensuring they are handled in order and within concurrency limits.
- **Intent Analysis and Retry Mechanism**
  - Analyzes user intent with improved error handling and validation, including a retry mechanism for failed JSON parsing.
- **Enhanced Context Creation**
  - Creates enhanced context for document processing with improved error handling.

## Architecture
The system is structured to facilitate seamless interaction between the user, AI services, and Obsidian's APIs. Data flows from user input through various services that process, analyze, and generate responses. Key data flow patterns include:
1. **User Input**: Captured through the UI, sent to services like `ChatAgentService` for processing.
2. **AI Interaction**: `AIService` handles requests for content generation, intent analysis, and suggestion retrieval.
3. **Action Management**: `ActionGeneratorService` generates and manages actions based on user intent and context.
4. **UI Updates**: `UIService` handles the display of suggestions, content, and other UI elements, ensuring a responsive and interactive user experience.
5. **Persistence**: Chat history and settings are saved and loaded using Obsidian's persistent storage mechanisms.