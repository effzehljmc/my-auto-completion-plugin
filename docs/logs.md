Obsidian Developer Console
plugin:my-auto-completion-plugin:81413 🤖 [2025-02-19T20:13:27.553Z] [ChatAgent] [Init] Initializing ChatAgentService undefined
plugin:my-auto-completion-plugin:81413 🤖 [2025-02-19T20:13:27.553Z] [ChatAgent] [Init] Setting up services undefined
plugin:my-auto-completion-plugin:81413 🤖 [2025-02-19T20:13:27.554Z] [ChatAgent] [Init] Services initialized successfully undefined
plugin:my-auto-completion-plugin:78943 SuggestionPopup.isVisible {visible: false, focused: false, hasContext: false, isNavigating: false}
plugin:my-auto-completion-plugin:78723 SuggestionPopup.close {wasVisible: false, wasFocused: false, wasNavigating: false}
plugin:my-auto-completion-plugin:81413 🤖 [2025-02-19T20:13:41.706Z] [ChatAgent] [Process] Starting message processing {message: 'summarize the note about AI research', hasContext: true, currentFile: 'Prompts', timeSinceLastLog: 14152}
plugin:my-auto-completion-plugin:80550 🤖 [2025-02-19T20:13:41.706Z] [AI] [API] Making API request
Details: {
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "requestSize": 1731
}
plugin:my-auto-completion-plugin:80550 🤖 [2025-02-19T20:13:43.536Z] [AI] [API] API request successful
Details: {
  "responseSize": 814,
  "model": "gpt-4o-2024-08-06",
  "usage": {
    "prompt_tokens": 339,
    "completion_tokens": 60,
    "total_tokens": 399,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "audio_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0,
      "audio_tokens": 0,
      "accepted_prediction_tokens": 0,
      "rejected_prediction_tokens": 0
    }
  }
}
plugin:my-auto-completion-plugin:81413 🤖 [2025-02-19T20:13:43.536Z] [ChatAgent] [Process] Query intent analyzed {type: 'research', confidence: 0.9, topic: 'AI research', timeSinceLastLog: 1830}
plugin:my-auto-completion-plugin:81413 🤖 [2025-02-19T20:13:43.537Z] [ChatAgent] [Search] Looking for relevant document {query: 'summarize the note about AI research', timeSinceLastLog: 1}
plugin:my-auto-completion-plugin:80550 🤖 [2025-02-19T20:13:43.540Z] [AI] [API] Making API request
Details: {
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "requestSize": 2253
}
plugin:my-auto-completion-plugin:80550 🤖 [2025-02-19T20:13:46.098Z] [AI] [API] API request successful
Details: {
  "responseSize": 1041,
  "model": "gpt-4o-2024-08-06",
  "usage": {
    "prompt_tokens": 419,
    "completion_tokens": 104,
    "total_tokens": 523,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "audio_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0,
      "audio_tokens": 0,
      "accepted_prediction_tokens": 0,
      "rejected_prediction_tokens": 0
    }
  }
}
plugin:my-auto-completion-plugin:80550 🤖 [2025-02-19T20:13:46.100Z] [AI] [API] Making API request
Details: {
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "requestSize": 2281
}
plugin:my-auto-completion-plugin:80550 🤖 [2025-02-19T20:13:48.156Z] [AI] [API] API request successful
Details: {
  "responseSize": 966,
  "model": "gpt-4o-2024-08-06",
  "usage": {
    "prompt_tokens": 426,
    "completion_tokens": 88,
    "total_tokens": 514,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "audio_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0,
      "audio_tokens": 0,
      "accepted_prediction_tokens": 0,
      "rejected_prediction_tokens": 0
    }
  }
}
plugin:my-auto-completion-plugin:80550 🤖 [2025-02-19T20:13:48.158Z] [AI] [API] Making API request
Details: {
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "requestSize": 2242
}
plugin:my-auto-completion-plugin:80550 🤖 [2025-02-19T20:13:51.132Z] [AI] [API] API request successful
Details: {
  "responseSize": 1160,
  "model": "gpt-4o-2024-08-06",
  "usage": {
    "prompt_tokens": 410,
    "completion_tokens": 116,
    "total_tokens": 526,
    "prompt_tokens_details": {
      "cached_tokens": 0,
      "audio_tokens": 0
    },
    "completion_tokens_details": {
      "reasoning_tokens": 0,
      "audio_tokens": 0,
      "accepted_prediction_tokens": 0,
      "rejected_prediction_tokens": 0
    }
  }
}
plugin:my-auto-completion-plugin:81413 🤖 [2025-02-19T20:13:51.133Z] [ChatAgent] [Search] Found relevant document {file: 'AI Implementation Research', type: 'research', score: 0.9, timeSinceLastLog: 7596}
plugin:my-auto-completion-plugin:81413 🤖 [2025-02-19T20:13:51.133Z] [ChatAgent] [Process] Found relevant document {file: 'AI Implementation Research', type: 'research', matchedFrom: 'search', timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:81413 🤖 [2025-02-19T20:13:51.133Z] [ChatAgent] [Summary] Handling summarize intent {message: 'summarize the note about AI research', hasContext: true, intent: 'research', timeSinceLastLog: 0}