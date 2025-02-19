Console was cleared
undefined
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:54.620Z] [ChatAgent] [Process] Starting message processing {message: 'generate a summary of the ai implementation research note', hasContext: true, currentFile: 'Planning Meeting Notes', timeSinceLastLog: 21313}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:54.621Z] [ChatAgent] [FileMatch] Starting file search {query: 'generate a summary of the ai implementation research note', normalizedQuery: 'generate a summary of the ai implementation research note', totalFiles: 11, hasContext: true, timeSinceLastLog: 1}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:54.621Z] [ChatAgent] [FileMatch] Direct match found {fileName: 'planning meeting notes', query: 'generate a summary of the ai implementation research note', matchType: 'direct', timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:54.621Z] [ChatAgent] [FileMatch] Checking current file {fileName: 'planning meeting notes', isRelevant: true, timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:54.621Z] [ChatAgent] [FileMatch] Direct match found {fileName: 'planning meeting notes', query: 'generate a summary of the ai implementation research note', matchType: 'direct', timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:54.621Z] [ChatAgent] [FileMatch] Using current file {fileName: 'planning meeting notes', timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:54.621Z] [ChatAgent] [Process] Found relevant file {file: 'Planning Meeting Notes', path: 'Planning Meeting Notes.md', matchedFrom: 'context', timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:54.628Z] [ChatAgent] [Intent] Starting intent analysis {messageLength: 57, hasContext: true, timeSinceLastLog: 7}
plugin:my-auto-completion-plugin:80517 🤖 [2025-02-19T00:48:54.629Z] [AI] [API] Making API request
Details: {
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "requestSize": 2120
}
plugin:my-auto-completion-plugin:80517 🤖 [2025-02-19T00:48:57.698Z] [AI] [API] API request successful
Details: {
  "responseSize": 1313,
  "model": "gpt-4o-2024-08-06",
  "usage": {
    "prompt_tokens": 388,
    "completion_tokens": 150,
    "total_tokens": 538,
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
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:57.699Z] [ChatAgent] [Process] Intent analyzed {intent: 'summarize', confidence: 0.9, subIntent: 'research', timeSinceLastLog: 3071}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:57.699Z] [ChatAgent] [Summary] Starting summary generation {subIntent: 'research', hasContext: true, currentFile: 'Planning Meeting Notes.md', messageLength: 57, timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:57.701Z] [ChatAgent] [Summary] File content loaded {fileSize: 547, fileName: 'Planning Meeting Notes', timeSinceLastLog: 2}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:57.701Z] [ChatAgent] [Context] Creating enhanced context {fileBasename: 'Planning Meeting Notes', contentLength: 547, hasBaseContext: true, timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:80517 🤖 [2025-02-19T00:48:57.701Z] [AI] [API] Making API request
Details: {
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "requestSize": 2130
}
plugin:my-auto-completion-plugin:80517 🤖 [2025-02-19T00:48:59.399Z] [AI] [API] API request successful
Details: {
  "responseSize": 929,
  "model": "gpt-4o-2024-08-06",
  "usage": {
    "prompt_tokens": 403,
    "completion_tokens": 76,
    "total_tokens": 479,
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
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:59.399Z] [ChatAgent] [Context] Document type analysis received {analysisLength: 345, timeSinceLastLog: 1698}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:48:59.400Z] [ChatAgent] [Context] Document type determined {type: 'meeting', confidence: 0.95, timeSinceLastLog: 1}
plugin:my-auto-completion-plugin:80517 🤖 [2025-02-19T00:48:59.400Z] [AI] [API] Making API request
Details: {
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "requestSize": 2522
}
plugin:my-auto-completion-plugin:80517 🤖 [2025-02-19T00:49:03.637Z] [AI] [API] API request successful
Details: {
  "responseSize": 1532,
  "model": "gpt-4o-2024-08-06",
  "usage": {
    "prompt_tokens": 458,
    "completion_tokens": 202,
    "total_tokens": 660,
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
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:49:03.637Z] [ChatAgent] [Context] Detailed analysis received {analysisLength: 887, timeSinceLastLog: 4237}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:49:03.637Z] [ChatAgent] [Context] Analysis parsed {hasKeyPoints: true, hasReferences: false, keyPointCount: 4, timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:49:03.637Z] [ChatAgent] [Context] Creating basic context {fileBasename: 'Planning Meeting Notes', contentLength: 547, hasBaseContext: true, timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:49:03.638Z] [ChatAgent] [Context] Extracted document structure {paragraphCount: 5, headingCount: 5, timeSinceLastLog: 1}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:49:03.638Z] [ChatAgent] [Summary] Enhanced context created {contextType: 'meeting', hasKeyPoints: true, keyPointsCount: 4, timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:49:03.638Z] [ChatAgent] [Summary] Creating summary prompt {documentType: 'meeting', hasKeyPoints: true, hasReferences: false, timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:49:03.638Z] [ChatAgent] [Summary] Created prompt {promptLength: 290, promptType: 'meeting', timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:49:03.638Z] [ChatAgent] [Summary] Generating summary {promptLength: 487, contextType: 'meeting', prompt: 'Provide a clear and structured summary of this mee… points where appropriate for better readability.', timeSinceLastLog: 0}
plugin:my-auto-completion-plugin:80517 🤖 [2025-02-19T00:49:03.639Z] [AI] [API] Making API request
Details: {
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "requestSize": 2251
}
plugin:my-auto-completion-plugin:80517 🤖 [2025-02-19T00:49:06.154Z] [AI] [API] API request successful
Details: {
  "responseSize": 1222,
  "model": "gpt-4o-2024-08-06",
  "usage": {
    "prompt_tokens": 433,
    "completion_tokens": 133,
    "total_tokens": 566,
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
plugin:my-auto-completion-plugin:81301 🤖 [2025-02-19T00:49:06.154Z] [ChatAgent] [Summary] Summary generated {summaryLength: 635, processingTime: 2516, content: '**Key Decisions:**\n- Q1 deliverables were reviewed…Mike.\n- The meeting took place on March 15, 2024.', context: {…}, timeSinceLastLog: 2516}