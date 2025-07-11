import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
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
        files.push({ filePath: fullPath, slug });
      }
    }
  }
  
  readDirRecursively(dir);
  return files;
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
        content,
      };
    });

  return allPostsData.sort((a, b) => (a.pubDate < b.pubDate ? 1 : -1));
}

export function getPostBySlug(slug: string): BlogPost | null {
  try {
    // 尝试直接路径
    let fullPath = path.join(postsDirectory, `${slug}.md`);
    
    // 如果直接路径不存在，搜索所有markdown文件
    if (!fs.existsSync(fullPath)) {
      const markdownFiles = getAllMarkdownFiles(postsDirectory);
      const foundFile = markdownFiles.find(file => file.slug === slug);
      if (!foundFile) return null;
      fullPath = foundFile.filePath;
    }
    
    const fileContents = fs.readFileSync(fullPath, 'utf8');
    const { data, content } = matter(fileContents);

    return {
      slug,
      title: data.title,
      description: data.description,
      pubDate: typeof data.pubDate === 'string' ? data.pubDate : data.pubDate?.toISOString?.()?.split('T')[0] || '2024-01-01',
      tags: data.tags || [],
      heroImage: data.heroImage,
      content,
    };
  } catch {
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

export function getAdjacentPosts(slug: string): {
  previous: BlogPost | null;
  next: BlogPost | null;
} {
  const posts = getAllPosts();
  const currentIndex = posts.findIndex((post) => post.slug === slug);
  
  if (currentIndex === -1) {
    return { previous: null, next: null };
  }

  const previous = currentIndex < posts.length - 1 ? posts[currentIndex + 1] : null;
  const next = currentIndex > 0 ? posts[currentIndex - 1] : null;

  return { previous, next };
} 