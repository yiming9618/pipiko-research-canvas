// The data repo on GitHub, spoken to through its REST API.
// NOT connected yet: nothing in the app creates this until a token is set up.

import { ConflictError, type RemoteSnapshot, type RemoteStore, type RemoteWrite } from './engine'

export type SyncProblemKind = 'token' | 'permission' | 'not_found' | 'network' | 'rate_limit' | 'other'

/** A sync failure, already worded for the person using the notebook. */
export class SyncProblem extends Error {
  readonly kind: SyncProblemKind
  /** What to do about it, one step per line. Empty when just waiting helps. */
  readonly steps: string[]

  constructor(kind: SyncProblemKind, message: string, steps: string[] = []) {
    super(message)
    this.kind = kind
    this.steps = steps
  }
}

const NEW_TOKEN_STEPS = [
  '打开 github.com → 右上角头像 → Settings → Developer settings → Personal access tokens → Fine-grained tokens',
  '点 Generate new token；Expiration 选最长的选项',
  'Repository access 选 Only select repositories，只勾选数据仓库',
  'Permissions → Repository permissions → Contents 选 Read and write',
  '生成后复制令牌，回到这里的"设置 → 同步"粘贴进去',
]

export function explainFailure(status: number, expired: boolean): SyncProblem {
  if (status === 401) {
    return new SyncProblem(
      'token',
      expired
        ? '访问令牌已过期，现在没有在同步。这台设备上的内容都还在。'
        : '访问令牌已失效（可能被撤销或填错了），现在没有在同步。这台设备上的内容都还在。',
      NEW_TOKEN_STEPS,
    )
  }
  if (status === 403) {
    return new SyncProblem(
      'permission',
      '这个令牌没有写入数据仓库的权限，现在没有在同步。这台设备上的内容都还在。',
      NEW_TOKEN_STEPS,
    )
  }
  if (status === 404) {
    return new SyncProblem(
      'not_found',
      '找不到数据仓库：仓库名可能填错了，或者令牌没有被授权访问这个仓库。这台设备上的内容都还在。',
      ['检查"设置 → 同步"里的用户名和仓库名', '确认令牌的 Repository access 里勾选了这个仓库'],
    )
  }
  if (status === 429) {
    return new SyncProblem('rate_limit', '同步太频繁，GitHub 让稍等一下。过几分钟会自动再试。')
  }
  return new SyncProblem('other', `同步没成功（GitHub 返回 ${status}）。过一会儿会自动再试。`)
}

export interface GitHubConfig {
  owner: string
  repo: string
  token: string
  branch?: string
}

interface TreeItem {
  path: string
  type: string
  sha: string
}

export class GitHubRemote implements RemoteStore {
  /** When the token stops working, as reported by GitHub. Null if it never expires or is unknown. */
  tokenExpiresAt: string | null = null
  private readonly base: string
  private readonly branch: string
  private readonly token: string
  private shas = new Map<string, string>()

  constructor(config: GitHubConfig) {
    this.base = `https://api.github.com/repos/${config.owner}/${config.repo}`
    this.branch = config.branch ?? 'main'
    this.token = config.token
  }

  private async call<T>(method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<{ status: number; data: T }> {
    let res: Response
    try {
      res = await fetch(this.base + path, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      })
    } catch {
      throw new SyncProblem('network', '现在连不上网络，联网后会自动同步。这台设备上的内容都还在。')
    }
    const expiry = res.headers.get('github-authentication-token-expiration')
    if (expiry) this.tokenExpiresAt = new Date(expiry.replace(' UTC', 'Z').replace(' ', 'T')).toISOString()
    if (res.ok || okStatuses.includes(res.status)) {
      const data = res.status === 204 ? null : await res.json().catch(() => null)
      return { status: res.status, data: data as T }
    }
    const expired = !!this.tokenExpiresAt && new Date(this.tokenExpiresAt).getTime() < Date.now()
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') throw explainFailure(429, false)
    throw explainFailure(res.status, expired)
  }

  async list(): Promise<RemoteSnapshot> {
    const ref = await this.call<{ object: { sha: string } }>('GET', `/git/ref/heads/${this.branch}`, undefined, [404, 409])
    if (ref.status !== 200) {
      // 404/409 here can mean "empty repo" or "no access": ask about the repo itself to tell them apart.
      await this.call('GET', '')
      this.shas = new Map()
      return { head: null, files: new Map() }
    }
    const head = ref.data.object.sha
    const commit = await this.call<{ tree: { sha: string } }>('GET', `/git/commits/${head}`)
    const tree = await this.call<{ tree: TreeItem[]; truncated: boolean }>(
      'GET',
      `/git/trees/${commit.data.tree.sha}?recursive=1`,
    )
    const files = new Map<string, string>()
    for (const item of tree.data.tree) {
      if (item.type === 'blob') files.set(item.path, item.sha)
    }
    this.shas = files
    return { head, files: new Map(files) }
  }

  async read(path: string, encoding: 'utf-8' | 'base64'): Promise<string> {
    const sha = this.shas.get(path)
    if (!sha) throw new SyncProblem('other', `数据仓库里没有 ${path}`)
    const blob = await this.call<{ content: string }>('GET', `/git/blobs/${sha}`)
    const base64 = blob.data.content.replace(/\s/g, '')
    if (encoding === 'base64') return base64
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }

  async commit(head: string | null, writes: RemoteWrite[], message: string): Promise<RemoteSnapshot> {
    if (head === null) {
      throw new SyncProblem('other', '数据仓库还是空的。请先在 GitHub 上给它加一个 README 文件，再回来同步。', [
        '打开数据仓库的页面，点 "creating a new file" 或 "Add a README"，直接保存',
      ])
    }
    const parent = await this.call<{ tree: { sha: string } }>('GET', `/git/commits/${head}`)
    const tree: { path: string; mode: '100644'; type: 'blob'; sha?: string; content?: string }[] = []
    for (const w of writes) {
      if (w.encoding === 'utf-8') {
        tree.push({ path: w.path, mode: '100644', type: 'blob', content: w.content })
      } else {
        const blob = await this.call<{ sha: string }>('POST', '/git/blobs', { content: w.content, encoding: 'base64' })
        tree.push({ path: w.path, mode: '100644', type: 'blob', sha: blob.data.sha })
      }
    }
    const newTree = await this.call<{ sha: string }>('POST', '/git/trees', { base_tree: parent.data.tree.sha, tree })
    const newCommit = await this.call<{ sha: string }>('POST', '/git/commits', {
      message,
      tree: newTree.data.sha,
      parents: [head],
    })
    // force:false → GitHub refuses if another device committed in the meantime.
    const moved = await this.call('PATCH', `/git/refs/heads/${this.branch}`, { sha: newCommit.data.sha, force: false }, [422])
    if (moved.status === 422) throw new ConflictError()
    return this.list()
  }
}
