import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';
import { BlogPost } from '@/types/blog';

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

// 处理 Markdown 内容，为代码块添加语法高亮，并支持图片CSS类
function processMarkdownContent(content: string): string {
  // 使用 marked 处理 Markdown，保持代码块的原始格式
  let result = marked(content);
  result = typeof result === 'string' ? result : String(result);
  
  // 处理图片的CSS类语法 {: .class}
  result = result.replace(
    /<img([^>]+)>\s*\{:\s*\.([^}]+)\}/g,
    '<img$1 class="$2">'
  );
  
  return result;
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

  return allPostsData.sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1));
}

export function getPostBySlug(slug: string): BlogPost | null {
  try {
    // 解码URL，处理中文路径
    const decodedSlug = decodeURIComponent(slug);
    
    // 直接搜索所有markdown文件
    const markdownFiles = getAllMarkdownFiles(postsDirectory);
    
    // 尝试精确匹配
    let foundFile = markdownFiles.find(file => file.slug === decodedSlug);
    
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

export function getAdjacentPosts(slug: string, selectedTag?: string): {
  previous: BlogPost | null;
  next: BlogPost | null;
} {
  // 解码URL，处理中文路径
  const decodedSlug = decodeURIComponent(slug);
  
  const posts = getAllPosts();
  const currentPost = posts.find((post) => post.slug === decodedSlug);
  
  if (!currentPost) {
    return { previous: null, next: null };
  }

  // 如果提供了选定的标签，则基于该标签进行导航
  if (selectedTag) {
    const postsWithSelectedTag = posts.filter((post) => {
      return post.tags && post.tags.includes(selectedTag);
    }).sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1));

    const currentIndex = postsWithSelectedTag.findIndex((post) => post.slug === decodedSlug);
    
    if (currentIndex === -1) {
      return { previous: null, next: null };
    }

    const previous = currentIndex < postsWithSelectedTag.length - 1 ? postsWithSelectedTag[currentIndex + 1] : null;
    const next = currentIndex > 0 ? postsWithSelectedTag[currentIndex - 1] : null;

    return { previous, next };
  }

  // 获取当前文章的所有标签
  const currentTags = currentPost.tags || [];
  
  // 如果当前文章没有标签，则使用所有文章
  if (currentTags.length === 0) {
    const currentIndex = posts.findIndex((post) => post.slug === decodedSlug);
    if (currentIndex === -1) {
      return { previous: null, next: null };
    }
    
    const previous = currentIndex < posts.length - 1 ? posts[currentIndex + 1] : null;
    const next = currentIndex > 0 ? posts[currentIndex - 1] : null;
    return { previous, next };
  }

  // 筛选出与当前文章有相同标签的文章
  const postsWithSameTags = posts.filter((post) => {
    if (!post.tags || post.tags.length === 0) return false;
    // 检查是否有至少一个相同的标签
    return post.tags.some(tag => currentTags.includes(tag));
  }).sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1)); // 按日期排序

  // 在相同标签的文章中找到当前文章的索引
  const currentIndex = postsWithSameTags.findIndex((post) => post.slug === decodedSlug);
  
  if (currentIndex === -1) {
    return { previous: null, next: null };
  }

  // 获取上一篇和下一篇（基于相同标签的文章）
  const previous = currentIndex < postsWithSameTags.length - 1 ? postsWithSameTags[currentIndex + 1] : null;
  const next = currentIndex > 0 ? postsWithSameTags[currentIndex - 1] : null;

  return { previous, next };
} 