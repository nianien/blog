#!/usr/bin/env python3
"""
GitHub Pages 模拟服务器
模拟 GitHub Pages 的 /gitbook/ 前缀环境，支持 SPA fallback
"""

import http.server
import socketserver
import os
import urllib.parse
from pathlib import Path

# 配置
PORT = 8080
BASE_PATH = "/gitbook"
STATIC_DIR = "out"

class GitHubPagesHandler(http.server.SimpleHTTPRequestHandler):
    def do_HEAD(self):
        self.do_GET(head_only=True)

    def do_GET(self, head_only=False):
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path
        
        # 处理 /gitbook/ 路径
        if path.startswith(BASE_PATH):
            # 移除 /gitbook 前缀，获取相对路径
            rel_path = path[len(BASE_PATH):]
            if rel_path == "" or rel_path == "/":
                rel_path = "/index.html"
            
            # 特殊处理 _next/static 路径
            if rel_path.startswith("/_next/static/"):
                # 直接映射到 out/_next/static/
                file_path = os.path.join(STATIC_DIR, rel_path.lstrip("/"))
            else:
                # 其他路径映射到 out/gitbook/
                file_path = os.path.join(STATIC_DIR, "gitbook", rel_path.lstrip("/"))
            
            print(f"DEBUG: 请求路径: {path}, 映射到: {file_path}")
            
            # 检查文件是否存在
            if os.path.exists(file_path) and os.path.isfile(file_path):
                self.send_response(200)
                # 设置正确的 Content-Type
                if file_path.endswith('.css'):
                    self.send_header('Content-Type', 'text/css')
                elif file_path.endswith('.js'):
                    self.send_header('Content-Type', 'application/javascript')
                elif file_path.endswith('.woff2'):
                    self.send_header('Content-Type', 'font/woff2')
                elif file_path.endswith('.svg'):
                    self.send_header('Content-Type', 'image/svg+xml')
                elif file_path.endswith('.ico'):
                    self.send_header('Content-Type', 'image/x-icon')
                else:
                    self.send_header('Content-Type', 'text/html')
                self.end_headers()
                if not head_only:
                    with open(file_path, 'rb') as f:
                        self.wfile.write(f.read())
            else:
                # 文件不存在，fallback 到 index.html（SPA 路由）
                index_path = os.path.join(STATIC_DIR, "gitbook", "index.html")
                print(f"DEBUG: 文件不存在，fallback 到: {index_path}")
                if os.path.exists(index_path):
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html')
                    self.end_headers()
                    if not head_only:
                        with open(index_path, 'rb') as f:
                            self.wfile.write(f.read())
                else:
                    print(f"DEBUG: index.html 也不存在")
                    self.send_error(404, "File not found")
        else:
            # 不是 /gitbook/ 路径，重定向
            self.send_response(302)
            self.send_header('Location', f'{BASE_PATH}{path}')
            self.end_headers()

def main():
    print("🚀 GitHub Pages 模拟服务器启动")
    print(f"📁 静态文件目录: {os.path.abspath(STATIC_DIR)}")
    print(f"🌐 访问地址: http://localhost:{PORT}{BASE_PATH}/")
    print(f"📝 模拟 GitHub Pages: https://用户名.github.io{BASE_PATH}/")
    print("⏹️  按 Ctrl+C 停止服务器")
    print("-" * 50)
    
    # 确保静态目录存在
    if not os.path.exists(STATIC_DIR):
        print(f"❌ 错误: 静态目录 {STATIC_DIR} 不存在")
        return
    
    # 创建服务器
    handler = GitHubPagesHandler
    handler.directory = STATIC_DIR
    
    with socketserver.TCPServer(("", PORT), handler) as httpd:
        print(f"✅ 服务器已启动，监听端口 {PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n⏹️  服务器已停止")

if __name__ == "__main__":
    main() 