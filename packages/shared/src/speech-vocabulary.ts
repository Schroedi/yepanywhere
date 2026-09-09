export interface SpeechVocabularyWord {
  word: string;
  user: number;
  assistant: number;
}

export interface SpeechVocabularyStatus {
  generation: number;
  enabled: boolean;
  biasing: boolean;
  hours: number;
  totals: { words: number; user: number; assistant: number };
  /** Present only when the lexicon view requests includeWords=1; at most 2000. */
  words?: SpeechVocabularyWord[];
  scan: {
    state: "idle" | "scanning" | "error";
    sessions: number;
    messages: number;
    error?: string;
  };
  integration: "grok-via-ya";
}
