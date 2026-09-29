/**
 * 对话附图压缩（用户选择的图片 → base64 dataURL）
 *
 * 截图 / 照片常见数 MB，直接 base64 落库会让 agent.db 膨胀、也会成倍吃掉
 * 多模态 token。统一画布重采样：最长边超上限时等比缩小（多模态模型普遍
 * 重采样到 1-2K，缩了无损语义），再转 JPEG——转 JPEG（无 alpha 通道）前铺
 * 白底，避免 PNG 截图的透明区在 JPEG 里变黑。
 */
import { CHAT_IMAGE_MAX_EDGE, CHAT_IMAGE_JPEG_QUALITY } from '@/constants/agent.constants';

/**
 * 图片文件压缩为 JPEG dataURL
 *
 * @param file 用户选择的图片文件（File 继承 Blob）
 * @param maxEdge 最长边上限（像素）
 * @param quality JPEG 质量（0-1）
 * @returns base64 dataURL（data:image/jpeg;base64,...）
 * @throws 位图解码或画布上下文不可用时抛出（调用方提示「图片处理失败」）
 */
export async function compressImageToDataUrl(
  file: Blob,
  maxEdge: number = CHAT_IMAGE_MAX_EDGE,
  quality: number = CHAT_IMAGE_JPEG_QUALITY,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('canvas 2d 上下文不可用');
  }
  // JPEG 无透明通道：先铺白底再绘制，透明区显示为白而非黑
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', quality);
}
