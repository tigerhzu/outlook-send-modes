import { describe,expect,it } from 'vitest';
import { bodyEditEvidence,findManagedBlock,replaceManagedBlock,wrapTemplate } from '../src/body';

describe('managed body boundaries',()=>{
  const token='send-mode-123';
  it('replaces only the exact managed source range, preserving HTML head, signature and history bytes',()=>{
    const prefix='<!DOCTYPE html><html><head><style>.signature {color:red}</style></head><body><p>先前文字 &amp; 符號</p>';
    const suffix='<!--mso--><p class="signature"><img src="cid:logo">簽名</p><blockquote style="color:blue">回覆歷史</blockquote></body></html>';
    const body=prefix+wrapTemplate('<table><tr><td>舊資料</td></tr></table>',token)+suffix;
    const block=findManagedBlock(body,token)!;
    expect(block.text).toContain('舊資料');
    const next=wrapTemplate('<p>新資料</p>',token);
    expect(replaceManagedBlock(body,block,next)).toBe(prefix+next+suffix);
  });
  it('returns null for missing ids and rejects duplicate, malformed or changed boundaries',()=>{
    expect(findManagedBlock('<p>existing</p>',token)).toBeNull();
    expect(()=>findManagedBlock(wrapTemplate('x',token)+wrapTemplate('y',token),token)).toThrow(/重複/);
    expect(()=>findManagedBlock(`<div id="${token}">unterminated`,token)).toThrow(/邊界/);
    expect(()=>findManagedBlock(`<p id="${token}">changed</p>`,token)).toThrow(/邊界/);
  });
  it('rejects tokens that could inject markup',()=>{
    expect(()=>wrapTemplate('safe','bad" onclick="evil')).toThrow();
  });
  it('keeps table layout when an ancestor ID or internal stylesheet is removed by editing',()=>{
    const html=wrapTemplate('<table width="640"><tr><td colspan="2">標題</td></tr><tr><td width="170">欄位</td><td></td></tr></table>',token);
    const doc=new DOMParser().parseFromString(html,'text/html');
    doc.querySelector('div')!.id=`x_${token}`;
    const rules=doc.querySelector('style')!.textContent!;
    expect(rules).not.toContain(`#${token}`);
    expect(rules).toContain(`.x_${token}-format-`);
    doc.querySelector('style')!.remove();
    expect(doc.querySelector('table')!.style.tableLayout).toBe('fixed');
    expect(doc.querySelector('col')!.getAttribute('width')).toBe('170');
    expect(doc.querySelectorAll('td')[2].style.overflowWrap).toBe('anywhere');
    expect(doc.querySelectorAll('td')[2].innerHTML).toBe('<br>');
    expect(findManagedBlock(doc.body.innerHTML,token)).not.toBeNull();
  });
  it('recognizes namespaced ids and class-only markers without broadening the source range',()=>{
    for (const attrs of [`id="x_${token}"`, `id="x_x_${token}"`, `class="other x_${token}"`]) {
      const body=`<p>before</p><div ${attrs}><p>edited</p></div><p>signature</p>`;
      const block=findManagedBlock(body,token)!;
      expect(block.text).toBe('edited');
      expect(replaceManagedBlock(body,block,'NEW')).toBe('<p>before</p>NEW<p>signature</p>');
    }
    expect(findManagedBlock(`<div id="other_${token}">unrelated</div>`,token)).toBeNull();
    expect(()=>findManagedBlock(`<div id="${token}">one</div><div class="x_${token}">two</div>`,token)).toThrow(/重複/);
  });
});

describe('content comparison while only recipient/subject writes remain',()=>{
  it('tolerates host wrappers, serialized whitespace, attribute ordering and formatting',()=>{
    const before='<div id="send-mode-test"><p>Hello world</p><table><tr><td>A B</td><td>C</td></tr></table></div>';
    const after='<html><head><style>.host{color:red}</style></head><body><!--host--><div class="host" id="x_send-mode-test"><p><span style="font-size:14px">Hello\nworld</span></p>\n<table><tbody><tr><td>A&nbsp;B</td><td>C</td></tr></tbody></table></div></body></html>';
    expect(bodyEditEvidence(before)).toBe(bodyEditEvidence(after));
  });
  it.each([
    ['<p>A B</p>','<p>AB</p>'],
    ['<p>A<br>B</p>','<p>A B</p>'],
    ['<img src="cid:one" alt="one">','<img src="cid:two" alt="one">'],
    ['<a href="https://one.test">Link</a>','<a href="https://two.test">Link</a>'],
    ['<table><tr><td>A</td><td>BC</td></tr></table>','<table><tr><td>AB</td><td>C</td></tr></table>'],
    ['<table><tr><td colspan="2">A</td></tr></table>','<table><tr><td>A</td></tr></table>'],
  ])('detects content changes: %s', (before,after)=>{
    expect(bodyEditEvidence(before)).not.toBe(bodyEditEvidence(after));
  });
});
