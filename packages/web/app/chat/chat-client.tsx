"use client";

import type {
  WebChatHistoryCursor,
  WebChatHistoryMessage,
  WebChatHistoryPage,
  WebChatReplyPart,
} from "@yuiju/utils/types/web-chat";
import { ArrowUp, MapPin, Sparkles } from "lucide-react";
import Image from "next/image";
import { type FormEvent, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetchHomeSummary, HOME_SUMMARY_ENDPOINT } from "@/lib/api/home";

type ChatResponse =
  | {
      data: {
        status: "REPLIED";
        reply: { id: string; parts: WebChatReplyPart[]; createdAt: number };
      };
    }
  | { data: { status: "NO_REPLY" } }
  | { error: { code: string; message: string } };

type ChatHistoryResponse =
  | { data: WebChatHistoryPage }
  | { error: { code: string; message: string } };

const CHAT_HISTORY_ENDPOINT = "/api/chat/messages?limit=50";

async function fetchChatHistory(endpoint: string): Promise<WebChatHistoryPage> {
  const response = await fetch(endpoint);
  const payload = (await response.json()) as ChatHistoryResponse;

  if (!response.ok || !("data" in payload)) {
    throw new Error("error" in payload ? payload.error.message : "聊天记录暂时无法读取");
  }

  return payload.data;
}

