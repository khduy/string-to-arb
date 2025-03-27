import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { exec } from 'child_process';

// --- Interfaces ---
interface GeminiRequest {
  contents: { parts: { text: string }[] }[]; // Updated to match API spec (array of contents)
  generationConfig: {
    temperature: number;
    topP: number;
    topK: number;
    maxOutputTokens: number;
  };
}

interface GeminiResponse {
  candidates: {
    content: {
      parts: { text: string }[];
    };
  }[];
  // Optional: Include error field if API returns structured errors
  // error?: { code: number; message: string; status: string; };
}

interface ArbContent {
  [key: string]: string | any; // Allow for metadata like @key
}

interface ExtensionConfig {
  arbFolderPath: string;
  sourceLanguage: string;
  fileNamePattern: string;
  prefix: string;
  autoTranslate: boolean;
  geminiApiKey?: string;
  importStatement?: string;
  postExtractionCommand?: string;
}

interface PlaceholderInfo {
  originalPlaceholders: string[]; // Full Dart expressions: "data.code!"
  arbPlaceholders: string[];     // Simplified for ARB: "code"
  arbText: string;               // Text with ARB placeholders: "Order {code}"
}

const EXTENSION_ID = 'string-to-arb-extractor'; // Replace if your extension ID is different
const CONFIG_SECTION = 'stringToArbExtractor';

