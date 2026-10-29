/* 최소 XLSX 생성기 — 외부 라이브러리 없이 브라우저에서 .xlsx를 만든다.
   ZIP은 무압축(stored) 방식이라 deflate 구현이 필요 없고, 텍스트는 inlineStr로 넣어
   sharedStrings 파트를 생략한다. 표 데이터 용도로는 이 정도면 충분하다. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HWPXlsx = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CRC = (function () {
    var t = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();

  function crc32(b) {
    var c = -1;
    for (var i = 0; i < b.length; i++) c = (c >>> 8) ^ CRC[(c ^ b[i]) & 0xFF];
    return (c ^ -1) >>> 0;
  }

  var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  function bytesOf(s) {
    if (enc) return enc.encode(s);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
    return out;
  }

  function zip(files) {
    var parts = [], central = [], offset = 0;
    files.forEach(function (f) {
      var name = bytesOf(f.name), data = f.data, crc = crc32(data);
      var lh = new Uint8Array(30 + name.length), d1 = new DataView(lh.buffer);
      d1.setUint32(0, 0x04034b50, true);
      d1.setUint16(4, 20, true);
      d1.setUint16(6, 0x0800, true);   // 파일명 UTF-8
      d1.setUint16(8, 0, true);        // stored
      d1.setUint16(10, 0, true);
      d1.setUint16(12, 0x21, true);    // 1980-01-01 (고정값)
      d1.setUint32(14, crc, true);
      d1.setUint32(18, data.length, true);
      d1.setUint32(22, data.length, true);
      d1.setUint16(26, name.length, true);
      d1.setUint16(28, 0, true);
      lh.set(name, 30);

      var cd = new Uint8Array(46 + name.length), d2 = new DataView(cd.buffer);
      d2.setUint32(0, 0x02014b50, true);
      d2.setUint16(4, 20, true);
      d2.setUint16(6, 20, true);
      d2.setUint16(8, 0x0800, true);
      d2.setUint16(10, 0, true);
      d2.setUint16(12, 0, true);
      d2.setUint16(14, 0x21, true);
      d2.setUint32(16, crc, true);
      d2.setUint32(20, data.length, true);
      d2.setUint32(24, data.length, true);
      d2.setUint16(28, name.length, true);
      d2.setUint32(42, offset, true);
      cd.set(name, 46);

      parts.push(lh, data);
      central.push(cd);
      offset += lh.length + data.length;
    });

    var cdSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var eocd = new Uint8Array(22), d3 = new DataView(eocd.buffer);
    d3.setUint32(0, 0x06054b50, true);
    d3.setUint16(8, files.length, true);
    d3.setUint16(10, files.length, true);
    d3.setUint32(12, cdSize, true);
    d3.setUint32(16, offset, true);

    var all = parts.concat(central, [eocd]);
    var total = all.reduce(function (a, c) { return a + c.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // XML 1.0에서 허용되지 않는 제어문자는 제거한다. 없으면 엑셀이 파일을 거부한다.
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function colName(i) {
    var s = '';
    i += 1;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; }
    return s;
  }

  function sheetName(name, idx, used) {
    var n = String(name || 'Sheet' + (idx + 1)).replace(/[\[\]:*?\/\\]/g, ' ').replace(/^'+|'+$/g, '').trim();
    if (!n) n = 'Sheet' + (idx + 1);
    n = n.slice(0, 31);
    var base = n, k = 2;
    while (used[n]) { n = (base.slice(0, 28) + '(' + k++ + ')'); }
    used[n] = true;
    return n;
  }

  function sheetXml(rows) {
    var body = rows.map(function (row, ri) {
      var cells = (row || []).map(function (v, ci) {
        var ref = colName(ci) + (ri + 1);
        if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'number' && isFinite(v)) {
          return '<c r="' + ref + '" s="1"><v>' + v + '</v></c>';
        }
        return '<c r="' + ref + '" s="1" t="inlineStr"><is><t xml:space="preserve">' +
          esc(v) + '</t></is></c>';
      }).join('');
      return cells ? '<row r="' + (ri + 1) + '">' + cells + '</row>' : '';
    }).join('');

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' + body + '</sheetData></worksheet>';
  }

  var STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="1"><font><sz val="11"/><name val="맑은 고딕"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">' +
    '<alignment vertical="top" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function build(sheets) {
    var used = {}, n = sheets.length, ns = 'http://schemas.openxmlformats.org/';
    var content =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ' +
          'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';

    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="' + ns + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="' + ns + 'officeDocument/2006/relationships"><sheets>' +
      sheets.map(function (s, i) {
        return '<sheet name="' + esc(sheetName(s.name, i, used)) + '" sheetId="' + (i + 1) +
          '" r:id="rId' + (i + 1) + '"/>';
      }).join('') + '</sheets></workbook>';

    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Type="' + ns +
          'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rId' + (n + 1) + '" Type="' + ns +
      'officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    var files = [
      { name: '[Content_Types].xml', data: bytesOf(content) },
      { name: '_rels/.rels', data: bytesOf(rels) },
      { name: 'xl/workbook.xml', data: bytesOf(wb) },
      { name: 'xl/_rels/workbook.xml.rels', data: bytesOf(wbRels) },
      { name: 'xl/styles.xml', data: bytesOf(STYLES) }
    ];
    sheets.forEach(function (s, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: bytesOf(sheetXml(s.rows || [])) });
    });
    return zip(files);
  }

  return { build: build };
});
