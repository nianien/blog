interface GitHubComment {
  id: number;
  user: {
    login: string;
    avatar_url: string;
  };
  body: string;
  created_at: string;
  updated_at: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  comments: number;
}

export class GitHubAPI {
  private token: string;
  private owner: string;
  private repo: string;

  constructor(token: string, owner: string, repo: string) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
  }

  // 创建新的 Issue
  async createIssue(title: string, body: string): Promise<GitHubIssue> {
    const response = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/issues`,
      {
        method: 'POST',
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          body,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('GitHub token is invalid or expired. Please check your token.');
      } else if (response.status === 403) {
        throw new Error('Access denied. Please check your token permissions.');
      } else if (response.status === 422) {
        throw new Error('Invalid issue data. Please check the title and body.');
      } else {
        throw new Error(`Failed to create issue: ${response.status} ${response.statusText}`);
      }
    }

    return response.json();
  }

  // 获取所有 Issues
  async getIssues(): Promise<GitHubIssue[]> {
    const response = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/issues`,
      {
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('GitHub token is invalid or expired. Please check your token.');
      } else if (response.status === 403) {
        throw new Error('Access denied. Please check your token permissions.');
      } else {
        throw new Error(`Failed to fetch issues: ${response.status} ${response.statusText}`);
      }
    }

    return response.json();
  }

  // 获取 Issue 的评论列表
  async getComments(issueNumber: number): Promise<GitHubComment[]> {
    const response = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/issues/${issueNumber}/comments`,
      {
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Issue #${issueNumber} not found. Please check if the issue exists.`);
      } else if (response.status === 401) {
        throw new Error('GitHub token is invalid or expired. Please check your token.');
      } else if (response.status === 403) {
        throw new Error('Access denied. Please check your token permissions.');
      } else {
        throw new Error(`Failed to fetch comments: ${response.status} ${response.statusText}`);
      }
    }

    return response.json();
  }

  // 删除评论
  async deleteComment(commentId: number): Promise<void> {
    const response = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/issues/comments/${commentId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to delete comment: ${response.statusText}`);
    }
  }

  // 获取 Issue 信息
  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    const response = await fetch(
      `https://api.github.com/repos/${this.owner}/${this.repo}/issues/${issueNumber}`,
      {
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch issue: ${response.statusText}`);
    }

    return response.json();
  }

  // 检查用户是否有删除评论的权限
  async canDeleteComment(commentId: number, currentUser: string): Promise<boolean> {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${this.owner}/${this.repo}/issues/comments/${commentId}`,
        {
          headers: {
            'Authorization': `token ${this.token}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        }
      );

      if (!response.ok) {
        return false;
      }

      const comment = await response.json();
      
      // 评论作者可以删除自己的评论
      if (comment.user.login === currentUser) {
        return true;
      }

      // 检查当前用户是否是仓库管理员
      const userResponse = await fetch(
        `https://api.github.com/repos/${this.owner}/${this.repo}/collaborators/${currentUser}`,
        {
          headers: {
            'Authorization': `token ${this.token}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        }
      );

      if (userResponse.ok) {
        const userData = await userResponse.json();
        return userData.permissions.admin || userData.permissions.push;
      }

      return false;
    } catch (error) {
      console.error('Error checking delete permission:', error);
      return false;
    }
  }
}

// 创建 GitHub API 实例的工厂函数
export function createGitHubAPI(token: string, owner: string, repo: string): GitHubAPI {
  return new GitHubAPI(token, owner, repo);
} 