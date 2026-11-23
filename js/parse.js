// Reads an uploaded outline (PDF, DOCX, TXT or MD) on the device and splits it
// into sections by heading. Nothing is uploaded anywhere.

const HEADING_PATTERN = /^(part|chapter|topic|unit|module)\s+[\divxlc]+\b|^[ivxlc]+\.\s+\S|^[A-Z]\.\s+\S|^\d+(\.\d+)*\.?\s+[A-Z§]/i;

export async function parseOutline(file) {
  const name = file.name || 'Outline';
  const lower = name.toLowerCase();
  const buf = await file.arrayBuffer();
  let blocks;
  if (lower.endsWith('.pdf') || file.type === 'application/pdf') blocks = await pdfBlocks(buf);
  else if (lower.endsWith('.docx')) blocks = await docxBlocks(buf);
  else if (lower.endsWith('.txt') || lower.endsWith('.md') || (file.type || '').startsWith('text/')) blocks = textBlocks(new TextDecoder().decode(buf));
  else throw new Error('That file type isn\'t supported. Use a PDF, a Word (.docx) file, or a .txt file. Older .doc files need to be saved as .docx first.');
  const sections = buildSections(blocks);
  if (!sections.length) throw new Error('No readable text was found. If this is a scanned PDF, it has no text layer to read.');
  return { title: name.replace(/\.(pdf|docx|txt|md)$/i, ''), sections, headingCount: sections.filter(s => s.detected).length };
}

// ---------- block model: {text, heading: level|0, page} ----------

function buildSections(blocks) {
  const out = [];
  let cur = null;
  const stack = [];
  const push = () => { if (cur) { cur.text = cur.text.trim(); out.push(cur); } };
  blocks.forEach(b => {
    const t = clean(b.text);
    if (!t) return;
    if (b.heading) {
      push();
      while (stack.length && stack[stack.length - 1].level >= b.heading) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].id : null;
      cur = { id: 's' + out.length + '_' + Math.random().toString(36).slice(2, 7), heading: t.slice(0, 160), level: b.heading, page: b.page || null, text: '', parent, detected: true };
      stack.push({ level: b.heading, id: cur.id });
    } else {
      if (!cur) cur = { id: 's0_intro', heading: 'Introduction', level: 1, page: b.page || null, text: '', parent: null, detected: false };
      if (b.page && !cur.page) cur.page = b.page;
      cur.text += (cur.text ? (b.para ? '\n' : ' ') : '') + t;
      if (b.page) cur.lastPage = b.page;
    }
  });
  push();
  // normalize levels to 1..4 for display
  const levels = [...new Set(out.map(s => s.level))].sort((a, b) => a - b);
  out.forEach(s => { s.level = Math.min(4, levels.indexOf(s.level) + 1); });
  return out.filter(s => s.heading || s.text);
}

