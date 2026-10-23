/* 所有专辑表单共用固定顺序；数据库允许的历史自定义类型追加在末尾。 */
export const ALBUM_TYPE_SUGGESTIONS = ['Album', 'EP', 'Single', 'Compilation', 'OST', 'Live']

export function albumTypeOptions(currentType: string): string[] {
  return Array.from(new Set([...ALBUM_TYPE_SUGGESTIONS, currentType].filter(Boolean)))
}
