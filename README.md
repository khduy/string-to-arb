# String to ARB Extractor

A VS Code extension that helps you extract strings from your Dart code into ARB files for internationalization.

## Features

- Extract strings from Dart code to ARB files
- Automatically detect and handle Dart string interpolation
- Support for both single and double quotes
- Auto-translation using Gemini API
- Automatic detection of target languages
- Customizable file name patterns
- Option to enable/disable auto-translation

## Requirements

- VS Code version 1.87.0 or higher
- Gemini API key (for translation feature)

## Extension Settings

This extension contributes the following settings:

* `stringToArbExtractor.arbFolderPath`: Path to the folder containing ARB files for extraction and translation.
* `stringToArbExtractor.sourceLanguage`: Source language code (e.g., 'en' for English).
* `stringToArbExtractor.fileNamePattern`: Pattern for ARB file names. Use {lang} as a placeholder for the language code.
* `stringToArbExtractor.autoTranslate`: Automatically translate extracted strings to target languages.
* `stringToArbExtractor.geminiApiKey`: Gemini API key for translation.
* `stringToArbExtractor.prefix`: Prefix for the extracted key (e.g., S.current.keyName).

## Usage

### Step 1: Configure Settings
- Set your ARB folder path: `"stringToArbExtractor.arbFolderPath": "./lib/l10n"`
- Set your source language: `"stringToArbExtractor.sourceLanguage": "en"`
- Set your file name pattern: `"stringToArbExtractor.fileNamePattern": "intl_{lang}.arb"`
- Enable or disable auto-translation: `"stringToArbExtractor.autoTranslate": true` (enabled by default)
- Set your Gemini API key: `"stringToArbExtractor.geminiApiKey": "YOUR_API_KEY_HERE"`
- Set your prefix: `"stringToArbExtractor.prefix": "S.current"`

### Step 2: Extract a String
1. Select a string in your Dart code
2. Press `Cmd + .` (Mac) or `Ctrl + .` (Windows/Linux), then select "Extract String to ARB" from the Refactoring menu
3. Enter a key for the string (e.g., `orderNotFound`)
4. The string will be extracted to your ARB file and replaced with a reference


## Notes on Translation
- The extension uses the Gemini API (gemini-2.0-flash model) to translate strings.
- Placeholders in the format `{variable}` are preserved in translations.
- Target languages are automatically detected from existing ARB files in your folder.