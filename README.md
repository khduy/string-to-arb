# String to ARB Extractor - Usage Tutorial

This VS Code extension helps you extract strings from your Flutter/Dart code into ARB files for internationalization. It also supports auto-translation to multiple languages using the Gemini API. Follow this guide to get started!

## Config (settings.json)
- ARB Folder Path: `"stringToArbExtractor.arbFolderPath": "./lib/l10n"`,
- Source Language: `"stringToArbExtractor.sourceLanguage": "en"`,
- File Name Pattern: `"stringToArbExtractor.fileNamePattern": "intl_{lang}.arb"`,
- Auto Translate: `"stringToArbExtractor.autoTranslate": true`,
- Gemini API Key: `"stringToArbExtractor.geminiApiKey": "YOUR_API_KEY_HERE"`,
- Prefix: `"stringToArbExtractor.prefix": "S.current"`

## How to Use String Extraction

### Step 1: Select a String
- Open a Dart file in VS Code.
- Highlight a string, with or without quotes.  
  **Example**: `'Không tìm thấy đơn hàng ${data.data.order.code}'`

### Step 2: Trigger the Extraction
- **Option 1**: Press `Cmd + .` (Mac) or `Ctrl + .` (Windows/Linux), then select "Extract String to ARB" from the Refactoring menu.
- **Option 2**: Right-click on your selection and choose "Extract String to ARB" from the context menu.
- **Option 3**: Open the Command Palette (`Cmd + Shift + P` or `Ctrl + Shift + P`), type "Extract String to ARB", and select it.

### Step 3: Enter a Key
- A prompt will appear: "Enter a key for the extracted string".
- Type a descriptive key (e.g., `orderNotFound`) and press Enter.

### Step 4: Handle Duplicates (If Prompted)
- **If the Key Already Exists**:  
  - You'll see: `Key "orderNotFound" already exists with value "Order not found". What would you like to do?`  
  - Choose:  
    - **Use existing key**: Uses the current key and skips adding a new entry.  
    - **Add as new key with suffix**: Creates a new key like `orderNotFound_1`.  

- **If the String Already Exists**:  
  - You'll see: `The string "Không tìm thấy đơn hàng {code}" already exists as "existing". What would you like to do?`  
  - Choose:  
    - **Use existing key**: Reuses the existing key (e.g., `existing`).  
    - **Add as new key anyway**: Adds your new key (e.g., `orderNotFound`).

### Step 5: Check the Result
- **Code**: The selected string is replaced with a reference.  
  **Example**: `S.current.orderNotFound(data.data.order.code)`
- **ARB File**: The string is added to your ARB file based on your source language and file pattern (default: `./lib/l10n/intl_en.arb`).  
  **Example**:  
  ```json
  {
    "orderNotFound": "Không tìm thấy đơn hàng {code}"
  }
  ```

## Auto-Translation

### Step 1: Configure Settings
- Enable or disable auto-translation: `"stringToArbExtractor.autoTranslate": true` (enabled by default)
- Set your Gemini API key in settings: `"stringToArbExtractor.geminiApiKey": "YOUR_API_KEY_HERE"`.
- Configure source language: `"stringToArbExtractor.sourceLanguage": "en"`.
- Set the ARB folder path: `"stringToArbExtractor.arbFolderPath": "./lib/l10n"`.
- Set the file name pattern: `"stringToArbExtractor.fileNamePattern": "intl_{lang}.arb"`.

### Step 2: Create Target Language Files (Optional)
- The extension will automatically detect target language files in your ARB folder.
- Files must follow your fileNamePattern with language codes replacing the `{lang}` placeholder.
- If no target language files are found, the extension will prompt you to create one.

### Step 3: Translation Process
- When you extract a string and auto-translation is enabled, the extension will automatically:
  1. Add the string to your source language ARB file
  2. Detect all target language files in your ARB folder
  3. Translate the string to each target language
  4. Add the translations to the respective ARB files
- If auto-translation is disabled, only step 1 will be performed.

### Step 4: Check Results
- The extension will create or update ARB files for each target language in your ARB folder.
- The naming pattern follows your fileNamePattern setting (default: `intl_{lang}.arb`).

## Notes on Translation
- The extension uses the Gemini API (gemini-2.0-flash model) to translate strings.
- Placeholders in the format `{variable}` are preserved in translations.
- Target languages are automatically detected from existing ARB files in your folder.
- Auto-translation can be turned off if you prefer to manage translations manually.  