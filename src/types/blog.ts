export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  pubDate: string;
  tags?: string[];
  heroImage?: string;
  content: string;
}

export interface BlogMeta {
  title: string;
  description: string;
  pubDate: string;
  tags?: string[];
  heroImage?: string;
} 