// --- Activation ---
export function activate(context: vscode.ExtensionContext) {
  console.log('String to ARB Extractor is now active!');

  // --- Command Registration ---
  const extractCommand = vscode.commands.registerCommand(`${EXTENSION_ID}.extractString`, runExtraction);
  const contextMenuCommand = vscode.commands.registerTextEditorCommand(`${EXTENSION_ID}.extractStringFromContext`, runExtraction); // Keep using runExtraction
  const openSettingsCommand = vscode.commands.registerCommand(`${EXTENSION_ID}.openSettings`, () => {
    vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`); // Use dynamic ID
  });

  // --- Code Action Provider ---
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    ['dart'], // Target Dart files
    new ExtractStringRefactoringProvider(),
    { providedCodeActionKinds: [vscode.CodeActionKind.Refactor] }
  );

  context.subscriptions.push(
    extractCommand,
    contextMenuCommand,
    openSettingsCommand,
    codeActionProvider
  );
}

export function deactivate() { }

// --- Main Extraction Logic ---
async function runExtraction() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor found.');
    return;
  }

  const selectionInfo = getSelectionAndText(editor);
  if (!selectionInfo) return; // Error message shown in helper

  const placeholderInfo = detectAndConvertPlaceholders(selectionInfo.selectedText);
  const config = getConfiguration();

  // --- Key Input ---
  const suggestedKey = generateSuggestedKey(placeholderInfo.arbText);
  let userKey = await promptForKey(suggestedKey);
  if (!userKey) return; // User cancelled

  // --- File Paths ---
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found.');
    return;
  }
  const { absoluteArbFolderPath, absoluteArbFilePath, sourceArbFileName } = resolveArbPaths(config, workspaceFolder);

  // --- Read/Prepare ARB Content ---
  let arbContent: ArbContent | null = await readOrCreateArbFile(absoluteArbFilePath, sourceArbFileName, absoluteArbFolderPath);
  if (arbContent === null) return; // Error handled in helper

  // --- Handle Conflicts ---
  const conflictResult = await handleConflicts(userKey, placeholderInfo.arbText, arbContent, config.prefix);
  if (conflictResult.shouldReturn) {
    if (conflictResult.replacement) {
      await replaceTextInEditor(editor, selectionInfo.selection, conflictResult.replacement);
      await ensureImport(editor, config.importStatement); // Try adding import if reusing key
      vscode.window.showInformationMessage(`Reused existing key "${conflictResult.keyUsed}" from ${sourceArbFileName}.`);
    }
    return; // Either returned because user cancelled or reused existing key
  }
  userKey = conflictResult.keyToUse; // Update key if suffix was added

  // --- Update Source ARB ---
  const updateSuccess = await updateSourceArb(absoluteArbFilePath, sourceArbFileName, arbContent, userKey, placeholderInfo.arbText);
  if (!updateSuccess) return;

  // --- Replace Text in Editor ---
  const replacement = placeholderInfo.originalPlaceholders.length
    ? `${config.prefix}.${userKey}(${placeholderInfo.originalPlaceholders.join(', ')})`
    : `${config.prefix}.${userKey}`;
  await replaceTextInEditor(editor, selectionInfo.selection, replacement);

  // --- Add Import if configured ---
  await ensureImport(editor, config.importStatement);

  // --- Auto-Translation ---
  if (config.autoTranslate) {
    if (config.geminiApiKey) {
      await performTranslations(
        absoluteArbFolderPath,
        config.fileNamePattern,
        config.sourceLanguage,
        userKey,
        placeholderInfo.arbText,
        config.geminiApiKey
      );
    } else {
      vscode.window.showInformationMessage('Auto-translation enabled but Gemini API Key not configured. Translation skipped.');
    }
  }

  // --- Run Post-Extraction Command
  if (config.postExtractionCommand) {
    try {
      // Use the workspaceFolder obtained earlier
      await runPostExtractionCommand(config.postExtractionCommand, workspaceFolder.uri.fsPath);
    } catch (error: any) {
      // Show error, but the main extraction was successful
      vscode.window.showErrorMessage(`Post-extraction command failed: ${error.message}`);
      // Optional: Add a button to the error message to view output/logs
    }
  }
}

// --- Helper Functions ---
function getConfiguration(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    arbFolderPath: config.get<string>('arbFolderPath', './lib/l10n'),
    sourceLanguage: config.get<string>('sourceLanguage', 'en'),
    fileNamePattern: config.get<string>('fileNamePattern', 'intl_{lang}.arb'),
    prefix: config.get<string>('prefix', 'S.current'),
    autoTranslate: config.get<boolean>('autoTranslate', true),
    geminiApiKey: config.get<string>('geminiApiKey') || undefined,
    importStatement: config.get<string>('importStatement') || undefined,
    postExtractionCommand: config.get<string>('postExtractionCommand') || undefined,
  };
}


function getSelectionAndText(editor: vscode.TextEditor): { selection: vscode.Selection; selectedText: string } | null {
  const selection = editor.selection;
  let selectedText = editor.document.getText(selection).trim();

  if (!selectedText) {
    vscode.window.showErrorMessage('No text selected.');
    return null;
  }

  // Strip outer quotes more carefully
  if ((selectedText.startsWith("'") && selectedText.endsWith("'")) || (selectedText.startsWith('"') && selectedText.endsWith('"'))) {
    selectedText = selectedText.substring(1, selectedText.length - 1);
    // Basic handling for escaped quotes of the *same type* within the string - This might need refinement for complex cases
    // E.g. "He said \"Hello\"" -> He said \"Hello\" (needs unescaping)
    // For simplicity, we currently don't unescape, assuming users select the inner logical content.
  }
  // Handle raw strings r'...' or r"..."
  else if ((selectedText.startsWith("r'") && selectedText.endsWith("'")) || (selectedText.startsWith('r"') && selectedText.endsWith('"'))) {
    selectedText = selectedText.substring(2, selectedText.length - 1);
  }

  return { selection, selectedText };
}


function detectAndConvertPlaceholders(text: string): PlaceholderInfo {
  const dartPlaceholderRegex = /\${([^}]+)}|\$(\w+)/g;
  const arbPlaceholderRegex = /\{([^}]+)\}/g;
  const originalPlaceholders: string[] = [];
  const arbPlaceholders: string[] = [];
  let arbText = text;

  // Convert Dart-style placeholders
  let dartMatch;
  while ((dartMatch = dartPlaceholderRegex.exec(text)) !== null) {
    const fullPlaceholder = dartMatch[1] ?? dartMatch[2]; // Use nullish coalescing
    if (!fullPlaceholder) continue;

    // Attempt to clean the placeholder name
    let cleanedPlaceholder = fullPlaceholder
      .replace(/\s*[\+\-\*\/]\s*.+$/, '') // Remove trailing math ops
      .replace(/!$/, '') // Remove trailing null assertion
      .trim();

    const parts = cleanedPlaceholder.split('.');
    const simpleName = parts[parts.length - 1] || 'variable'; // Extract last part or use fallback

    // Avoid duplicates from multiple detections of the same source placeholder
    if (!originalPlaceholders.includes(fullPlaceholder)) {
      originalPlaceholders.push(fullPlaceholder);
      arbPlaceholders.push(simpleName);
    }

    // Replace *only the first occurrence* in arbText in this iteration to handle repeated placeholders
    const regexForReplacement = new RegExp(dartMatch[0].replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), ''); // Escape regex chars
    if (!arbText.includes(`{${simpleName}}`)) { // Avoid replacing if already converted (e.g. identical $var and ${var})
      arbText = arbText.replace(regexForReplacement, `{${simpleName}}`);
    }
  }

  // Add any existing ARB-style placeholders that weren't converted (idempotency)
  let arbMatch;
  while ((arbMatch = arbPlaceholderRegex.exec(arbText)) !== null) {
    const placeholderName = arbMatch[1];
    if (!arbPlaceholders.includes(placeholderName)) {
      // If an {arbStyle} exists but wasn't from a $dartStyle, assume it's meant to be there.
      // We need to ensure it's accounted for in the replacement arguments.
      originalPlaceholders.push(placeholderName); // Use the name directly as the 'original' argument
      arbPlaceholders.push(placeholderName);
    }
  }

  return { originalPlaceholders, arbPlaceholders, arbText };
}


function generateSuggestedKey(text: string): string {
  // Remove placeholders for suggestion clarity
  const cleanText = text.replace(/\{[^}]+\}/g, '');
  // Basic camelCase conversion
  let key = cleanText
    .replace(/[^a-zA-Z0-9\s]/g, '') // Keep only letters, numbers, spaces
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean) // Remove empty strings resulting from multiple spaces
    .map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

  // Limit length and provide fallback
  key = key.substring(0, 40);
  return key || 'myString';
}


async function promptForKey(suggestedKey: string): Promise<string | undefined> {
  return await vscode.window.showInputBox({
    prompt: 'Enter a key for the extracted string',
    placeHolder: `e.g., ${suggestedKey}`,
    value: suggestedKey, // Pre-fill
    validateInput: (value) => (value?.trim() ? null : 'Key cannot be empty'),
    ignoreFocusOut: true, // Keep open if focus lost
  });
}


function resolveArbPaths(config: ExtensionConfig, workspaceFolder: vscode.WorkspaceFolder) {
  const sourceArbFileName = config.fileNamePattern.replace('{lang}', config.sourceLanguage);
  const absoluteArbFolderPath = path.resolve(workspaceFolder.uri.fsPath, config.arbFolderPath);
  const absoluteArbFilePath = path.join(absoluteArbFolderPath, sourceArbFileName);
  return { absoluteArbFolderPath, absoluteArbFilePath, sourceArbFileName };
}


async function readOrCreateArbFile(filePath: string, fileName: string, folderPath: string): Promise<ArbContent | null> {
  try {
    if (fs.existsSync(filePath)) {
      const fileContent = await fs.promises.readFile(filePath, 'utf8');
      try {
        return JSON.parse(fileContent);
      } catch (error: any) {
        const resetChoice = await vscode.window.showErrorMessage(
          `Failed to parse ${fileName}: Invalid JSON. ${error.message}.`,
          'Reset File to {}', 'Cancel'
        );
        if (resetChoice === 'Reset File to {}') {
          await fs.promises.writeFile(filePath, '{}', 'utf8');
          return {};
        }
        return null; // User cancelled
      }
    } else {
      // Ensure directory exists before creating the file
      if (!fs.existsSync(folderPath)) {
        await fs.promises.mkdir(folderPath, { recursive: true });
      }
      await fs.promises.writeFile(filePath, '{}', 'utf8'); // Create empty file
      return {};
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(`Error accessing ARB file ${fileName}: ${error.message}`);
    return null;
  }
}


async function handleConflicts(
  userKey: string,
  arbText: string,
  arbContent: ArbContent,
  prefix: string
): Promise<{ shouldReturn: boolean; keyUsed?: string; keyToUse: string; replacement?: string }> {
  let keyToUse = userKey;
  let replacement: string | undefined = undefined;

  // 1. Check if KEY exists
  if (arbContent[userKey]) {
    const existingValue = arbContent[userKey];
    const choice = await vscode.window.showQuickPick(
      [
        `Use existing key ("${userKey}")`, // Simpler option text
        `Create new key (e.g., "${userKey}_1")`
      ],
      {
        placeHolder: `Key "${userKey}" already exists with value: "${existingValue}". What to do?`,
        ignoreFocusOut: true,
      }
    );

    if (!choice) return { shouldReturn: true, keyToUse }; // Cancelled
    if (choice.startsWith('Use existing key')) {
      // Need to know placeholders for replacement *before* returning
      const { originalPlaceholders } = detectAndConvertPlaceholders(vscode.window.activeTextEditor?.document.getText(vscode.window.activeTextEditor.selection) || ''); // Re-detect for accuracy
      replacement = originalPlaceholders.length
        ? `${prefix}.${userKey}(${originalPlaceholders.join(', ')})`
        : `${prefix}.${userKey}`;
      return { shouldReturn: true, keyUsed: userKey, keyToUse, replacement };
    }
    // Else: Generate new key with suffix
    let counter = 1;
    let newKey = `${userKey}_${counter}`;
    while (arbContent[newKey]) {
      counter++;
      newKey = `${userKey}_${counter}`;
    }
    keyToUse = newKey;
    vscode.window.showInformationMessage(`Using new key: "${keyToUse}"`);
  }

  // 2. Check if VALUE exists (only if we are *not* reusing an existing key from step 1)
  const existingKeyForValue = Object.keys(arbContent).find(
    (k) => typeof arbContent[k] === 'string' && arbContent[k] === arbText // Check type
  );

  if (existingKeyForValue && keyToUse !== existingKeyForValue) { // Ensure we didn't just create this key with a suffix
    const choice = await vscode.window.showQuickPick(
      [
        `Use existing key ("${existingKeyForValue}")`,
        `Add as new key ("${keyToUse}") anyway`
      ],
      {
        placeHolder: `String "${arbText}" already exists as key "${existingKeyForValue}". What to do?`,
        ignoreFocusOut: true,
      }
    );

    if (!choice) return { shouldReturn: true, keyToUse }; // Cancelled
    if (choice.startsWith('Use existing key')) {
      const { originalPlaceholders } = detectAndConvertPlaceholders(vscode.window.activeTextEditor?.document.getText(vscode.window.activeTextEditor.selection) || ''); // Re-detect
      replacement = originalPlaceholders.length
        ? `${prefix}.${existingKeyForValue}(${originalPlaceholders.join(', ')})`
        : `${prefix}.${existingKeyForValue}`;
      return { shouldReturn: true, keyUsed: existingKeyForValue, keyToUse, replacement };
    }
    // Else: Proceed to add with keyToUse (which might have suffix)
  }

  return { shouldReturn: false, keyToUse }; // Proceed to add the entry
}


async function updateSourceArb(filePath: string, fileName: string, arbContent: ArbContent, key: string, value: string): Promise<boolean> {
  const endOfFileMarkerKey = "@_END_OF_FILE"; // The key to keep at the end
  let endOfFileMarkerValue: string | undefined;

  // --- [Marker Handling START] ---
  // Check for and temporarily remove the end-of-file marker before processing
  if (arbContent.hasOwnProperty(endOfFileMarkerKey)) {
    endOfFileMarkerValue = arbContent[endOfFileMarkerKey];
    delete arbContent[endOfFileMarkerKey]; // Remove it now
  }
  // --- [Marker Handling END] ---

  // Add the new key and value
  arbContent[key] = value;

  // Add metadata for placeholders if any exist
  const { arbPlaceholders } = detectAndConvertPlaceholders(value);
  if (arbPlaceholders.length > 0) {
    arbContent[`@${key}`] = {
      "placeholders": arbPlaceholders.reduce((obj, ph) => {
        obj[ph] = { "type": "String" };
        return obj;
      }, {} as Record<string, { type: string }>)
    };
  }

  try {
    // --- [Marker Handling START] ---
    // Add the end-of-file marker back at the very end, if it existed
    // Do this *before* stringifying the potentially unsorted object
    if (endOfFileMarkerValue !== undefined) {
      arbContent[endOfFileMarkerKey] = endOfFileMarkerValue;
    }
    // --- [Marker Handling END] ---

    // Write the final object (order determined by JS engine + marker logic)
    const contentString = JSON.stringify(arbContent, null, 2); // Use the modified arbContent directly
    await fs.promises.writeFile(filePath, contentString, 'utf8');
    vscode.window.showInformationMessage(`String added to ${fileName} as "${key}"`);
    return true;
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to write to ${fileName}: ${error.message}`);
    // --- [Marker Handling START] ---
    // Optional: Restore marker to in-memory object on error if needed.
    // Important: If we added the marker back before stringify, we might need to remove it again
    // if the write fails and we didn't intend for it to be there in memory for retry.
    // However, since failure usually means exiting, this might be okay.
    // For simplicity, let's assume the state after failure doesn't need complex restoration here.
    // --- [Marker Handling END] ---
    return false;
  }
}


