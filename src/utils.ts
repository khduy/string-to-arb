import * as vscode from 'vscode'; // Added import for vscode
import { PlaceholderInfo } from './types';

export function detectAndConvertPlaceholders(text: string): PlaceholderInfo {
  const dartPlaceholderRegex = /\${([^}]+)}|\$(\w+)/g;
  const arbPlaceholderRegex = /\{([^}]+)\}/g;
  const originalPlaceholders: string[] = [];
  const arbPlaceholders: string[] = [];
  let arbText = text;

  // Convert Dart-style placeholders
  let dartMatch;
  while ((dartMatch = dartPlaceholderRegex.exec(text)) !== null) {
    const fullPlaceholder = dartMatch[1] ?? dartMatch[2]; // Use nullish coalescing
    if (!fullPlaceholder) continue;

    // Attempt to clean the placeholder name
    let cleanedPlaceholder = fullPlaceholder
      .replace(/\s*[\+\-\*\/]\s*.+$/, '') // Remove trailing math ops
      .replace(/!$/, '') // Remove trailing null assertion
      .trim();

    const parts = cleanedPlaceholder.split('.');
    const simpleName = parts[parts.length - 1] || 'variable'; // Extract last part or use fallback

    // Avoid duplicates from multiple detections of the same source placeholder
    if (!originalPlaceholders.includes(fullPlaceholder)) {
      originalPlaceholders.push(fullPlaceholder);
      arbPlaceholders.push(simpleName);
    }

    // Replace *only the first occurrence* in arbText in this iteration to handle repeated placeholders
    const regexForReplacement = new RegExp(dartMatch[0].replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), ''); // Escape regex chars
    if (!arbText.includes(`{${simpleName}}`)) { // Avoid replacing if already converted (e.g. identical $var and ${var})
      arbText = arbText.replace(regexForReplacement, `{${simpleName}}`);
    }
  }

  // Add any existing ARB-style placeholders that weren't converted (idempotency)
  let arbMatch;
  while ((arbMatch = arbPlaceholderRegex.exec(arbText)) !== null) {
    const placeholderName = arbMatch[1];
    if (!arbPlaceholders.includes(placeholderName)) {
      // If an {arbStyle} exists but wasn't from a $dartStyle, assume it's meant to be there.
      // We need to ensure it's accounted for in the replacement arguments.
      originalPlaceholders.push(placeholderName); // Use the name directly as the 'original' argument
      arbPlaceholders.push(placeholderName);
    }
  }

  return { originalPlaceholders, arbPlaceholders, arbText };
}


export function generateSuggestedKey(text: string): string {
  // Remove placeholders for suggestion clarity
  const cleanText = text.replace(/\{[^}]+\}/g, '');
  // Basic camelCase conversion
  let key = cleanText
    .replace(/[^a-zA-Z0-9\s]/g, '') // Keep only letters, numbers, spaces
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean) // Remove empty strings resulting from multiple spaces
    .map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
    .join('');

  // Limit length and provide fallback
  key = key.substring(0, 40);
  return key || 'myString';
}

export function getLanguageName(code: string): string {
  try {
    // Use Intl.DisplayNames to get the language name.
    // Fallback chain: User's VSCode language -> English -> Uppercase Code
    const displayNames = new Intl.DisplayNames([vscode.env.language, 'en'], { type: 'language' });
    // Attempt to get the name; use code itself if lookup fails (e.g., invalid code)
    return displayNames.of(code) || code.toUpperCase();
  } catch (e) {
    // Handle potential errors during Intl.DisplayNames instantiation or lookup
    console.error(`Error getting display name for code "${code}":`, e);
    // Fallback to the uppercase code string if Intl fails
    return code.toUpperCase();
  }
}
