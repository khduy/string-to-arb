# String to ARB Extractor - Usage Tutorial

This VS Code extension helps you extract strings from your Flutter/Dart code into ARB files for internationalization. Follow this guide to get started!

## Config (settings.json)
- ARB File Path: `"stringToArbExtractor.arbFilePath": "./lib/l10n/app_en.arb"`,
- Prefix: `"stringToArbExtractor.prefix": "S.current"`

## How to Use

### Step 1: Select a String
- Open a Dart file in VS Code.
- Highlight a string, with or without quotes.  
  **Example**: `'Không tìm thấy đơn hàng ${data.data.order.code}'`

### Step 2: Trigger the Extraction
- **Option 1**: Press `Cmd + .` (Mac) or `Ctrl + .` (Windows/Linux), then select "Extract String to ARB" from the Quick Fix menu.  
- **Option 2**: Open the Command Palette (`Cmd + Shift + P` or `Ctrl + Shift + P`), type "Extract String to ARB", and select it.

### Step 3: Enter a Key
- A prompt will appear: "Enter a key for the extracted string".
- Type a descriptive key (e.g., `orderNotFound`) and press Enter.

### Step 4: Handle Duplicates (If Prompted)
- **If the Key Already Exists**:  
  - You’ll see: `Key "orderNotFound" already exists with value "Order not found". What would you like to do?`  
  - Choose:  
    - **Use existing key**: Uses the current key and skips adding a new entry.  
    - **Add as new key with suffix**: Creates a new key like `orderNotFound_1`.  

- **If the String Already Exists**:  
  - You’ll see: `The string "Không tìm thấy đơn hàng {code}" already exists as "existing". What would you like to do?`  
  - Choose:  
    - **Use existing key**: Reuses the existing key (e.g., `existing`).  
    - **Add as new key anyway**: Adds your new key (e.g., `orderNotFound`).

### Step 5: Check the Result
- **Code**: The selected string is replaced with a reference.  
  **Example**: `S.current.orderNotFound(data.data.order.code)`
- **ARB File**: The string is added to your ARB file (default: `./lib/l10n/app_en.arb`).  
  **Example**:  
  ```json
  {
    "orderNotFound": "Không tìm thấy đơn hàng {code}"
  }
  ```
  