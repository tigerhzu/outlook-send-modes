/** Stabilize only our editable template, never an existing message or signature. */
export function stabilizeTemplateTables(root: HTMLElement): void {
  root.querySelectorAll('table').forEach(table => {
    table.style.tableLayout = 'fixed';
    if (!table.style.width) table.style.width = table.getAttribute('width')?.match(/^\d+$/)
      ? `${table.getAttribute('width')}px` : table.getAttribute('width') || '100%';
    // A merged title row cannot define column widths in the fixed layout algorithm.
    // Copy the first unmerged row's existing widths into explicit columns.
    const rows = Array.from(table.rows);
    const row = rows.find(candidate => Array.from(candidate.cells).every(cell => cell.colSpan === 1 && cell.rowSpan === 1) && candidate.cells.length > 1);
    if (row && !table.querySelector(':scope > colgroup') && !rows.some(candidate => Array.from(candidate.cells).some(cell => cell.rowSpan > 1))) {
      const group = document.createElement('colgroup');
      Array.from(row.cells).forEach(cell => {
        const col = document.createElement('col');
        const width = cell.style.width || cell.getAttribute('width');
        if (width) {
          col.style.width = /^\d+$/.test(width) ? `${width}px` : width;
          col.setAttribute('width', width.replace(/px$/, ''));
        }
        group.appendChild(col);
      });
      table.prepend(group);
    }
  });
  root.querySelectorAll<HTMLElement>('td, th').forEach(cell => {
    cell.style.wordWrap = 'break-word';
    cell.style.overflowWrap = 'anywhere';
    // Empty editable cells need a caret anchor so typing stays inside the cell.
    if (!cell.hasChildNodes()) cell.appendChild(document.createElement('br'));
  });
}
