// Conservative linear string scanning, not JavaScript execution or a full parser.
// A standalone `from` can over-discover a resource; fetch validation rejects non-JS responses.
export function extractImports(source, importerUrl) {
  const urls = new Set();
  const specifiers = new Set();
  let unresolved = false;
  const keywords = /\b(import|from)\b/g;
  const trivia = (start) => {
    let i = start;
    while (i < source.length) {
      if (/\s/.test(source[i])) { i += 1; continue; }
      if (source.startsWith('/*', i)) {
        const end = source.indexOf('*/', i + 2);
        i = end < 0 ? source.length : end + 2;
      } else if (source.startsWith('//', i)) {
        const end = source.indexOf('\n', i + 2);
        i = end < 0 ? source.length : end + 1;
      } else break;
    }
    keywords.lastIndex = Math.max(keywords.lastIndex, i);
    return i;
  };
  const literal = (start) => {
    const quote = source[start];
    let value = '';
    let valid = true;
    let closed = false;
    let i = start + 1;
    for (; i < source.length; i += 1) {
      let char = source[i];
      if (char === quote) { closed = true; i += 1; break; }
      if (char === '\n' || char === '\r') { valid = false; break; }
      if (quote === '`' && source.startsWith('${', i)) valid = false;
      if (char === '\\') {
        char = source[++i];
        if (char === '\n') continue;
        if (char === '\r') { if (source[i + 1] === '\n') i += 1; continue; }
        if (char === 'x' || char === 'u') {
          const length = char === 'x' ? 2 : 4;
          const digits = source.slice(i + 1, i + 1 + length);
          if (digits.length !== length || !/^[0-9a-f]+$/i.test(digits)) valid = false;
          else { char = String.fromCharCode(parseInt(digits, 16)); i += length; }
        } else char = ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' })[char] ?? char;
      }
      value += char || '';
    }
    if (!closed) valid = false;
    keywords.lastIndex = Math.max(keywords.lastIndex, i);
    return { value, valid, end: i };
  };
  const add = (value) => {
    if (specifiers.has(value)) return;
    specifiers.add(value);
    if (!/^(?:\.\.?\/|\/|https?:\/\/)/i.test(value)) { unresolved = true; return; }
    try {
      const url = new URL(value, importerUrl);
      if (!['http:', 'https:'].includes(url.protocol)) { unresolved = true; return; }
      url.hash = '';
      urls.add(url.href);
    } catch { unresolved = true; }
  };
  let match;
  while ((match = keywords.exec(source))) {
    let i = trivia(keywords.lastIndex);
    const dynamic = match[1] === 'import' && source[i] === '(';
    if (match[1] === 'import' && source[i] === '.') continue;
    if (dynamic) i = trivia(i + 1);
    if (!['"', "'", '`'].includes(source[i])) {
      if (dynamic) unresolved = true;
      continue;
    }
    const item = literal(i);
    const end = dynamic ? trivia(item.end) : item.end;
    if (!item.valid || (dynamic && ![')', ','].includes(source[end]))) unresolved = true;
    else add(item.value);
  }
  return { urls: [...urls], unresolved };
}
