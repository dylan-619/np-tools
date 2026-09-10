import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { safeSshDownloadName } from '../utils/sshSftpPaths'
import type {
  SshConnectionProbe,
  SshDirectoryListing,
  SshSftpProfile,
  SshTransferResult,
} from '../types/sshSftp'

/** 通过 Tauri 后端使用 SSH/SFTP；浏览器层不直接持有 Socket。 */
export function sshSftpProbe(profile: SshSftpProfile, trustUnknownHost: boolean) {
  return invoke<SshConnectionProbe>('ssh_sftp_probe', { profile, trustUnknownHost })
}

export function sshSftpListDir(profile: SshSftpProfile, remotePath: string) {
  return invoke<SshDirectoryListing>('ssh_sftp_list_dir', { profile, remotePath })
}

export function sshSftpUpload(
  profile: SshSftpProfile,
  remoteDirectory: string,
  localPaths: string[],
  overwrite: boolean
) {
  return invoke<SshTransferResult>('ssh_sftp_upload', {
    profile,
    remoteDirectory,
    localPaths,
    overwrite,
  })
}

export function sshSftpDownload(profile: SshSftpProfile, remotePath: string, localPath: string) {
  return invoke<SshTransferResult>('ssh_sftp_download', { profile, remotePath, localPath })
}

export async function sshSftpPickLocalFiles(): Promise<string[]> {
  const selected = await open({
    title: '选择要上传的文件（可多选）',
    multiple: true,
    directory: false,
  })
  if (!selected) return []
  return Array.isArray(selected) ? selected : [selected]
}

export function sshSftpPickLocalDirectory(): Promise<string | null> {
  return open({
    title: '选择要整体上传的文件夹',
    multiple: false,
    directory: true,
    recursive: true,
  })
}

export function sshSftpPickPrivateKey(): Promise<string | null> {
  return open({
    title: '选择 SSH 私钥文件',
    multiple: false,
    directory: false,
  })
}

export function sshSftpPickDownloadPath(defaultName: string): Promise<string | null> {
  return save({
    title: '保存远端文件到本机',
    defaultPath: safeSshDownloadName(defaultName),
  })
}
