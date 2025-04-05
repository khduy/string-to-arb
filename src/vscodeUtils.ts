import * as vscode from 'vscode';
import { exec } from 'child_process';
import { SelectionInfo } from './types';
import { EXTENSION_ID } from './config'; // Import constant

export function getSelectionAndText(editor: vscode.TextEditor): SelectionInfo | null {
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

export async function promptForKey(suggestedKey: string): Promise<string | undefined> {
  return await vscode.window.showInputBox({
    prompt: 'Enter a key for the extracted string',
    placeHolder: `e.g., ${suggestedKey}`,
    value: suggestedKey, // Pre-fill
    validateInput: (value) => (value?.trim() ? null : 'Key cannot be empty'),
    ignoreFocusOut: true, // Keep open if focus lost
  });
}

export async function replaceTextInEditor(editor: vscode.TextEditor, selection: vscode.Selection, replacement: string) {
  try {
    await editor.edit((editBuilder) => {
      editBuilder.replace(selection, replacement);
    });
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to replace text in editor: ${error.message}`);
  }
}

export async function ensureImport(editor: vscode.TextEditor, importStatement: string | undefined) {
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

export async function runPostExtractionCommand(command: string, workspaceFolderPath: string): Promise<void> {
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

// --- Code Action Provider ---
export class ExtractStringRefactoringProvider implements vscode.CodeActionProvider {
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
