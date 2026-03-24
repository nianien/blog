/**
 * 微信公众号内联样式配置
 * 微信编辑器只支持内联 style，不支持 class / id / 外部 CSS
 */

// 主题色
const PRIMARY = '#1a73e8'
const PRIMARY_LIGHT = '#e8f0fe'
const CODE_BG = '#1e1e1e'
const CODE_TEXT = '#d4d4d4'
const BORDER_COLOR = '#e5e7eb'
const TEXT_COLOR = '#333'
const TEXT_SECONDARY = '#666'
const BLOCKQUOTE_BG = '#f9fafb'

export const wxStyles: Record<string, string> = {
  // 全局容器
  wrapper: `
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 16px;
    color: ${TEXT_COLOR};
    line-height: 1.8;
    word-wrap: break-word;
    word-break: break-all;
  `,

  // 标题
  h1: `
    font-size: 24px;
    font-weight: bold;
    color: ${TEXT_COLOR};
    margin: 32px 0 16px 0;
    padding-bottom: 8px;
    border-bottom: 2px solid ${PRIMARY};
  `,
  h2: `
    font-size: 20px;
    font-weight: bold;
    color: ${TEXT_COLOR};
    margin: 28px 0 14px 0;
    padding-left: 12px;
    border-left: 4px solid ${PRIMARY};
  `,
  h3: `
    font-size: 18px;
    font-weight: bold;
    color: ${TEXT_COLOR};
    margin: 24px 0 12px 0;
    padding-left: 10px;
    border-left: 3px solid ${PRIMARY_LIGHT};
  `,
  h4: `
    font-size: 16px;
    font-weight: bold;
    color: ${TEXT_SECONDARY};
    margin: 20px 0 10px 0;
  `,

  // 段落
  p: `
    font-size: 16px;
    color: ${TEXT_COLOR};
    line-height: 1.8;
    margin: 12px 0;
  `,

  // 引用块
  blockquote: `
    margin: 16px 0;
    padding: 12px 16px;
    background: ${BLOCKQUOTE_BG};
    border-left: 4px solid ${PRIMARY};
    color: ${TEXT_SECONDARY};
    font-size: 15px;
    line-height: 1.7;
  `,

  // 代码块（pre > code）
  pre: `
    margin: 16px 0;
    padding: 16px;
    background: ${CODE_BG};
    color: ${CODE_TEXT};
    border-radius: 6px;
    overflow-x: auto;
    font-size: 14px;
    line-height: 1.6;
    -webkit-overflow-scrolling: touch;
  `,
  code: `
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
    font-size: 14px;
  `,
  // 行内代码
  codeInline: `
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
    font-size: 14px;
    background: #f3f4f6;
    color: #e74c3c;
    padding: 2px 6px;
    border-radius: 3px;
  `,

  // 表格
  table: `
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
    font-size: 14px;
    line-height: 1.6;
  `,
  th: `
    background: ${PRIMARY};
    color: #fff;
    font-weight: bold;
    padding: 10px 12px;
    border: 1px solid ${PRIMARY};
    text-align: left;
  `,
  td: `
    padding: 8px 12px;
    border: 1px solid ${BORDER_COLOR};
    vertical-align: top;
  `,
  tr_even: `
    background: #f9fafb;
  `,

  // 列表
  ul: `
    margin: 12px 0;
    padding-left: 24px;
    list-style-type: disc;
  `,
  ol: `
    margin: 12px 0;
    padding-left: 24px;
    list-style-type: decimal;
  `,
  li: `
    font-size: 16px;
    line-height: 1.8;
    margin: 4px 0;
    color: ${TEXT_COLOR};
  `,

  // 强调
  strong: `
    font-weight: bold;
    color: ${TEXT_COLOR};
  `,
  em: `
    font-style: italic;
  `,

  // 链接
  a: `
    color: ${PRIMARY};
    text-decoration: none;
    word-break: break-all;
  `,

  // 图片
  img: `
    max-width: 100%;
    height: auto;
    display: block;
    margin: 16px auto;
    border-radius: 4px;
  `,

  // 分割线
  hr: `
    border: none;
    border-top: 1px solid ${BORDER_COLOR};
    margin: 24px 0;
  `,

  // 删除线
  del: `
    text-decoration: line-through;
    color: ${TEXT_SECONDARY};
  `,
}

/** 将样式字符串格式化为单行（去除换行和多余空格） */
export function normalizeStyle(style: string): string {
  return style.replace(/\s+/g, ' ').trim()
}