async function replaceTextInEditor(editor: vscode.TextEditor, selection: vscode.Selection, replacement: string) {
  try {
    await editor.edit((editBuilder) => {
      editBuilder.replace(selection, replacement);
    });
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to replace text in editor: ${error.message}`);
  }
}

async function ensureImport(editor: vscode.TextEditor, importStatement: string | undefined) {
  if (!importStatement || !importStatement.trim()) {
    return; // No import statement configured
  }

  const document = editor.document;
  const text = document.getText();
  const importStatementTrimmed = importStatement.trim();

  // Basic check if import already exists (ignoring minor whitespace variations)
  const importRegex = new RegExp(`^\\s*import\\s+['"]${importStatementTrimmed.replace(/^import\s+['"]/, '').replace(/['"];?\s*$/, '')}['"];?\\s*$`, 'm');

  if (importRegex.test(text)) {
    // console.log('Import already exists:', importStatementTrimmed);
    return; // Already imported
  }

  try {
    // Find the last import statement or the start of the file
    const lines = text.split('\n');
    let lastImportLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('import ')) {
        lastImportLineIndex = i;
      } else if (lines[i].trim().startsWith('library ') || lines[i].trim().startsWith('part of ')) {
        // Stop searching after library/part directives
        break;
      } else if (lastImportLineIndex !== -1 && lines[i].trim() !== '') {
        // Found the first non-import, non-empty line after imports
        break;
      }
    }

    const insertPosition = new vscode.Position(lastImportLineIndex + 1, 0);
    const edit = new vscode.WorkspaceEdit();
    const importLine = importStatementTrimmed + (importStatementTrimmed.endsWith(';') ? '' : ';') + '\n'; // Ensure semicolon and newline
    edit.insert(document.uri, insertPosition, importLine);

    await vscode.workspace.applyEdit(edit);
    // vscode.window.showInformationMessage('Added required import.'); // Optional feedback
    console.log('Attempted to add import:', importStatementTrimmed);

  } catch (error: any) {
    vscode.window.showWarningMessage(`Could not automatically add import "${importStatementTrimmed}": ${error.message}`);
  }
}

