import * as vscode from 'vscode';
import { ExtensionConfig } from './types';

export const EXTENSION_ID = 'string-to-arb-extractor'; // Replace if your extension ID is different
export const CONFIG_SECTION = 'stringToArbExtractor';

export function getConfiguration(): ExtensionConfig {
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
