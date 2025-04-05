import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { ArbContent, GeminiRequest, GeminiResponse } from './types';
import { getLanguageName, detectAndConvertPlaceholders } from './utils';
import { readOrCreateArbFile } from './arb'; // Import from arb module

// --- Translation ---
export async function performTranslations(
  arbFolderPath: string,
  fileNamePattern: string,
  sourceLanguage: string,
  key: string,
  sourceTextWithPlaceholders: string, // Use the arbText for translation
  geminiApiKey: string
) {
  const targetLanguages = await findTargetLanguages(arbFolderPath, fileNamePattern, sourceLanguage);

  if (targetLanguages.length === 0) {
    const newLang = await promptForNewLanguage(arbFolderPath, fileNamePattern, sourceLanguage);
    if (newLang) {
      targetLanguages.push(newLang);
    } else {
      vscode.window.showInformationMessage('No target languages found or added. Skipping translation.');
      return;
    }
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Translating "${key}"...`,
    cancellable: false
  }, async (progress) => {
    const totalSteps = targetLanguages.length;
    let completedSteps = 0;

    const endOfFileMarkerKey = "@_END_OF_FILE"; // Define marker key here as well

    for (const lang of targetLanguages) {
      const increment = (1 / totalSteps) * 100;
      progress.report({ increment, message: `to ${getLanguageName(lang)}` });

      const targetArbFileName = fileNamePattern.replace('{lang}', lang);
      const targetArbFilePath = path.join(arbFolderPath, targetArbFileName);
      let endOfFileMarkerValue: string | undefined; // Variable for marker value in this scope

      try {
        let targetArbContent: ArbContent = await readOrCreateArbFile(targetArbFilePath, targetArbFileName, arbFolderPath) ?? {};

        // --- [Marker Handling START] ---
        // Check for and temporarily remove the end-of-file marker before adding new translation
        if (targetArbContent.hasOwnProperty(endOfFileMarkerKey)) {
          endOfFileMarkerValue = targetArbContent[endOfFileMarkerKey];
          delete targetArbContent[endOfFileMarkerKey];
        }
        // --- [Marker Handling END] ---


        // Perform the translation
        const prompt = `Translate the following ${getLanguageName(sourceLanguage)} text to ${getLanguageName(lang)}. `
          + `Return ONLY the translated string, without any introductory text or markdown formatting like quotes. `
          + `Preserve placeholders like {variableName} exactly as they appear in the input. `
          + `Input: "${sourceTextWithPlaceholders}"`;

        const translation = await translateWithGemini(prompt, geminiApiKey);
        targetArbContent[key] = translation; // Add/overwrite translation

        // Add/update metadata for the translated key
        const { arbPlaceholders } = detectAndConvertPlaceholders(sourceTextWithPlaceholders);
        if (arbPlaceholders.length > 0) {
          targetArbContent[`@${key}`] = {
            "placeholders": arbPlaceholders.reduce((obj, ph) => {
              obj[ph] = { "type": "String" };
              return obj;
            }, {} as Record<string, { type: string }>)
          };
        }

        // --- Writing Logic (with Marker Handling) ---

        // --- [Marker Handling START] ---
        // Add the end-of-file marker back at the very end, if it existed
        if (endOfFileMarkerValue !== undefined) {
          targetArbContent[endOfFileMarkerKey] = endOfFileMarkerValue;
        }
        // --- [Marker Handling END] ---

        // Write the final object to the target ARB file
        await fs.promises.writeFile(targetArbFilePath, JSON.stringify(targetArbContent, null, 2), 'utf8');

      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed translating "${key}" to ${lang}: ${error.message}`);
        // No need to restore marker to in-memory object here on error
      } finally {
        completedSteps++;
        progress.report({ increment: 0, message: `(${completedSteps}/${totalSteps}) ${getLanguageName(lang)} done.` });
      }
    } // end for loop
  }); // end withProgress

  vscode.window.showInformationMessage(`Finished translation attempts for "${key}".`);
}

async function findTargetLanguages(arbFolderPath: string, fileNamePattern: string, sourceLanguage: string): Promise<string[]> {
  const targetLanguages: string[] = [];
  const fileNameRegex = createFileNameRegex(fileNamePattern);
  const genericLangRegex = /[_\-](\w{2,3}(?:[_\-]\w{2,4})?)\.arb$/i; // More generic pattern e.g., en, en_US, zh-Hans

  try {
    const files = await fs.promises.readdir(arbFolderPath);

    for (const file of files) {
      if (!file.endsWith('.arb')) continue;

      // Try specific pattern first
      const specificMatch = fileNameRegex.exec(file);
      if (specificMatch?.groups?.lang && specificMatch.groups.lang !== sourceLanguage) {
        if (!targetLanguages.includes(specificMatch.groups.lang)) {
          targetLanguages.push(specificMatch.groups.lang);
        }
        continue; // Found via specific pattern, move to next file
      }

      // Try generic pattern if specific didn't match or if pattern is simple (e.g., "{lang}.arb")
      const genericMatch = genericLangRegex.exec(file);
      const sourceFileName = fileNamePattern.replace('{lang}', sourceLanguage);
      if (genericMatch && genericMatch[1] && file !== sourceFileName) { // Ensure it's not the source file
        const langCode = genericMatch[1];
        if (langCode !== sourceLanguage && !targetLanguages.includes(langCode)) {
          targetLanguages.push(langCode);
        }
      }
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // Folder doesn't exist, which is fine, we might create it later.
      console.log(`ARB folder not found: ${arbFolderPath}. It might be created.`);
    } else {
      vscode.window.showWarningMessage(`Failed to read ARB folder to detect languages: ${error.message}`);
    }
  }
  return [...new Set(targetLanguages)]; // Deduplicate
}

