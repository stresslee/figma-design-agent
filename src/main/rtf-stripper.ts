/**
 * RTF Text Extractor
 *
 * Strips RTF control codes and extracts plain text content.
 * Handles: control words, unicode escapes, hex escapes,
 * font/color tables, stylesheets, and nested groups.
 */

/**
 * Strip RTF formatting and extract plain text.
 * If the input doesn't look like RTF, returns it as-is.
 */
export function stripRtf(rtf: string): string {
  // Quick check — if it doesn't start with {\rtf, return as-is
  if (!rtf.trimStart().startsWith('{\\rtf')) return rtf;

  let output = '';
  let i = 0;
  let depth = 0;
  let skipGroup = false;
  let skipGroupDepth = 0;

  while (i < rtf.length) {
    const ch = rtf[i];

    // ── Opening brace: increase depth, check for groups to skip ──
    if (ch === '{') {
      depth++;
      // Check if this group should be entirely skipped
      const ahead = rtf.substring(i, i + 40);
      if (/^\{\\(\*\\[a-z]|fonttbl|colortbl|stylesheet|info\b|pict\b|object\b|filetbl|listtable|listoverridetable|revtbl|rsidtbl)/.test(ahead)) {
        skipGroup = true;
        skipGroupDepth = depth;
      }
      i++;
      continue;
    }

    // ── Closing brace: decrease depth, check if skip group ends ──
    if (ch === '}') {
      if (skipGroup && depth === skipGroupDepth) {
        skipGroup = false;
      }
      depth--;
      i++;
      continue;
    }

    // ── Skip content in ignored groups ──
    if (skipGroup) {
      i++;
      continue;
    }

    // ── Backslash: control word or escape ──
    if (ch === '\\') {
      i++;
      if (i >= rtf.length) break;

      // Escaped special characters: \\ \{ \}
      if (rtf[i] === '\\') { output += '\\'; i++; continue; }
      if (rtf[i] === '{') { output += '{'; i++; continue; }
      if (rtf[i] === '}') { output += '}'; i++; continue; }

      // Unicode escape: \uNNNN followed by replacement char
      if (rtf[i] === 'u' && i + 1 < rtf.length && /[-\d]/.test(rtf[i + 1])) {
        const match = rtf.substring(i).match(/^u(-?\d+)/);
        if (match) {
          const code = parseInt(match[1]);
          if (code >= 0) {
            output += String.fromCodePoint(code);
          } else {
            output += String.fromCodePoint(code + 65536);
          }
          i += match[0].length;
          // Skip the replacement character (usually '?')
          if (i < rtf.length && rtf[i] === '?') i++;
          // Skip optional trailing space
          if (i < rtf.length && rtf[i] === ' ') i++;
          continue;
        }
      }

      // Hex escape: \'XX (e.g., \'e9 for é)
      if (rtf[i] === "'") {
        i++;
        if (i + 1 < rtf.length) {
          const hex = rtf.substring(i, i + 2);
          const code = parseInt(hex, 16);
          if (!isNaN(code)) {
            output += String.fromCharCode(code);
          }
          i += 2;
          continue;
        }
      }

      // Control word: \word[-]N[space]
      const ctrlMatch = rtf.substring(i).match(/^([a-zA-Z]+)(-?\d+)?[ ]?/);
      if (ctrlMatch) {
        const word = ctrlMatch[1].toLowerCase();
        i += ctrlMatch[0].length;

        // Meaningful control words → output text
        switch (word) {
          case 'par':
          case 'pard':
            output += '\n';
            break;
          case 'line':
            output += '\n';
            break;
          case 'tab':
            output += '\t';
            break;
          case 'lquote':
            output += '\u2018';
            break;
          case 'rquote':
            output += '\u2019';
            break;
          case 'ldblquote':
            output += '\u201C';
            break;
          case 'rdblquote':
            output += '\u201D';
            break;
          case 'bullet':
            output += '\u2022';
            break;
          case 'endash':
            output += '\u2013';
            break;
          case 'emdash':
            output += '\u2014';
            break;
          case 'enspace':
          case 'emspace':
            output += ' ';
            break;
          // All other control words (formatting, layout) → skip
          default:
            break;
        }
        continue;
      }

      // Unknown backslash sequence — skip one char
      i++;
      continue;
    }

    // ── Regular characters ──
    // RTF uses \r\n as line breaks in the source, but actual line breaks are \par
    if (ch === '\r' || ch === '\n') {
      i++;
      continue;
    }

    output += ch;
    i++;
  }

  // Clean up: collapse multiple blank lines, trim
  return output
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+$/gm, '') // trailing whitespace per line
    .trim();
}

/**
 * Process attachment text content: strip RTF if applicable.
 * Detects RTF by content (not just file extension).
 */
export function processAttachmentText(textContent: string, fileName: string): string {
  const isRtf = fileName.toLowerCase().endsWith('.rtf') || textContent.trimStart().startsWith('{\\rtf');
  if (isRtf) {
    const stripped = stripRtf(textContent);
    console.log(`[RTF] Stripped "${fileName}": ${textContent.length} bytes → ${stripped.length} bytes (${Math.round((1 - stripped.length / textContent.length) * 100)}% reduction)`);
    return stripped;
  }
  return textContent;
}
