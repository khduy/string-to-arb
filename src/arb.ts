import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ArbContent, ExtensionConfig, ConflictResult, ArbPathInfo } from './types';
import { detectAndConvertPlaceholders } from './utils'; // Import necessary utils

export function resolveArbPaths(config: ExtensionConfig, workspaceFolder: vscode.WorkspaceFolder): ArbPathInfo {
  const sourceArbFileName = config.fileNamePattern.replace('{lang}', config.sourceLanguage);
  const absoluteArbFolderPath = path.resolve(workspaceFolder.uri.fsPath, config.arbFolderPath);
  const absoluteArbFilePath = path.join(absoluteArbFolderPath, sourceArbFileName);
  return { absoluteArbFolderPath, absoluteArbFilePath, sourceArbFileName };
}

export async function readOrCreateArbFile(filePath: string, fileName: string, folderPath: string): Promise<ArbContent | null> {
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

export async function handleConflicts(
  userKey: string,
  arbText: string,
  arbContent: ArbContent,
  prefix: string
): Promise<ConflictResult> {
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
      const editor = vscode.window.activeTextEditor; // Get editor here
      if (!editor) return { shouldReturn: true, keyToUse }; // Should not happen if command was invoked
      const { originalPlaceholders } = detectAndConvertPlaceholders(editor.document.getText(editor.selection) || ''); // Re-detect for accuracy
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
      const editor = vscode.window.activeTextEditor; // Get editor here
      if (!editor) return { shouldReturn: true, keyToUse }; // Should not happen
      const { originalPlaceholders } = detectAndConvertPlaceholders(editor.document.getText(editor.selection) || ''); // Re-detect
      replacement = originalPlaceholders.length
        ? `${prefix}.${existingKeyForValue}(${originalPlaceholders.join(', ')})`
        : `${prefix}.${existingKeyForValue}`;
      return { shouldReturn: true, keyUsed: existingKeyForValue, keyToUse, replacement };
    }
    // Else: Proceed to add with keyToUse (which might have suffix)
  }

  return { shouldReturn: false, keyToUse }; // Proceed to add the entry
}

export async function updateSourceArb(filePath: string, fileName: string, arbContent: ArbContent, key: string, value: string): Promise<boolean> {
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
