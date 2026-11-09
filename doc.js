/* hwp.js 파싱 결과에서 본문 텍스트와 표를 꺼낸다.
   뷰어·대량 변환 등 여러 페이지가 같은 규칙을 쓰도록 여기에 모은다. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HWPDoc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function paraText(p) {
    var s = '';
    (p.content || []).forEach(function (c) {
      if (typeof c.value === 'string') s += c.value;
      else if (c.value === 13) s += '\n';
    });
    return s;
  }

  function isTable(c) {
    return c && typeof c.rowCount === 'number' && c.rowCount > 0 && Array.isArray(c.content);
  }

  function cellText(cell) {
    if (!cell || !cell.items) return '';
    return cell.items.map(paraText).join('\n').replace(/\n+$/, '');
  }

  function tableRows(t) {
    var rows = [];
    for (var r = 0; r < t.content.length; r++) {
      var row = t.content[r] || [], cells = [];
      for (var c = 0; c < row.length; c++) cells.push(cellText(row[c]));
      rows.push(cells);
    }
    return rows;
  }

  // 표 한 개를 텍스트 줄과 표 목록에 넣는다. 셀 안의 중첩 표는 그 행 바로 뒤에 붙인다.
  // 최상위 표만 넣으면 서식 문서(동의서 등)에서 본문 절반이 사라진다.
  function emit(t, lines, out) {
    var rows = tableRows(t);
    out.push({
      rows: rows,
      cols: t.columnCount || (rows[0] ? rows[0].length : 0),
      rowCount: t.rowCount || rows.length
    });
    rows.forEach(function (row, r) {
      var cells = row.map(function (x) { return x.replace(/\n+/g, ' '); });
      if (cells.join('').trim()) lines.push(cells.join('\t'));
      (t.content[r] || []).forEach(function (cell) {
        ((cell && cell.items) || []).forEach(function (p) {
          (p.controls || []).forEach(function (cc) { if (isTable(cc)) emit(cc, lines, out); });
        });
      });
    });
  }

  function extract(doc) {
    var lines = [], tables = [];
    (doc.sections || []).forEach(function (sec) {
      (sec.content || []).forEach(function (p) {
        var t = paraText(p);
        if (t.trim()) lines.push(t.replace(/\n+$/, ''));
        (p.controls || []).forEach(function (c) {
          if (isTable(c)) emit(c, lines, tables);
        });
      });
    });
    return { text: lines.join('\n'), tables: tables };
  }

  function csvCell(s) {
    s = String(s);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function tableToCSV(t) {
    return t.rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  function tableToTSV(t) {
    return t.rows.map(function (r) {
      return r.map(function (c) { return String(c).replace(/\t/g, ' '); }).join('\t');
    }).join('\n');
  }

  return { extract: extract, tableToCSV: tableToCSV, tableToTSV: tableToTSV, paraText: paraText };
});
