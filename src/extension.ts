import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// Interface for Gemini API request
interface GeminiRequest {
  contents: {
    parts: {
      text: string;
    }[];
  };
  generationConfig: {
    temperature: number;
    topP: number;
    topK: number;
    maxOutputTokens: number;
  };
}

// Interface for Gemini API response
interface GeminiResponse {
  candidates: {
    content: {
      parts: {
        text: string;
      }[];
    };
  }[];
}

// Interface for ARB file content
interface ArbContent {
  [key: string]: string | any;
}

export function activate(context: vscode.ExtensionContext) {
  console.log('String to ARB Extractor is now active!');

  // Register the command for extracting strings
  let disposable = vscode.commands.registerCommand('string-to-arb-extractor.extractString', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active editor found.');
      return;
    }

    const selection = editor.selection;
    let selectedText = editor.document.getText(selection).trim();
    if (!selectedText) {
      vscode.window.showErrorMessage('Please select a string to extract.');
      return;
    }

    // Strip outer single or double quotes, preserving inner content
    const quoteRegex = /^['"](.*)['"]$/;
    if (quoteRegex.test(selectedText)) {
      selectedText = selectedText.replace(quoteRegex, '$1');
    }

    // Detect Dart-style (${...} or $variable) and ARB-style ({variable}) placeholders
    const dartPlaceholderRegex = /\${([^}]+)}|\$(\w+)/g;
    const arbPlaceholderRegex = /\{([^}]+)\}/g;
    const placeholders: string[] = []; // Full original placeholders for replacement
    const arbPlaceholders: string[] = []; // Simplified names for ARB
    let arbText = selectedText; // The text to store in ARB, after conversion

    // Convert Dart-style placeholders to ARB-style
    let dartMatch;
    while ((dartMatch = dartPlaceholderRegex.exec(selectedText)) !== null) {
      const fullPlaceholder = dartMatch[1] || dartMatch[2]; // e.g., "data.data.order.code" or "code"
      
      // Extract variable name without any trailing operators or modifiers
      let cleanedPlaceholder = fullPlaceholder;
      
      // Remove mathematical operations (like + 1, - 2, etc.)
      cleanedPlaceholder = cleanedPlaceholder.replace(/\s*[\+\-\*\/]\s*.+$/, '');
      
      // Remove trailing ! (null assertion operator)
      cleanedPlaceholder = cleanedPlaceholder.replace(/!$/, '');
      
      // Get the final variable name
      const parts = cleanedPlaceholder.split('.');
      const simpleName = parts[parts.length - 1]; 
      
      placeholders.push(fullPlaceholder); // Keep full expression for replacement
      arbPlaceholders.push(simpleName); // Simplified for ARB
      arbText = arbText.replace(dartMatch[0], `{${simpleName}}`); // Convert to {code} in ARB
    }

    // Add any existing ARB-style placeholders that weren't converted
    let arbMatch;
    while ((arbMatch = arbPlaceholderRegex.exec(arbText)) !== null) {
      if (!arbPlaceholders.includes(arbMatch[1])) {
        placeholders.push(arbMatch[1]); // Add to replacement
        arbPlaceholders.push(arbMatch[1]); // Add to ARB tracking
      }
    }

    // Get configuration
    const config = vscode.workspace.getConfiguration('stringToArbExtractor');
    const arbFolderPath = config.get<string>('arbFolderPath', './lib/l10n');
    const sourceLanguage = config.get<string>('sourceLanguage', 'en');
    const fileNamePattern = config.get<string>('fileNamePattern', 'intl_{lang}.arb');
    const prefix = config.get<string>('prefix', 'S.current');

    // Generate source ARB file path
    const sourceArbFileName = fileNamePattern.replace('{lang}', sourceLanguage);
    
    // Prompt for the key
    let key = await vscode.window.showInputBox({
      prompt: 'Enter a key for the extracted string',
      placeHolder: 'e.g., orderNotFound',
      validateInput: (value) => (value.trim() ? null : 'Key cannot be empty'),
    });
    if (!key) {
      return; // User canceled
    }

    // Resolve absolute path to ARB folder
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found.');
      return;
    }
    const absoluteArbFolderPath = path.resolve(workspaceFolder.uri.fsPath, arbFolderPath);
    const absoluteArbFilePath = path.join(absoluteArbFolderPath, sourceArbFileName);

    // Ensure the directory exists
    if (!fs.existsSync(absoluteArbFolderPath)) {
      fs.mkdirSync(absoluteArbFolderPath, { recursive: true });
    }

    // Read or initialize ARB file
    let arbContent: ArbContent = {};
    if (fs.existsSync(absoluteArbFilePath)) {
      const fileContent = fs.readFileSync(absoluteArbFilePath, 'utf8');
      try {
        arbContent = JSON.parse(fileContent);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to parse ${sourceArbFileName}: Invalid JSON. ${error.message}. Resetting to empty content.`
        );
        arbContent = {};
      }
    }

    // Check if the key already exists and show its current value
    if (arbContent[key]) {
      const existingValue = arbContent[key];
      const choice = await vscode.window.showQuickPick(
        ['Use existing key (' + key + ')', 'Add as new key with suffix (e.g., ' + key + '_1)'],
        {
          placeHolder: `Key "${key}" already exists with value "${existingValue}". What would you like to do?`,
        }
      );
      if (!choice) {return;} // User canceled
      if (choice === 'Use existing key (' + key + ')') {
        const replacement = placeholders.length
          ? `${prefix}.${key}(${placeholders.join(', ')})`
          : `${prefix}.${key}`;
        await editor.edit((editBuilder) => {
          editBuilder.replace(selection, replacement);
        });
        vscode.window.showInformationMessage(`Reused existing key "${key}" from ${sourceArbFileName}.`);
        return;
      } else if (choice === 'Add as new key with suffix (e.g., ' + key + '_1)') {
        let newKey = `${key}_1`;
        let counter = 1;
        while (arbContent[newKey]) {
          counter++;
          newKey = `${key}_${counter}`;
        }
        key = newKey; // Update to the unique key
      }
    }

    // Check if the value (converted ARB text) already exists under a different key
    const existingKey = Object.keys(arbContent).find(
      (k) => arbContent[k] === arbText
    );
    if (existingKey) {
      const choice = await vscode.window.showQuickPick(
        ['Use existing key (' + existingKey + ')', 'Add as new key anyway'],
        {
          placeHolder: `The string "${arbText}" already exists as "${existingKey}". What would you like to do?`,
        }
      );
      if (!choice) {return;} // User canceled
      if (choice === 'Use existing key (' + existingKey + ')') {
        const replacement = placeholders.length
          ? `${prefix}.${existingKey}(${placeholders.join(', ')})`
          : `${prefix}.${existingKey}`;
        await editor.edit((editBuilder) => {
          editBuilder.replace(selection, replacement);
        });
        vscode.window.showInformationMessage(`Reused existing key "${existingKey}" from ${sourceArbFileName}.`);
        return;
      }
      // If 'Add as new key anyway' is selected, proceed
    }

    // Add the new key-value pair (use converted ARB text)
    arbContent[key] = arbText;
    
    // Write back to ARB file
    try {
      fs.writeFileSync(absoluteArbFilePath, JSON.stringify(arbContent, null, 2), 'utf8');
      vscode.window.showInformationMessage(`String extracted to ${sourceArbFileName} as "${key}"`);

      // Check if auto-translation is enabled
      const autoTranslate = config.get<boolean>('autoTranslate', true);
      
      // Only proceed with translation if autoTranslate is enabled
      if (autoTranslate) {
        // Check if we have an API key for translation
        const geminiApiKey = config.get<string>('geminiApiKey', '');
        if (geminiApiKey) {
          // Detect target languages by scanning the folder for ARB files matching the pattern
          const targetLanguages: string[] = [];
          const fileNameRegex = createFileNameRegex(fileNamePattern);
          
          try {
            const files = fs.readdirSync(absoluteArbFolderPath);
            
            // First try with exact pattern matching
            for (const file of files) {
              if (file.endsWith('.arb')) {
                const match = fileNameRegex.exec(file);
                if (match && match.groups?.lang && match.groups.lang !== sourceLanguage) {
                  targetLanguages.push(match.groups.lang);
                }
              }
            }
            
            // If no languages found with exact pattern, try a more flexible approach
            if (targetLanguages.length === 0) {
              // Try to extract language code from any ARB file that's not the source language file
              for (const file of files) {
                if (file.endsWith('.arb') && file !== sourceArbFileName) {
                  // Try to extract language from filename by looking for language codes
                  // Common formats: app_es.arb, intl_es.arb, es.arb, app-es.arb
                  const langMatch = file.match(/[_\-.]([a-z]{2}(?:[-_][A-Z]{2})?)\.arb$/i);
                  if (langMatch && langMatch[1] && langMatch[1] !== sourceLanguage) {
                    targetLanguages.push(langMatch[1]);
                  }
                }
              }
            }
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to read ARB folder: ${error.message}`);
            return;
          }

          // If no target languages found, ask user to add one
          if (targetLanguages.length === 0) {
            const addLanguage = await vscode.window.showErrorMessage(
              `No target language files found in ${absoluteArbFolderPath} matching pattern ${fileNamePattern}. Would you like to add one?`,
              'Yes', 'No'
            );
            
            if (addLanguage === 'Yes') {
              const newLang = await vscode.window.showInputBox({
                prompt: 'Enter a target language code (e.g., es, fr, de)',
                placeHolder: 'es',
                validateInput: (value) => (value.trim() ? null : 'Language code cannot be empty'),
              });
              
              if (newLang && newLang !== sourceLanguage) {
                targetLanguages.push(newLang);
                // Create empty file for this language
                const newLangFile = path.join(absoluteArbFolderPath, fileNamePattern.replace('{lang}', newLang));
                try {
                  fs.writeFileSync(newLangFile, '{}', 'utf8');
                  vscode.window.showInformationMessage(`Created new ARB file for language: ${newLang}`);
                } catch (error) {
                  vscode.window.showErrorMessage(`Failed to create new ARB file: ${error.message}`);
                  return;
                }
              } else {
                vscode.window.showInformationMessage('Translation cancelled.');
                return;
              }
            } else {
              vscode.window.showInformationMessage('Translation cancelled.');
              return;
            }
          }

          // Translate the string for each target language
          for (const lang of targetLanguages) {
            const targetArbFileName = fileNamePattern.replace('{lang}', lang);
            const targetArbFile = path.join(absoluteArbFolderPath, targetArbFileName);
            
            // Read target ARB file
            let targetArbContent: ArbContent = {};
            if (fs.existsSync(targetArbFile)) {
              try {
                const fileContent = fs.readFileSync(targetArbFile, 'utf8');
                targetArbContent = JSON.parse(fileContent);
              } catch (error) {
                vscode.window.showWarningMessage(`Failed to parse target ARB file for ${lang}: ${error.message}`);
                continue;
              }
            }

            try {
              // Create a prompt for Gemini to translate the string
              const prompt = `Translate the following string from ${getLanguageName(sourceLanguage)} to ${getLanguageName(lang)}. 
Return only the translation.
Preserve all placeholders like {variable} exactly as they appear.
Input string: "${arbText}"`;
              
              const translation = await translateWithGemini(prompt, geminiApiKey);
              
              // Update the target ARB file
              targetArbContent[key] = translation;

              // Write back to target ARB file
              fs.writeFileSync(targetArbFile, JSON.stringify(targetArbContent, null, 2), 'utf8');
              vscode.window.showInformationMessage(`Translated to ${lang}`);
            } catch (error) {
              vscode.window.showErrorMessage(`Translation failed for ${lang}: ${error.message}`);
            }
          }
        } else {
          vscode.window.showInformationMessage('Auto-translation is enabled but no Gemini API key is set. Translation skipped.');
        }
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to write to ${sourceArbFileName}: ${error.message}`);
      return;
    }

    // Replace the selected text with prefix.key, using full placeholders
    const replacement = placeholders.length
      ? `${prefix}.${key}(${placeholders.join(', ')})`
      : `${prefix}.${key}`;
    await editor.edit((editBuilder) => {
      editBuilder.replace(selection, replacement);
    });
  });

  // Register the command in the editor context menu
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand('string-to-arb-extractor.extractStringFromContext', async (editor) => {
      // Just call the main command
      vscode.commands.executeCommand('string-to-arb-extractor.extractString');
    })
  );

  // Register the code action provider (as a refactoring action instead of quickfix)
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      ['plaintext', 'javascript', 'typescript', 'dart'],
      new ExtractStringRefactoringProvider(),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.Refactor],
      }
    )
  );

  context.subscriptions.push(disposable);
}

// Helper function to create a regex for extracting language code from filename
function createFileNameRegex(pattern: string): RegExp {
  // Escape special regex characters except for the placeholder
  const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  
  // Replace {lang} with a named capture group for language code
  const regex = escapedPattern.replace('{lang}', '(?<lang>[a-zA-Z0-9_\\-]+)');
  
  return new RegExp(`^${regex}$`);
}

// Helper function to translate with Gemini API
function translateWithGemini(text: string, apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    
    const request: GeminiRequest = {
      contents: {
        parts: [{ text }]
      },
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 8192
      }
    };
    
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      },
      (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`API error: ${res.statusCode} ${data}`));
            return;
          }
          
          try {
            const response = JSON.parse(data) as GeminiResponse;
            if (response.candidates && response.candidates.length > 0 && 
                response.candidates[0].content && response.candidates[0].content.parts.length > 0) {
              resolve(response.candidates[0].content.parts[0].text.trim());
            } else {
              reject(new Error('No translation result in response'));
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      }
    );
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(JSON.stringify(request));
    req.end();
  });
}

// Helper function to get the full language name from a language code
function getLanguageName(code: string): string {
  const languageMap: { [code: string]: string } = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'zh': 'Chinese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'vi': 'Vietnamese',
    'id': 'Indonesian',
    'tr': 'Turkish',
    'th': 'Thai'
    // Add more as needed
  };
  
  return languageMap[code] || code;
}

// Code Action Provider for Refactoring
class ExtractStringRefactoringProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection
  ): vscode.CodeAction[] | undefined {
    const selectedText = document.getText(range).trim();
    if (!selectedText) {
      return;
    }

    // Create a refactoring action instead of a quick fix
    const action = new vscode.CodeAction('Extract String to ARB', vscode.CodeActionKind.Refactor);
    action.command = {
      command: 'string-to-arb-extractor.extractString',
      title: 'Extract String to ARB',
    };
    return [action];
  }
}

export function deactivate() {}