'use client';

import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeHighlightProps {
  children: string;
  className?: string;
}

const CodeHighlight: React.FC<CodeHighlightProps> = ({ children, className }) => {
  // 从 className 中提取语言
  const language = className?.replace('language-', '') || 'text';
  
  // 去除代码末尾的换行符，避免多余的空行
  const cleanCode = children.replace(/\n$/, '');
  
  return (
    <div className="my-4">
      <SyntaxHighlighter
        language={language}
        style={tomorrow}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          lineHeight: '1.5',
        }}
        showLineNumbers={true}
        wrapLines={true}
      >
        {cleanCode}
      </SyntaxHighlighter>
    </div>
  );
};

export default CodeHighlight;
