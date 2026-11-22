// File inspection: getting the text out of a file inside the browser, so only text (never
// the file) goes to KYRA. A classic script like prompt-core.js; it runs unchanged in Node
// for the unit tests (File/Blob, TextDecoder and DecompressionStream exist there too).
//
// Readable: plain-text formats, and Word, Excel and PowerPoint documents (OOXML: a zip of
// XML parts). Everything else (images, PDF, archives, old binary Office formats, files over
// the size limit) is "unscannable": the company's setting decides what happens to those.

(function (root) {
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_TEXT_CHARS = 100000; // the server's limit per scan
  const MAX_PART_BYTES = 30 * 1024 * 1024; // one inflated XML part; guards against zip bombs

  const TEXT_EXTENSIONS = new Set([
    'txt', 'text', 'log', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'xml', 'yaml', 'yml',
    'ini', 'conf', 'cfg', 'env', 'properties', 'toml', 'sql', 'html', 'htm', 'css', 'rtf', 'tex', 'srt', 'vtt',
    'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'kt', 'kts', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'go',
    'rs', 'rb', 'php', 'swift', 'scala', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'r', 'pl', 'lua', 'dart',
    'vue', 'svelte', 'gradle', 'tf', 'ipynb', 'pem', 'key', 'crt', 'pub',
  ]);
  const OOXML_PARTS = {
    docx: (name) => /^word\/(document|footnotes|endnotes|comments|header\d*|footer\d*)\.xml$/.test(name),
    xlsx: (name) => name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
    pptx: (name) => /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(name),
  };

  function extensionOf(name) {
    const base = String(name || '').toLowerCase();
    const dot = base.lastIndexOf('.');
    return dot < 0 ? '' : base.slice(dot + 1);
  }

  /** 'text', 'docx', 'xlsx', 'pptx' or 'unscannable'. */
  function classify(name, mimeType, size) {
    if (typeof size === 'number' && size > MAX_FILE_BYTES) return 'unscannable';
    const ext = extensionOf(name);
    if (OOXML_PARTS[ext]) return ext;
    if (TEXT_EXTENSIONS.has(ext)) return 'text';
    const mime = String(mimeType || '').toLowerCase();
    if (!ext && (mime.startsWith('text/') || mime === 'application/json')) return 'text';
    return 'unscannable';
  }

  /** Images and PDFs: not readable here, but KYRA can read their text when the company asks for it. */
  const SERVER_READ_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'pdf']);

  function serverReadable(name, mimeType) {
    if (SERVER_READ_EXTENSIONS.has(extensionOf(name))) return true;
    const mime = String(mimeType || '').toLowerCase();
    return mime === 'application/pdf' || /^image\/(png|jpeg|webp|gif|bmp|tiff)$/.test(mime);
  }

  /** The file's bytes as base64, or null when it is empty or larger than maxBytes. */
  async function readBase64(file, maxBytes) {
    if (!file.size || file.size > maxBytes) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, code) => {
      const c = code.toLowerCase();
      if (c === 'amp') return '&';
      if (c === 'lt') return '<';
      if (c === 'gt') return '>';
      if (c === 'quot') return '"';
      if (c === 'apos') return "'";
      const point = c.startsWith('#x') ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      try {
        return String.fromCodePoint(point);
      } catch {
        return whole;
      }
    });
  }

  /** The text of an OOXML part: paragraph, row and cell ends become breaks, tags go. */
  function xmlToText(xml) {
    return decodeEntities(xml
      .replace(/<\/(w:p|a:p|row|si)>/g, '\n')
      .replace(/<(w:tab|w:br|a:br)\b[^>]*\/>/g, ' ')
      .replace(/<\/(c|w:tc|a:tc)>/g, ' ')
      .replace(/<[^>]+>/g, ''))
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_PART_BYTES) {
        await reader.cancel();
        throw new Error('part too large');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  /** The zip's entries from its central directory: [{name, method, compressedSize, localOffset}]. */
  function zipEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
      if (view.getUint32(i, true) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error('not a zip');
    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const decoder = new TextDecoder();
    const entries = [];
    for (let n = 0; n < count && at + 46 <= bytes.length; n += 1) {
      if (view.getUint32(at, true) !== 0x02014b50) break;
      const nameLength = view.getUint16(at + 28, true);
      entries.push({
        name: decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
        method: view.getUint16(at + 10, true),
        compressedSize: view.getUint32(at + 20, true),
        localOffset: view.getUint32(at + 42, true),
      });
      at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    return entries;
  }

  async function zipEntryBytes(bytes, entry) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const at = entry.localOffset;
    if (view.getUint32(at, true) !== 0x04034b50) throw new Error('bad zip entry');
    const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
    const data = bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return data;
    if (entry.method === 8) return inflateRaw(data);
    throw new Error('unsupported zip compression');
  }

  async function ooxmlText(bytes, kind) {
    const wanted = zipEntries(bytes).filter((e) => OOXML_PARTS[kind](e.name))
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    if (!wanted.length) throw new Error('no document parts');
    const decoder = new TextDecoder();
    const parts = [];
    let length = 0;
    for (const entry of wanted) {
      const text = xmlToText(decoder.decode(await zipEntryBytes(bytes, entry)));
      if (text) {
        parts.push(text);
        length += text.length + 1;
      }
      if (length >= MAX_TEXT_CHARS) break;
    }
    return parts.join('\n');
  }

  /**
   * The file's text: {scannable: true, text, truncated} (text may be '' for an empty file),
   * or {scannable: false} when it cannot be read here.
   */
  async function extractText(file) {
    const kind = classify(file.name, file.type, file.size);
    if (kind === 'unscannable') return { scannable: false };
    try {
      let text;
      if (kind === 'text') {
        // Four bytes per character at most; never read more than the scan can take.
        text = new TextDecoder().decode(await file.slice(0, MAX_TEXT_CHARS * 4).arrayBuffer());
        // Binary content under a text name is not text.
        if (/\u0000/.test(text.slice(0, 4000))) return { scannable: false };
      } else {
        text = await ooxmlText(new Uint8Array(await file.arrayBuffer()), kind);
      }
      const truncated = text.length > MAX_TEXT_CHARS || (kind === 'text' && file.size > MAX_TEXT_CHARS * 4);
      return { scannable: true, text: text.slice(0, MAX_TEXT_CHARS), truncated };
    } catch {
      // Password-protected, damaged or not what its name says.
      return { scannable: false };
    }
  }

  root.KyraFileCore = {
    classify, extractText, xmlToText, serverReadable, readBase64, MAX_FILE_BYTES, MAX_TEXT_CHARS,
  };
})(typeof self !== 'undefined' ? self : globalThis);
