# String to ARB Extractor

[![Version](https://img.shields.io/badge/version-1.0.0-blue)](https://marketplace.visualstudio.com/items?itemName=khduy.string-to-arb-extractor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Extracts string literals from your Dart/Flutter code into ARB files, optionally translates them using the Gemini API, and replaces the string with a localization key.

## Features

*   **Extract Strings:** Select a string literal in your Dart code and extract it to your source ARB file.
*   **Placeholder Handling:** Automatically detects and converts Dart string interpolation (`${expression}` or `$variable`) into ARB placeholder format (`{variableName}`).
*   **Key Conflict Resolution:** Prompts you if the chosen key or the string value already exists in the ARB file, allowing you to reuse or create a new key.
*   **Gemini Auto-Translation:** If enabled and configured with an API key, automatically translates the extracted string to all other detected target language ARB files.
*   **Automatic Import:** Optionally adds the required import statement for your localization class if it's missing.
*   **Post-Extraction Command:** Optionally runs a command (like `flutter gen-l10n`) after extraction is complete.
*   **Easy Activation:** Use the Code Action menu (`Cmd+.` / `Ctrl+.`) or the Command Palette.

## Requirements

*   VS Code version 1.87.0 or higher.
*   A Dart/Flutter project structure.
*   (Optional) Google AI Gemini API Key for the auto-translation feature.

## Usage

1.  **Select:** Highlight the string literal (including the quotes) you want to extract in your Dart file.
2.  **Activate:**
    *   Press `Cmd+.` (Mac) or `Ctrl+.` (Windows/Linux) and select `ARB: Extract String`.
    *   *Alternatively*, open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run `ARB: Extract String`.
3.  **Enter Key:** Provide a unique key for the string when prompted (e.g., `helloWorld`, `userGreeting`).
4.  **Done:** The extension will:
    *   Add the key and string to your source ARB file (e.g., `intl_en.arb`).
    *   Replace the selected string in your code with the localization key (e.g., `S.current.helloWorld`).
    *   (If configured) Add the necessary import statement.
    *   (If configured) Translate the string to other ARB files.
    *   (If configured) Run the post-extraction command.

## Extension Settings

Configure the extension in your VS Code Settings (`settings.json`):

| Setting                                       | Description                                                                                                                                                                                          | Default             |
| :-------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------ |
| `stringToArbExtractor.arbFolderPath`        | Path relative to the workspace root where ARB files are stored.                                                                                                                                      | `./lib/l10n`        |
| `stringToArbExtractor.sourceLanguage`       | The language code (e.g., 'en', 'es') of the source ARB file.                                                                                                                                         | `en`                |
| `stringToArbExtractor.fileNamePattern`      | Filename pattern for ARB files. Must include `{lang}` placeholder.                                                                                                                                   | `intl_{lang}.arb`   |
| `stringToArbExtractor.prefix`               | The prefix used when replacing the string in Dart code (e.g., `S.current`, `context.l10n`).                                                                                                          | `S.current`         |
| `stringToArbExtractor.autoTranslate`        | Enable automatic translation using Gemini API Key.                                                                                                                                                   | `true`              |
| `stringToArbExtractor.geminiApiKey`         | Your Google AI Gemini API Key. **Security Note:** Consider using VS Code's Secret Storage API or environment variables instead of storing directly in `settings.json`, especially in shared projects. | `""`                |
| `stringToArbExtractor.importStatement`      | (Optional) Full import statement (e.g., `import 'package:my_app/l10n/l10n.dart';`) to add if missing. Leave empty to disable.                                                                         | `""`                |
| `stringToArbExtractor.postExtractionCommand`| (Optional) Command to execute after extraction (e.g., `flutter gen-l10n`). Leave empty to disable.                                                                                                   | `""`                |

You can also open the extension settings UI directly via the Command Palette: `ARB: Open Extractor Settings`.

## Known Issues

*   Complex nested interpolations or escaped quotes within strings might require manual adjustment after extraction.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
