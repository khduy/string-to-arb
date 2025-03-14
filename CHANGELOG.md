# Change Log

## [0.0.2]

- Added auto-translation feature using Gemini API (gemini-2.0-flash model).
- Added automatic detection of target languages from existing ARB files.
- Added support for customizable file name patterns (e.g., intl_{lang}.arb).
- Added option to enable/disable auto-translation.
- Enhanced error handling and progress reporting for translation.
- Removed metadata tracking for simplified ARB files.
- Removed the need to manually configure target languages.
- Simplified configuration by deriving source ARB file path from folder path and source language.

## [0.0.1]

- Initial release
- Basic string extraction to ARB files
- Support for Dart string interpolation
- Support for both single and double quotes
- Configurable ARB folder path and source language
- Configurable prefix for extracted keys