async function runPostExtractionCommand(command: string, workspaceFolderPath: string): Promise<void> {
  return vscode.window.withProgress({
    location: vscode.ProgressLocation.Window, // Use status bar (less intrusive)
    title: `Running: ${command}`,
    cancellable: false // Keep it simple, not cancellable for now
  }, () => {
    return new Promise<void>((resolve, reject) => {
      console.log(`Running command in ${workspaceFolderPath}: ${command}`);

      exec(command, { cwd: workspaceFolderPath }, (error, stdout, stderr) => {
        if (stdout) {
          console.log(`Command stdout:\n${stdout}`);
          // Optional: Output stdout to an OutputChannel for better visibility
        }
        if (stderr) {
          console.error(`Command stderr:\n${stderr}`);
          // Optional: Output stderr to an OutputChannel
        }

        if (error) {
          console.error(`Command execution error: ${error.message}`);
          // Include stderr in the rejection reason for better diagnostics
          reject(new Error(`Command "${command}" failed: ${error.message}. Stderr: ${stderr || 'N/A'}`));
        } else {
          console.log(`Command "${command}" executed successfully.`);
          // Optional: Briefly show success in status bar
          vscode.window.setStatusBarMessage(`Command executed: ${command}`, 4000);
          resolve();
        }
      });
    });
  });
}


