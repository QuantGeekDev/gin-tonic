import type { Api, RawApi } from "grammy";

export interface TelegramTypingIndicatorOptions {
  api: Api<RawApi>;
  chatId: number;
  messageThreadId?: number;
  intervalMs: number;
}

export interface TelegramTypingIndicatorHandle {
  stop(): void;
}

export function startTelegramTypingIndicator(
  options: TelegramTypingIndicatorOptions,
): TelegramTypingIndicatorHandle {
  let stopped = false;

  const sendTyping = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      await options.api.sendChatAction(options.chatId, "typing", {
        ...(options.messageThreadId !== undefined
          ? { message_thread_id: options.messageThreadId }
          : {}),
      });
    } catch {
      // Ignore transient chat action failures; response delivery path handles hard failures.
    }
  };

  void sendTyping();
  const timer = setInterval(() => {
    void sendTyping();
  }, Math.max(1000, options.intervalMs));

  return {
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(timer);
    },
  };
}

