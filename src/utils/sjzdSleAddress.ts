/** 终端地址使用 16 位单播值；0 和 0xFFFF 不作为可写地址。 */
export function buildSjzdSleAddressCommand(address: number): string {
  if (!Number.isInteger(address) || address < 1 || address > 65534) {
    throw new Error('星闪地址须为 1～65534 的整数')
  }
  return `SLE_ADDR:${address}`
}
