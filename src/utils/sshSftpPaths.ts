/** 远端文件名只用于保存对话框建议名，不允许携带目录或平台保留字符。 */
export function safeSshDownloadName(raw: string): string {
  const fileName = raw.split(/[\\/]/).filter(Boolean).pop()?.trim()
  if (!fileName || fileName === '.' || fileName === '..') return 'download.bin'
  const sanitized = fileName.replace(/[\u0000-\u001F<>:"|?*]/g, '_')
  return sanitized || 'download.bin'
}
