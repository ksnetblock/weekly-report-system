// 주간보고 → DOCX 생성/다운로드 (브라우저에서 직접, reference/docx_method.md 방식)
// Tiptap 이 만든 HTML 을 DOMParser 로 파싱해 docx 문단/목록으로 매핑한다.
import {
  AlignmentType, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun,
} from 'docx'
import { saveAs } from 'file-saver'

const OL_REF = 'weekly-ol' // 번호 목록 numbering 참조 이름
// 문서 전체 기본 글꼴. DOCX는 폰트 파일을 내장하지 않고 이름만 참조하므로,
// 여는 PC에 Pretendard가 없으면 Word가 대체 글꼴(맑은 고딕 등)로 표시함.
// Pretendard 를 설치하면 굵기별로 별도 패밀리 이름이 등록되므로(예: 'Pretendard SemiBold'),
// 굵기는 bold 속성이 아니라 이 이름으로 지정한다.
const FONT = 'Pretendard' // 본문
const FONT_TITLE = 'Pretendard ExtraBold' // 대제목(Title)
const FONT_HEADING = 'Pretendard SemiBold' // 제목(Heading 1~6)

// 인라인 노드 → TextRun[] (bold/italic/underline/strike 마크 상속)
function runsFromInline(node, marks = {}) {
  const out = []
  node.childNodes.forEach((child) => {
    if (child.nodeType === 3) { // 텍스트
      const text = child.textContent
      // size 는 지정하지 않음 → 문단 스타일(제목: 크게, 본문: docDefaults 11pt)을 상속
      if (text) out.push(new TextRun({ text, ...marks }))
      return
    }
    if (child.nodeType !== 1) return
    const tag = child.tagName.toLowerCase()
    if (tag === 'br') { out.push(new TextRun({ break: 1 })); return }
    const next = { ...marks }
    if (tag === 'strong' || tag === 'b') next.bold = true
    if (tag === 'em' || tag === 'i') next.italics = true
    if (tag === 'u') next.underline = {}
    if (tag === 's' || tag === 'del' || tag === 'strike') next.strike = true
    if (tag === 'code') next.font = 'Consolas'
    out.push(...runsFromInline(child, next))
  })
  return out
}

// li 하나의 "직접 인라인" 만 모은다 (중첩 리스트는 별도 처리)
function runsFromListItem(li) {
  const clone = li.cloneNode(true)
  clone.querySelectorAll('ul, ol').forEach((n) => n.remove())
  return runsFromInline(clone)
}

// 블록 요소 → Paragraph[] (list 는 level 로 들여쓰기 재귀)
function blocksFromElement(el, level = 0) {
  const paras = []
  el.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      const t = node.textContent.trim()
      if (t) paras.push(new Paragraph({ children: [new TextRun({ text: t })] }))
      return
    }
    if (node.nodeType !== 1) return
    const tag = node.tagName.toLowerCase()
    switch (tag) {
      case 'h1':
        paras.push(new Paragraph({ children: runsFromInline(node), heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 60 } }))
        break
      case 'h2':
        paras.push(new Paragraph({ children: runsFromInline(node), heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 60 } }))
        break
      case 'h3':
        paras.push(new Paragraph({ children: runsFromInline(node), heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 40 } }))
        break
      case 'p':
        paras.push(new Paragraph({ children: runsFromInline(node), spacing: { after: 40 } }))
        break
      case 'blockquote':
        paras.push(new Paragraph({ children: runsFromInline(node), indent: { left: 480 }, spacing: { after: 40 }, border: { left: { style: 'single', size: 12, space: 8, color: 'CBD5E1' } } }))
        break
      case 'ul':
      case 'ol':
        node.querySelectorAll(':scope > li').forEach((li) => {
          const listProps = tag === 'ol' ? { numbering: { reference: OL_REF, level } } : { bullet: { level } }
          paras.push(new Paragraph({ children: runsFromListItem(li), spacing: { after: 20 }, ...listProps }))
          // 중첩 리스트: 한 단계 들여써서 재귀
          li.querySelectorAll(':scope > ul, :scope > ol').forEach((sub) => {
            paras.push(...blocksFromElement(wrap(sub), level + 1))
          })
        })
        break
      default:
        // 알 수 없는 블록: 인라인으로 처리
        paras.push(new Paragraph({ children: runsFromInline(node), spacing: { after: 40 } }))
    }
  })
  return paras
}

// 단일 요소를 <div>로 감싸 blocksFromElement 가 자식으로 순회하게 한다 (중첩 리스트 재귀용)
function wrap(el) {
  const div = el.ownerDocument.createElement('div')
  div.appendChild(el.cloneNode(true))
  return div
}

// content: { title, report_date, html }
export async function exportReportDocx(content) {
  const title = content.title?.trim() || '주간보고'
  const children = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
  ]

  const doc = new DOMParser().parseFromString(content.html || '<p></p>', 'text/html')
  children.push(...blocksFromElement(doc.body))

  const document = new Document({
    // 기본 run 글꼴을 Pretendard로 지정. Title/Heading 은 테마의 "제목용 글꼴"(맑은 고딕)을
    // 참조하므로 스타일마다 font 를 명시해 덮어씀.
    // 주의: docx 는 사용자 옵션으로 기본 스타일의 run 객체를 "통째로" 교체하므로,
    // font 만 넣으면 기본 크기·색상이 사라진다 → 라이브러리 기본값(size/color)을 함께 명시.
    styles: {
      default: {
        document: { run: { font: FONT, size: 20 } }, // 본문 10pt
        title: { run: { font: FONT_TITLE, size: 30 } }, // 15pt, ExtraBold
        heading1: { run: { font: FONT_HEADING, size: 28, color: '2E74B5' } }, // 14pt, SemiBold
        heading2: { run: { font: FONT_HEADING, size: 26, color: '2E74B5' } }, // 13pt, SemiBold
        heading3: { run: { font: FONT_HEADING, size: 24, color: '1F4D78' } }, // 12pt, SemiBold
        heading4: { run: { font: FONT_HEADING, color: '2E74B5', italics: true } },
        heading5: { run: { font: FONT_HEADING, color: '2E74B5' } },
        heading6: { run: { font: FONT_HEADING, color: '1F4D78' } },
      },
    },
    numbering: {
      config: [{
        reference: OL_REF,
        levels: [0, 1, 2, 3].map((lvl) => ({
          level: lvl,
          format: LevelFormat.DECIMAL,
          text: `%${lvl + 1}.`,
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 480 * (lvl + 1), hanging: 260 } } },
        })),
      }],
    },
    sections: [{ children }],
  })

  const blob = await Packer.toBlob(document)
  saveAs(blob, `${title}.docx`)
}
