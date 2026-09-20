export interface OutlineItem {
  id: string;
  title: string;
}

function headingText(html: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return html.replace(/<[^>]*>/g, '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name: string) => {
    if (!name.startsWith('#')) return entities[name.toLowerCase()] || entity;
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  }).trim();
}

// 在网站页面组装目录，保留 Markdown 内容中的原有锚点
export function buildArticleOutline(html: string): { content: string; items: OutlineItem[] } {
  const usedIds = new Set([...html.matchAll(/(?:^|\s)id\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]));
  const items: OutlineItem[] = [];
  let sequence = 0;
  const content = html.replace(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi, (heading, attrs: string, body: string) => {
    const title = headingText(body);
    if (!title) return heading;
    const existing = attrs.match(/(?:^|\s)id\s*=\s*["']([^"']+)["']/i);
    let id = existing?.[1];
    if (!id) {
      do { id = `article-section-${++sequence}`; } while (usedIds.has(id));
      usedIds.add(id);
    }
    items.push({ id, title });
    return existing ? heading : `<h2${attrs} id="${id}">${body}</h2>`;
  });
  return { content, items };
}
