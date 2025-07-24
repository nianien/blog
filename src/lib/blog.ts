import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';
import { BlogPost, NavigationInfo, BlogPostWithNavigation } from '@/types/blog';

const postsDirectory = path.join(process.cwd(), 'src/content/blog');

// 递归读取目录中的所有markdown文件
function getAllMarkdownFiles(dir: string, baseDir: string = dir): Array<{ filePath: string; slug: string }> {
  const files: Array<{ filePath: string; slug: string }> = [];
  
  function readDirRecursively(currentDir: string) {
    const items = fs.readdirSync(currentDir);
    
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        // 递归读取子目录
        readDirRecursively(fullPath);
      } else if (item.endsWith('.md')) {
        // 计算相对于baseDir的路径作为slug
        const relativePath = path.relative(baseDir, fullPath);
        const slug = relativePath.replace(/\.md$/, '').replace(/\\/g, '/'); // 确保使用正斜杠
        
        // 直接使用原始文件名，不做拼音转换
        files.push({ filePath: fullPath, slug });
      }
    }
  }
  
  readDirRecursively(dir);
  return files;
}

// 处理 Markdown 内容
function processMarkdownContent(content: string): string {
  // 使用 marked 将 Markdown 转换为 HTML
  marked.setOptions({
    breaks: true,
    gfm: true,
  });
  
  const result = marked(content);
  return typeof result === 'string' ? result : String(result);
}

// 按日期和标题排序的辅助函数
function sortByDateAndTitle(a: BlogPost, b: BlogPost): number {
  // 首先按日期排序（降序）
  const dateComparison = new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime();
  if (dateComparison !== 0) {
    return dateComparison;
  }
  // 如果日期相同，按标题排序
  return a.title.localeCompare(b.title);
}

export function getAllPosts(): BlogPost[] {
  const markdownFiles = getAllMarkdownFiles(postsDirectory);
  
  const allPostsData = markdownFiles.map(({ filePath, slug }) => {
    const fileContents = fs.readFileSync(filePath, 'utf8');
    const { data, content } = matter(fileContents);

    return {
      slug,
      title: data.title,
      description: data.description,
      pubDate: typeof data.pubDate === 'string' ? data.pubDate : data.pubDate?.toISOString?.()?.split('T')[0] || '2024-01-01',
      tags: data.tags || [],
      heroImage: data.heroImage,
      content: processMarkdownContent(content),
    };
  });

  return allPostsData.sort(sortByDateAndTitle);
}

export function getPostBySlug(slug: string): BlogPost | null {
  try {
    // 解码URL，处理中文路径
    const decodedSlug = decodeURIComponent(slug);
    
    // 直接搜索所有markdown文件
    const markdownFiles = getAllMarkdownFiles(postsDirectory);
    
    // 尝试精确匹配
    const foundFile = markdownFiles.find(file => file.slug === decodedSlug);
    
    if (!foundFile) {
      return null;
    }
    
    const fileContents = fs.readFileSync(foundFile.filePath, 'utf8');
    const { data, content } = matter(fileContents);

    return {
      slug: decodedSlug,
      title: data.title,
      description: data.description,
      pubDate: typeof data.pubDate === 'string' ? data.pubDate : data.pubDate?.toISOString?.()?.split('T')[0] || '2024-01-01',
      tags: data.tags || [],
      heroImage: data.heroImage,
      content: processMarkdownContent(content),
    };
  } catch (error) {
    console.error(`Error reading post ${slug}:`, error);
    return null;
  }
}

export function getAllTags(): string[] {
  const posts = getAllPosts();
  const tags = posts.flatMap((post) => post.tags || []);
  return [...new Set(tags)];
}

export function getPostsByTag(tag: string): BlogPost[] {
  const posts = getAllPosts();
  return posts.filter((post) => post.tags?.includes(tag));
}

// 计算标签上下文感知的导航
export function getPostWithNavigation(slug: string): BlogPostWithNavigation | null {
  const decodedSlug = decodeURIComponent(slug);
  const allPosts = getAllPosts();
  
  const currentPost = allPosts.find(p => p.slug === decodedSlug);
  if (!currentPost) {
    return null;
  }

  // 构建：所有标签的文章映射表
  const postsByTag: Record<string, BlogPost[]> = {};
  for (const tag of currentPost.tags || []) {
    postsByTag[tag] = allPosts
      .filter(p => p.tags?.includes(tag))
      .sort(sortByDateAndTitle);
  }

  // 全局排序（用于无标签访问）
  const allSorted = [...allPosts].sort(sortByDateAndTitle);
  const globalIndex = allSorted.findIndex(p => p.slug === decodedSlug);

  // 构造每个标签的导航信息
  const tagNav: Record<string, NavigationInfo> = {};
  for (const [tag, posts] of Object.entries(postsByTag)) {
    const index = posts.findIndex(p => p.slug === decodedSlug);
    if (index !== -1) {
      tagNav[tag] = {
        prev: index < posts.length - 1 ? posts[index + 1] : null,
        next: index > 0 ? posts[index - 1] : null,
      };
    }
  }

  // 全局导航
  const globalNav: NavigationInfo = {
    prev: globalIndex < allSorted.length - 1 ? allSorted[globalIndex + 1] : null,
    next: globalIndex > 0 ? allSorted[globalIndex - 1] : null,
  };

  return {
    post: currentPost,
    globalNav,
    tagNav,
  };
}

// 保持向后兼容的旧函数
export function getAdjacentPosts(slug: string): {
  previous: BlogPost | null;
  next: BlogPost | null;
} {
  const result = getPostWithNavigation(slug);
  if (!result) {
    return { previous: null, next: null };
  }
  
  return {
    previous: result.globalNav.prev,
    next: result.globalNav.next,
  };
} 