// --- Translation ---
async function performTranslations(
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


function getLanguageName(code: string): string {
  // Simple map, consider using Intl.DisplayNames if running in a Node env that supports it well
  const languageMap: { [code: string]: string } = {
    'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German',
    'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian', 'zh': 'Chinese',
    'ja': 'Japanese', 'ko': 'Korean', 'ar': 'Arabic', 'hi': 'Hindi',
    'vi': 'Vietnamese', 'id': 'Indonesian', 'tr': 'Turkish', 'th': 'Thai',
    // Add more common codes
    'nl': 'Dutch', 'sv': 'Swedish', 'pl': 'Polish', 'da': 'Danish',
    'fi': 'Finnish', 'no': 'Norwegian', 'cs': 'Czech', 'el': 'Greek',
    'hu': 'Hungarian', 'ro': 'Romanian', 'sk': 'Slovak', 'uk': 'Ukrainian',
  };
  // Handle region codes like pt-BR -> Portuguese (Brazil) - basic split
  const baseCode = code.split(/[-_]/)[0];
  return languageMap[code] || languageMap[baseCode] || code.toUpperCase(); // Fallback to code
}


// --- Code Action Provider ---
class ExtractStringRefactoringProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection
  ): vscode.CodeAction[] | undefined {
    const selectedText = document.getText(range);
    // Only show if there's non-whitespace text selected, and likely within quotes
    if (!selectedText.trim() || !/['"]/.test(selectedText)) {
      return;
    }

    // Create a Refactor action
    const action = new vscode.CodeAction('ARB: Extract String', vscode.CodeActionKind.RefactorExtract); // Use specific kind
    action.command = {
      command: `${EXTENSION_ID}.extractString`, // Use the main command ID
      title: 'Extract String to ARB file',
      tooltip: 'Extracts the selected string literal to your project\'s ARB file(s).'
    };
    // Optional: Tell VS Code this is the "preferred" action if multiple refactors match
    action.isPreferred = true;

    return [action];
  }
}