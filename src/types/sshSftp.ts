/** SSH/SFTP 文件传输仅使用认证与文件子系统，不开放远程 Shell。 */
export type SshAuthMethod = 'password' | 'privateKey'

export interface SshSftpProfile {
  host: string
  port: number
  username: string
  authMethod: SshAuthMethod
  /** 可留空以尝试空密码认证；仅在当前页面内存中使用，绝不写入本地存储。 */
  password?: string
  privateKeyPath?: string
  /** 仅在当前页面内存中使用，绝不写入本地存储。 */
  passphrase?: string
  timeoutMs: number
}

export interface SshConnectionProbe {
  state: 'ready' | 'host_key_untrusted'
  fingerprint: string
  remoteHome?: string
  message: string
}

export type SshRemoteEntryType = 'directory' | 'file' | 'other'

export interface SshRemoteEntry {
  name: string
  path: string
  entryType: SshRemoteEntryType
  size?: number
  modifiedAt?: number
}

export interface SshDirectoryListing {
  path: string
  entries: SshRemoteEntry[]
  truncated: boolean
}

export interface SshTransferResult {
  operation: 'upload' | 'download'
  files: number
  bytes: number
  remotePath: string
  localPath?: string
  message: string
}
