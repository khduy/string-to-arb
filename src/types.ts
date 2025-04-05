import * as vscode from 'vscode';

// --- Interfaces ---
export interface GeminiRequest {
  contents: { parts: { text: string }[] }[]; // Updated to match API spec (array of contents)
  generationConfig: {
    temperature: number;
    topP: number;
    topK: number;
    maxOutputTokens: number;
  };
}

export interface GeminiResponse {
  candidates: {
    content: {
      parts: { text: string }[];
    };
  }[];
  // Optional: Include error field if API returns structured errors
  // error?: { code: number; message: string; status: string; };
}

export interface ArbContent {
  [key: string]: string | any; // Allow for metadata like @key
}

export interface ExtensionConfig {
  arbFolderPath: string;
  sourceLanguage: string;
  fileNamePattern: string;
  prefix: string;
  autoTranslate: boolean;
  geminiApiKey?: string;
  importStatement?: string;
  postExtractionCommand?: string;
}

export interface PlaceholderInfo {
  originalPlaceholders: string[]; // Full Dart expressions: "data.code!"
  arbPlaceholders: string[];     // Simplified for ARB: "code"
  arbText: string;               // Text with ARB placeholders: "Order {code}"
}

export interface ConflictResult {
  shouldReturn: boolean;
  keyUsed?: string;
  keyToUse: string;
  replacement?: string;
}

export interface SelectionInfo {
    selection: vscode.Selection;
    selectedText: string;
}

export interface ArbPathInfo {
    absoluteArbFolderPath: string;
    absoluteArbFilePath: string;
    sourceArbFileName: string;
}
