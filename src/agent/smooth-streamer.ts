/**
 * 流式平滑缓冲层（方案 §5.3.1）
 *
 * SSE 生产速率不均（突发几百分片/秒、或长时间静默后一次性涌入），
 * 文本增量只 push 进 backlog，UI 由统一消费循环按自适应速率匀速取出，
 * 实现均速打字机效果；结构化事件（工具卡等）不进缓冲、立即渲染。
 */
import {
  STREAM_TARGET_DRAIN_MS,
  STREAM_TICK_MS,
  STREAM_MIN_CHARS_PER_TICK,
  STREAM_MAX_CHARS_PER_TICK,
} from '@/constants/agent.constants';

export class SmoothStreamer {
  /** 待消费文本积压 */
  backlog = '';

  /** 生产端是否已结束（end 后排空即完成） */
  finished = false;

  /** 消费回调（每 tick 调用，参数为本 tick 取出的文本） */
  readonly onConsume: (text: string) => void;

  /**
   * @param onConsume 消费回调（每 tick 调用，参数为本 tick 取出的文本）
   */
  constructor(onConsume: (text: string) => void) {
    this.onConsume = onConsume;
  }

  /**
   * 生产端追加文本增量
   * @param text SSE 分片文本
   */
  push(text: string): void {
    this.backlog += text;
  }

  /**
   * 生产端结束标记（之后 backlog 排空即视为完成）
   */
  end(): void {
    this.finished = true;
  }

  /**
   * 消费一帧。速率自适应：
   * charsPerTick = clamp(backlog / TARGET_DRAIN_MS × TICK_MS, MIN, MAX)
   *
   * @returns 是否仍活跃（有积压或流未结束）；false = 已完成，可销毁
   */
  tick(): boolean {
    if (this.backlog.length > 0) {
      const raw = (this.backlog.length / STREAM_TARGET_DRAIN_MS) * STREAM_TICK_MS;
      const chars = Math.min(
        this.backlog.length,
        Math.max(STREAM_MIN_CHARS_PER_TICK, Math.min(STREAM_MAX_CHARS_PER_TICK, Math.round(raw))),
      );
      this.onConsume(this.backlog.slice(0, chars));
      this.backlog = this.backlog.slice(chars);
    }
    return !(this.finished && this.backlog.length === 0);
  }

  /**
   * 全量吐出剩余积压（停止 / 完成 / 出错时调用，保证不丢尾）
   */
  flush(): void {
    if (this.backlog.length > 0) {
      this.onConsume(this.backlog);
      this.backlog = '';
    }
  }
}
