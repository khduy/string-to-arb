import * as vscode from 'vscode';
import { ArbContent } from './types'; // Import necessary types
import { EXTENSION_ID, getConfiguration } from './config';
import { detectAndConvertPlaceholders, generateSuggestedKey } from './utils';
import {
  getSelectionAndText,
  promptForKey,
  replaceTextInEditor,
  ensureImport,
  runPostExtractionCommand,
  ExtractStringRefactoringProvider
} from './vscodeUtils';
import {
  resolveArbPaths,
  readOrCreateArbFile,
  handleConflicts,
  updateSourceArb
} from './arb';
import { performTranslations } from './translation';

// --- Activation ---
export function activate(context: vscode.ExtensionContext) {
  console.log('String to ARB Extractor is now active!');

  // --- Command Registration ---
  const extractCommand = vscode.commands.registerCommand(`${EXTENSION_ID}.extractString`, runExtraction);
  const contextMenuCommand = vscode.commands.registerTextEditorCommand(`${EXTENSION_ID}.extractStringFromContext`, runExtraction); // Keep using runExtraction
  const openSettingsCommand = vscode.commands.registerCommand(`${EXTENSION_ID}.openSettings`, () => {
    // Use dynamic ID from context
    vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`);
  });

  // --- Code Action Provider ---
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    ['dart'], // Target Dart files
    new ExtractStringRefactoringProvider(), // Use the imported provider
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
        placeholderInfo.arbText, // Pass the text with ARB placeholders
        config.geminiApiKey
      );
    } else {
      vscode.window.showInformationMessage('Auto-translation enabled but Gemini API Key not configured. Translation skipped.');
    }
  }

  // --- Run Post-Extraction Command ---
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