function prependUniqueMessages(
  olderMessages: WebChatHistoryMessage[],
  currentMessages: WebChatHistoryMessage[],
): WebChatHistoryMessage[] {
  const olderIds = new Set(olderMessages.map((message) => message.id));
  return [...olderMessages, ...currentMessages.filter((message) => !olderIds.has(message.id))];
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function StatusRail() {
  const { data } = useSWR(HOME_SUMMARY_ENDPOINT, fetchHomeSummary);
  const status = data?.status;
  const plans = data?.plans;

  return (
    <aside className="relative overflow-hidden rounded-[28px] border border-[#d9e6f5] bg-white/80 p-6 shadow-[0_20px_60px_rgba(76,105,142,0.10)] max-[900px]:p-4">
      <div className="absolute -right-14 -top-14 h-40 w-40 rounded-full bg-[#f1e4f7]/70 blur-2xl" />
      <div className="relative flex items-center gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-[22px] bg-[#f7fbff] ring-1 ring-[#d9e6f5]">
          <Image
            src="/images/yuiju-pixel-idle-04.png"
            alt="悠酱"
            fill
            sizes="80px"
            className="object-cover object-top"
            priority
          />
        </div>
        <div className="min-w-0">
          <p className="font-fusion-pixel text-[11px] tracking-[0.16em] text-[#7e8ccb]">
            此刻的悠酱
          </p>
          <h1 className="mt-1 text-xl font-black tracking-tight text-[#2b2f36]">
            {status?.behavior ?? "正在感受今天"}
          </h1>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-[#6b7480]">
            <MapPin className="h-3.5 w-3.5 text-[#91c4ee]" />
            {status?.location ?? "世界里"}
          </p>
        </div>
      </div>

      <div className="relative mt-7 grid grid-cols-3 gap-2 max-[900px]:mt-4">
        {[
          ["心情", status?.mood],
          ["体力", status?.stamina?.current],
          ["饱腹", status?.satiety],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-2xl bg-[#f7fbff] px-3 py-3 text-center ring-1 ring-[#d9e6f5]/80"
          >
            <div className="font-fusion-pixel text-[10px] text-[#7e8ccb]">{label}</div>
            <div className="mt-1 text-lg font-black text-[#2b2f36]">{value ?? "—"}</div>
          </div>
        ))}
      </div>

      <div className="relative mt-6 border-t border-dashed border-[#d9e6f5] pt-5 max-[900px]:hidden">
        <div className="flex items-center gap-2 text-xs font-bold text-[#7e8ccb]">
          <Sparkles className="h-3.5 w-3.5" />
          最近在想
        </div>
        <p className="mt-2 text-sm leading-6 text-[#59616c]">
          {plans?.shortTerm?.[0]?.title ?? plans?.longTerm?.title ?? "先把眼前的生活认真过好。"}
        </p>
      </div>
    </aside>
  );
}

function MessageContent({ parts }: { parts: WebChatReplyPart[] }) {
  return (
    <div className="whitespace-pre-wrap">
      {parts.map((part, index) =>
        part.type === "text" ? (
          <span key={`${index}:${part.text}`}>{part.text}</span>
        ) : (
          <Image
            key={`${index}:${part.key}`}
            src={part.url}
            alt={part.key}
            width={156}
            height={156}
            unoptimized
            className="my-2 h-auto max-h-39 w-auto max-w-39 rounded-2xl"
          />
        ),
      )}
    </div>
  );
}

export function ChatClient() {
  const { data: initialHistory, error: historyError } = useSWR(
    CHAT_HISTORY_ENDPOINT,
    fetchChatHistory,
  );
  const [messages, setMessages] = useState<WebChatHistoryMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<WebChatHistoryCursor | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [historyPageError, setHistoryPageError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const hasHydratedHistory = useRef(false);
  const shouldScrollToEnd = useRef(true);

  useEffect(() => {
    if (!initialHistory || hasHydratedHistory.current) {
      return;
    }

    hasHydratedHistory.current = true;
    setMessages((current) => prependUniqueMessages(initialHistory.messages, current));
    setNextCursor(initialHistory.nextCursor);
  }, [initialHistory]);

  useEffect(() => {
    if (messages.length === 0) {
      return;
    }
    if (!shouldScrollToEnd.current) {
      return;
    }

    endRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
    shouldScrollToEnd.current = false;
  }, [messages]);

  async function loadOlderMessages() {
    if (!nextCursor || isLoadingOlder) {
      return;
    }

    setIsLoadingOlder(true);
    setHistoryPageError(null);
    try {
      const searchParams = new URLSearchParams({
        limit: "50",
        cursorSentAt: String(nextCursor.sentAt),
        cursorId: nextCursor.id,
      });
      const history = await fetchChatHistory(`/api/chat/messages?${searchParams}`);
      setMessages((current) => prependUniqueMessages(history.messages, current));
      setNextCursor(history.nextCursor);
    } catch (error) {
      setHistoryPageError(error instanceof Error ? error.message : "更早的聊天记录暂时无法读取");
    } finally {
      setIsLoadingOlder(false);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isSending) {
      return;
    }

    const messageId = crypto.randomUUID();
    const sentAt = Date.now();
    shouldScrollToEnd.current = true;
    setMessages((current) => [
      ...current,
      { id: messageId, role: "user", text, createdAt: sentAt },
    ]);
    setDraft("");
    setIsSending(true);

    try {
      const response = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId, text, sentAt }),
      });
      const payload = (await response.json()) as ChatResponse;

      if (!("data" in payload)) {
        throw new Error(payload.error.message);
      }

      if (payload.data.status === "NO_REPLY") {
        shouldScrollToEnd.current = true;
        setMessages((current) => [
          ...current,
          {
            id: `${messageId}:no-reply`,
            role: "notice",
            text: "她看到了，但此刻没有回复。",
            createdAt: Date.now(),
            tone: "quiet",
          },
        ]);
        return;
      }

      const reply = payload.data.reply;
      shouldScrollToEnd.current = true;
      setMessages((current) => [
        ...current,
        {
          id: reply.id,
          role: "assistant",
          parts: reply.parts,
          createdAt: reply.createdAt,
        },
      ]);
    } catch (error) {
      shouldScrollToEnd.current = true;
      setMessages((current) => [
        ...current,
        {
          id: `${messageId}:failed`,
          role: "notice",
          text: error instanceof Error ? error.message : "消息没有送达，请稍后再试。",
          createdAt: Date.now(),
          tone: "error",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="min-h-[calc(100vh-78px)] bg-[radial-gradient(circle_at_80%_10%,rgba(241,228,247,0.7),transparent_28%),linear-gradient(180deg,#f7fbff_0%,#ffffff_52%)] px-[18px] py-6">
      <div className="mx-auto grid max-w-300 grid-cols-[300px_minmax(0,1fr)] gap-4 max-[900px]:grid-cols-1">
        <StatusRail />

        <section className="flex min-h-[calc(100vh-126px)] flex-col overflow-hidden rounded-[28px] border border-[#d9e6f5] bg-white/88 shadow-[0_20px_60px_rgba(76,105,142,0.10)] max-[900px]:min-h-[70vh]">
          <header className="border-b border-[#d9e6f5]/80 px-6 py-5">
            <p className="font-fusion-pixel text-[11px] tracking-[0.14em] text-[#7e8ccb]">
              WEB 私聊
            </p>
            <div className="mt-1 flex items-end justify-between gap-3">
              <h2 className="text-2xl font-black tracking-tight text-[#2b2f36]">和悠酱说说话</h2>
              <p className="text-xs text-[#88919c]">她有自己的生活，也可能选择不回复</p>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-7 max-[640px]:px-4" aria-live="polite">
            {nextCursor ? (
              <div className="mb-6 flex justify-center">
                <button
                  type="button"
                  disabled={isLoadingOlder}
                  onClick={loadOlderMessages}
                  className="rounded-full border border-[#d9e6f5] bg-white px-4 py-2 text-xs font-bold text-[#7e8ccb] transition hover:bg-[#f7fbff] disabled:cursor-wait disabled:opacity-50 motion-reduce:transition-none"
                >
                  {isLoadingOlder ? "正在读取…" : "加载更早的消息"}
                </button>
              </div>
            ) : null}
            {historyPageError ? (
              <p className="mb-5 text-center text-xs text-[#b35d70]" role="alert">
                {historyPageError}
              </p>
            ) : null}
            {historyError && messages.length === 0 ? (
              <div className="mx-auto mt-[12vh] max-w-sm text-center text-sm text-[#b35d70]">
                {historyError instanceof Error
                  ? historyError.message
                  : "聊天记录暂时无法读取，请刷新重试。"}
              </div>
            ) : messages.length === 0 ? (
              <div className="mx-auto mt-[12vh] max-w-sm text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f1e4f7]/70 text-[#7e8ccb]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <p className="mt-4 text-sm leading-6 text-[#6b7480]">
                  这里连接的是悠酱现有的记忆与生活状态。
                  <br />
                  从一句自然的话开始就好。
                </p>
              </div>
            ) : (
              <div className="grid gap-5">
                {messages.map((message) => {
                  if (message.role === "notice") {
                    return (
                      <p
                        key={message.id}
                        className={`text-center text-xs ${message.tone === "error" ? "text-[#b35d70]" : "text-[#9aa2ad]"}`}
                        role={message.tone === "error" ? "alert" : "status"}
                      >
                        {message.text}
                      </p>
                    );
                  }

                  const isUser = message.role === "user";
                  return (
                    <article
                      key={message.id}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[78%] ${isUser ? "items-end" : "items-start"} flex flex-col`}
                      >
                        <div
                          className={
                            isUser
                              ? "rounded-[22px_22px_6px_22px] bg-[#91c4ee] px-4 py-3 text-sm leading-6 text-[#243649] shadow-[0_8px_22px_rgba(84,142,189,0.16)]"
                              : "rounded-[22px_22px_22px_6px] bg-[#f7fbff] px-4 py-3 text-sm leading-6 text-[#353a41] ring-1 ring-[#d9e6f5]"
                          }
                        >
                          {isUser ? message.text : <MessageContent parts={message.parts} />}
                        </div>
                        <time className="chat-message-time mt-1.5 px-1 text-[10px] text-[#a0a7b1]">
                          {formatTime(message.createdAt)}
                        </time>
                      </div>
                    </article>
                  );
                })}
                {isSending ? (
                  <div className="flex justify-start">
                    <div className="rounded-[22px_22px_22px_6px] bg-[#f7fbff] px-4 py-3 text-sm text-[#7e8ccb] ring-1 ring-[#d9e6f5]">
                      正在回想最近发生的事
                      <span className="animate-pulse motion-reduce:animate-none">…</span>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={sendMessage} className="border-t border-[#d9e6f5]/80 bg-white/90 p-4">
            <div className="flex items-end gap-3 rounded-[22px] bg-[#f7fbff] p-2 ring-1 ring-[#d9e6f5] focus-within:ring-[#91c4ee]">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
                maxLength={2000}
                placeholder="想对悠酱说什么？"
                className="max-h-36 min-h-12 flex-1 resize-none bg-transparent px-3 py-2 text-sm leading-6 text-[#2b2f36] outline-none placeholder:text-[#a4acb6]"
                aria-label="聊天消息"
              />
              <button
                type="submit"
                disabled={!draft.trim() || isSending}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#7e8ccb] text-white shadow-[0_8px_20px_rgba(126,140,203,0.24)] transition hover:bg-[#6e7fc4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#526da8] disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none"
                aria-label="发送消息"
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 px-2 text-[10px] text-[#a0a7b1]">Enter 发送 · Shift + Enter 换行</p>
          </form>
        </section>
      </div>
    </main>
  );
}
