'use client';

import React, { useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { createRoot } from 'react-dom/client';

interface SyntaxHighlightedContentProps {
  content: string;
}

const SyntaxHighlightedContent: React.FC<SyntaxHighlightedContentProps> = ({ content }) => {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contentRef.current) return;

    // 查找所有的 pre > code 元素
    const codeBlocks = contentRef.current.querySelectorAll('pre > code');
    
    codeBlocks.forEach((codeBlock) => {
      const pre = codeBlock.parentElement;
      if (!pre) return;
      
      const language = codeBlock.className?.replace('language-', '') || 'text';
      const code = codeBlock.textContent || '';
      
      // 去除代码末尾的换行符，避免多余的空行
      const cleanCode = code.replace(/\n$/, '');
      
      // 创建 React 元素
      const syntaxHighlighter = (
        <SyntaxHighlighter
          language={language}
          style={tomorrow}
          customStyle={{
            margin: 0,
            borderRadius: '0.75rem',
            fontSize: '0.875rem',
            lineHeight: '1.6',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          }}
          showLineNumbers={true}
          wrapLines={true}
        >
          {cleanCode}
        </SyntaxHighlighter>
      );
      
      // 使用 ReactDOM 渲染
      const wrapper = document.createElement('div');
      wrapper.className = 'my-6';
      
      // 使用 createRoot 渲染组件
      const root = createRoot(wrapper);
      root.render(syntaxHighlighter);
      
      pre.parentNode?.replaceChild(wrapper, pre);
    });
  }, [content]);

  return (
    <div 
      ref={contentRef}
      className="prose prose-lg prose-gray mx-auto max-w-none prose-headings:text-gray-900 prose-headings:font-bold prose-p:text-gray-700 prose-p:leading-relaxed prose-a:text-blue-600 prose-a:no-underline hover:prose-a:text-blue-700 prose-strong:text-gray-900 prose-strong:font-semibold prose-blockquote:border-l-4 prose-blockquote:border-blue-500 prose-blockquote:bg-blue-50 prose-blockquote:py-2 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-ul:list-disc prose-ol:list-decimal prose-li:text-gray-700 prose-hr:border-gray-300"
      dangerouslySetInnerHTML={{ __html: content }} 
    />
  );
};

export default SyntaxHighlightedContent; 