function clean(s) {
  return String(s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

// ---------- plain text / markdown ----------

export function textBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  lines.forEach(raw => {
    const line = raw.trim();
    if (!line) { blocks.push({ text: '', para: true }); return; }
    const md = line.match(/^(#{1,6})\s+(.*)$/);
    if (md) { blocks.push({ text: md[2], heading: md[1].length }); return; }
    const words = line.split(/\s+/).length;
    const caps = line.length > 3 && line === line.toUpperCase() && /[A-Z]/.test(line) && words <= 10;
    if ((HEADING_PATTERN.test(line) && words <= 12 && !/[.;,]$/.test(line)) || caps) {
      blocks.push({ text: line, heading: caps ? 1 : patternLevel(line) });
      return;
    }
    blocks.push({ text: line.replace(/^[-*•]\s+/, ''), para: true });
  });
  return blocks;
}

function patternLevel(line) {
  if (/^(part|chapter|topic|unit|module)\b/i.test(line)) return 1;
  if (/^[ivxlc]+\.\s/i.test(line)) return 2;
  if (/^[A-Z]\.\s/.test(line)) return 3;
  const m = line.match(/^(\d+(?:\.\d+)*)/);
  if (m) return Math.min(4, 2 + m[1].split('.').length);
  return 3;
}

// ---------- DOCX (zip + WordprocessingML), no library needed ----------

async function docxBlocks(buf) {
  const files = await unzip(buf, ['word/document.xml', 'word/styles.xml']);
  if (!files['word/document.xml']) throw new Error('This Word file looks damaged or isn\'t a .docx.');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const parser = new DOMParser();
  const styleLevel = {};
  if (files['word/styles.xml']) {
    const sdoc = parser.parseFromString(files['word/styles.xml'], 'application/xml');
    const styles = [...sdoc.getElementsByTagNameNS(W, 'style')];
    const byId = {};
    styles.forEach(st => {
      const id = st.getAttributeNS(W, 'styleId') || st.getAttribute('w:styleId');
      const nameEl = st.getElementsByTagNameNS(W, 'name')[0];
      const nm = nameEl ? (nameEl.getAttributeNS(W, 'val') || nameEl.getAttribute('w:val') || '') : '';
      const ol = st.getElementsByTagNameNS(W, 'outlineLvl')[0];
      const based = st.getElementsByTagNameNS(W, 'basedOn')[0];
      byId[id] = { nm, ol: ol ? +(ol.getAttributeNS(W, 'val') || ol.getAttribute('w:val')) : null, based: based ? (based.getAttributeNS(W, 'val') || based.getAttribute('w:val')) : null };
    });
    const levelOf = (id, depth = 0) => {
      const s = byId[id];
      if (!s || depth > 6) return 0;
      const m = s.nm.match(/^heading\s*(\d)/i);
      if (m) return +m[1];
      if (/^title$/i.test(s.nm)) return 1;
      if (s.ol !== null && s.ol < 9) return s.ol + 1;
      return s.based ? levelOf(s.based, depth + 1) : 0;
    };
    Object.keys(byId).forEach(id => { styleLevel[id] = levelOf(id); });
  }
  const doc = parser.parseFromString(files['word/document.xml'], 'application/xml');
  const paras = [...doc.getElementsByTagNameNS(W, 'p')];
  const blocks = [];
  let anyHeading = false;
  paras.forEach(p => {
    let text = '';
    let runs = 0, boldRuns = 0;
    p.querySelectorAll('*').forEach(n => {
      if (n.namespaceURI !== W) return;
      if (n.localName === 't') text += n.textContent;
      else if (n.localName === 'tab') text += ' ';
      else if (n.localName === 'br') text += ' ';
      else if (n.localName === 'r') {
        runs++;
        const rpr = [...n.children].find(c => c.localName === 'rPr');
        if (rpr && [...rpr.children].some(c => c.localName === 'b' && (c.getAttributeNS(W, 'val') || c.getAttribute('w:val') || 'true') !== '0' && (c.getAttribute('w:val') || '') !== 'false')) boldRuns++;
      }
    });
    const ppr = [...p.children].find(c => c.localName === 'pPr');
    let level = 0;
    if (ppr) {
      const ps = [...ppr.children].find(c => c.localName === 'pStyle');
      const ol = [...ppr.children].find(c => c.localName === 'outlineLvl');
      if (ps) level = styleLevel[ps.getAttributeNS(W, 'val') || ps.getAttribute('w:val')] || 0;
      if (!level && ol) { const v = +(ol.getAttributeNS(W, 'val') || ol.getAttribute('w:val')); if (v < 9) level = v + 1; }
    }
    const t = text.trim();
    if (!t) return;
    if (level) anyHeading = true;
    blocks.push({ text: t, heading: level, bold: runs > 0 && boldRuns === runs, para: true });
  });
  if (!anyHeading) {
    // Fallback: short, fully bold or numbered lines act as headings.
    blocks.forEach(b => {
      const words = b.text.split(/\s+/).length;
      if (words <= 12 && !/[.;,]$/.test(b.text) && (b.bold || HEADING_PATTERN.test(b.text))) b.heading = b.bold ? 2 : patternLevel(b.text);
    });
  }
  return blocks;
}

async function unzip(buf, wanted) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file isn\'t a valid .docx (zip) file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    if (wanted.includes(name)) {
      const lnlen = dv.getUint16(local + 26, true), lelen = dv.getUint16(local + 28, true);
      const start = local + 30 + lnlen + lelen;
      const data = u8.subarray(start, start + csize);
      let bytes;
      if (method === 0) bytes = data;
      else if (method === 8) bytes = await inflateRaw(data);
      else throw new Error('Unsupported compression in this .docx file.');
      out[name] = new TextDecoder().decode(bytes);
    }
    p += 46 + nlen + elen + clen;
  }
  return out;
}

async function inflateRaw(data) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser can\'t open .docx files. Update iOS, or save the outline as a PDF.');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- PDF via the bundled pdf.js ----------

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdfjs/pdf.min.mjs').then(lib => {
      lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

async function pdfBlocks(buf) {
  const lib = await loadPdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    const lines = [];
    let line = null;
    tc.items.forEach(it => {
      if (!('str' in it)) return;
      const size = Math.round((Math.hypot(it.transform[2], it.transform[3]) || it.height || 10) * 2) / 2;
      const y = it.transform[5];
      const x = it.transform[4];
      if (!line || Math.abs(y - line.y) > Math.max(2, size * 0.5)) {
        if (line) lines.push(line);
        line = { y, x, text: '', size, chars: 0, gap: line ? line.y - y : 0 };
      }
      if (it.str) {
        const needsSpace = line.text && !/\s$/.test(line.text) && !/^\s/.test(it.str);
        line.text += (needsSpace ? ' ' : '') + it.str;
        line.size = Math.max(line.size, size);
        line.chars += it.str.length;
      }
    });
    if (line) lines.push(line);
    pages.push(lines.filter(l => l.text.trim()));
  }
  // drop repeated headers/footers and bare page numbers
  const freq = {};
  pages.forEach(ls => new Set(ls.map(l => l.text.trim().toLowerCase())).forEach(t => { freq[t] = (freq[t] || 0) + 1; }));
  const repeated = t => pages.length >= 4 && freq[t.trim().toLowerCase()] > pages.length * 0.5;
  // body font size = size covering the most characters
  const weight = {};
  pages.flat().forEach(l => { weight[l.size] = (weight[l.size] || 0) + l.chars; });
  const body = +Object.keys(weight).sort((a, b) => weight[b] - weight[a])[0] || 10;
  const bigSizes = [...new Set(pages.flat().filter(l => l.size >= body * 1.12 && l.text.length <= 140).map(l => l.size))].sort((a, b) => b - a);
  const blocks = [];
  pages.forEach((ls, i) => {
    ls.forEach(l => {
      const t = l.text.trim();
      if (/^(page\s*)?\d+(\s*of\s*\d+)?$/i.test(t) || repeated(t)) return;
      const words = t.split(/\s+/).length;
      let heading = 0;
      if (l.size >= body * 1.12 && t.length <= 140 && /[A-Za-z]/.test(t)) heading = bigSizes.indexOf(l.size) + 1;
      else if (HEADING_PATTERN.test(t) && words <= 12 && !/[.;,:]$/.test(t)) heading = bigSizes.length + patternLevel(t);
      blocks.push({ text: t, heading, page: i + 1, para: l.gap > l.size * 1.6 });
    });
  });
  return blocks;
}