function createFileNameRegex(pattern: string): RegExp {
  // Escape special regex characters except for the placeholder
  const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Replace {lang} with a named capture group
  // Allow letters, numbers, underscore, hyphen in language code
  const regexString = escapedPattern.replace(/\\\{lang\\\}/g, '(?<lang>[a-zA-Z0-9_\\-]+)');
  return new RegExp(`^${regexString}$`);
}


async function promptForNewLanguage(arbFolderPath: string, fileNamePattern: string, sourceLanguage: string): Promise<string | null> {
  const addLanguage = await vscode.window.showQuickPick(
    ['Yes', 'No'],
    {
      placeHolder: `No target language ARB files found in ${arbFolderPath}. Add one now?`,
      ignoreFocusOut: true,
    }
  );

  if (addLanguage !== 'Yes') {
    return null;
  }

  const newLang = await vscode.window.showInputBox({
    prompt: 'Enter target language code (e.g., es, fr, de, pt-BR)',
    placeHolder: 'es',
    validateInput: (value) => (value?.trim() ? null : 'Language code cannot be empty'),
    ignoreFocusOut: true,
  });

  if (newLang && newLang.trim() && newLang.trim() !== sourceLanguage) {
    const langCode = newLang.trim();
    const newLangFile = path.join(arbFolderPath, fileNamePattern.replace('{lang}', langCode));
    try {
      // Ensure directory exists
      if (!fs.existsSync(arbFolderPath)) {
        await fs.promises.mkdir(arbFolderPath, { recursive: true });
      }
      // Create empty file if it doesn't exist
      if (!fs.existsSync(newLangFile)) {
        await fs.promises.writeFile(newLangFile, '{}', 'utf8');
        vscode.window.showInformationMessage(`Created new ARB file for language: ${langCode}`);
      } else {
        vscode.window.showInformationMessage(`ARB file for ${langCode} already exists.`);
      }
      return langCode;
    } catch (error: any) {
      vscode.window.showErrorMessage(`Failed to create ARB file for ${langCode}: ${error.message}`);
      return null;
    }
  } else if (newLang?.trim() === sourceLanguage) {
    vscode.window.showWarningMessage('Target language cannot be the same as the source language.');
    return null;
  }

  return null; // User cancelled input or entered invalid code
}


function translateWithGemini(prompt: string, apiKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use v1beta models endpoint, adjust model name as needed (e.g., gemini-1.5-flash-latest)
    const model = 'gemini-2.0-flash'; // Or 'gemini-pro' etc.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const requestBody: GeminiRequest = {
      // Gemini wants an array of contents, typically just one for single-turn
      contents: [{ parts: [{ text: prompt }] }],
      // Keep generation config simple for translation
      generationConfig: {
        temperature: 0.2, // Lower temp for more predictable translation
        topP: 0.8,
        topK: 40,
        maxOutputTokens: 1024, // Usually enough for single string translation
      },
    };

    const reqOptions: https.RequestOptions = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };

    const req = https.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            // Try parsing error message from response
            let errorMsg = `Gemini API Error: ${res.statusCode}`;
            try {
              const errorResponse = JSON.parse(data);
              if (errorResponse.error?.message) {
                errorMsg += ` - ${errorResponse.error.message}`;
              } else {
                errorMsg += ` ${data}`; // Fallback to raw data
              }
            } catch {
              errorMsg += ` ${data}`; // Fallback if data is not JSON
            }
            reject(new Error(errorMsg));
            return;
          }

          const response = JSON.parse(data) as GeminiResponse;
          const candidate = response?.candidates?.[0];
          const translatedText = candidate?.content?.parts?.[0]?.text;

          if (translatedText) {
            // Clean potential markdown quotes if Gemini insists on adding them
            let cleanedText = translatedText.trim();
            if (cleanedText.startsWith('"') && cleanedText.endsWith('"') && cleanedText.length > 1) {
              cleanedText = cleanedText.substring(1, cleanedText.length - 1);
            }
            resolve(cleanedText);
          } else {
            // Handle cases where the API returned 200 OK but no valid candidate/text
            // This could be due to safety filters (though we removed the specific check),
            // empty generation, or unexpected response structure.
            let reason = "No valid translation text found in the API response.";
            // Optionally log the full response for debugging if needed
            // console.error("Gemini Translation Failed - Details:", JSON.stringify(response));
            reject(new Error(`Gemini Translation Failed: ${reason}`));
          }
        } catch (parseError: any) {
          reject(new Error(`Failed to parse Gemini response: ${parseError.message}. Raw data: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Gemini request failed: ${error.message}`));
    });

    req.write(JSON.stringify(requestBody));
    req.end();
  });
}
