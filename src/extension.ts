import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

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
    const arbPlaceholders: string[] = []; // Simplified names for ARB file
    let arbText = selectedText; // The text to store in ARB, after conversion

    // Convert Dart-style placeholders to ARB-style
    let dartMatch;
    while ((dartMatch = dartPlaceholderRegex.exec(selectedText)) !== null) {
      const fullPlaceholder = dartMatch[1] || dartMatch[2]; // e.g., "data.data.order.code" or "code"
      const parts = fullPlaceholder.split('.');
      const simpleName = parts[parts.length - 1]; // e.g., "code"
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
    const arbFilePath = config.get<string>('arbFilePath', './lib/l10n/app_en.arb');
    const prefix = config.get<string>('prefix', 'S.current');

    // Prompt for the key
    let key = await vscode.window.showInputBox({
      prompt: 'Enter a key for the extracted string',
      placeHolder: 'e.g., orderNotFound',
      validateInput: (value) => (value.trim() ? null : 'Key cannot be empty'),
    });
    if (!key) {
      return; // User canceled
    }

    // Resolve absolute path to ARB file
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found.');
      return;
    }
    const absoluteArbPath = path.resolve(workspaceFolder.uri.fsPath, arbFilePath);

    // Ensure the directory exists
    const arbDir = path.dirname(absoluteArbPath);
    if (!fs.existsSync(arbDir)) {
      fs.mkdirSync(arbDir, { recursive: true });
    }

    // Read or initialize ARB file
    let arbContent: { [key: string]: string } = {};
    if (fs.existsSync(absoluteArbPath)) {
      const fileContent = fs.readFileSync(absoluteArbPath, 'utf8');
      try {
        arbContent = JSON.parse(fileContent);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to parse ${arbFilePath}: Invalid JSON. ${error.message}. Resetting to empty content.`
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
        vscode.window.showInformationMessage(`Reused existing key "${key}" from ${arbFilePath}.`);
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
    const existingKey = Object.keys(arbContent).find((k) => arbContent[k] === arbText);
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
        vscode.window.showInformationMessage(`Reused existing key "${existingKey}" from ${arbFilePath}.`);
        return;
      }
      // If 'Add as new key anyway' is selected, proceed
    }

    // Add the new key-value pair (use converted ARB text)
    arbContent[key] = arbText;

    // Write back to ARB file
    try {
      fs.writeFileSync(absoluteArbPath, JSON.stringify(arbContent, null, 2), 'utf8');
      vscode.window.showInformationMessage(`String extracted to ${arbFilePath} as "${key}"`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to write to ${arbFilePath}: ${error.message}`);
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

  // Register the code action provider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      ['plaintext', 'javascript', 'typescript', 'dart'],
      new ExtractStringProvider(),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      }
    )
  );

  context.subscriptions.push(disposable);
}

// Code Action Provider for Quick Fix
class ExtractStringProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection
  ): vscode.CodeAction[] | undefined {
    const selectedText = document.getText(range).trim();
    if (!selectedText) {
      return;
    }

    const action = new vscode.CodeAction('Extract String to ARB', vscode.CodeActionKind.QuickFix);
    action.command = {
      command: 'string-to-arb-extractor.extractString',
      title: 'Extract String to ARB',
    };
    return [action];
  }
}

export function deactivate() {}