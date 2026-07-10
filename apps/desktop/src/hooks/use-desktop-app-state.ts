import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { DesktopAppState, SelectedTranscriptRecord } from "../desktop-state";

export function useDesktopAppState() {
  const [snapshot, setSnapshot] = useState<DesktopAppState | null>(null);
  const [selectedTranscript, setSelectedTranscript] = useState<SelectedTranscriptRecord | null>(null);

  useEffect(() => {
    let active = true;
    const api = window.piApp;
    if (!api) {
      return undefined;
    }

    void Promise.all([api.getState(), api.getSelectedTranscript()]).then(([state, transcript]) => {
      if (!active) {
        return;
      }
      setSnapshot(state);
      setSelectedTranscript(transcript);
    });

    const unsubscribeState = api.onStateChanged((state) => {
      if (active) {
        setSnapshot(state);
      }
    });
    const unsubscribeTranscript = api.onSelectedTranscriptChanged((payload) => {
      if (active) {
        setSelectedTranscript(payload);
      }
    });
    const unsubscribeTranscriptDelta = api.onSelectedTranscriptDelta((delta) => {
      if (!active) return;
      setSelectedTranscript((current) => {
        if (!current || current.workspaceId !== delta.workspaceId || current.sessionId !== delta.sessionId) return current;
        if (delta.kind === "appendAssistantText") {
          const last = current.transcript.at(-1);
          if (last?.kind === "message" && last.id === delta.messageId) {
            return { ...current, transcript: [...current.transcript.slice(0, -1), { ...last, text: `${last.text}${delta.text}` }] };
          }
          return {
            ...current,
            transcript: [...current.transcript, {
              kind: "message",
              id: delta.messageId,
              role: "assistant",
              text: delta.text,
              createdAt: delta.createdAt,
            }],
          };
        }
        const index = current.transcript.findIndex((item) => item.id === delta.item.id);
        if (index < 0) return { ...current, transcript: [...current.transcript, delta.item] };
        const transcript = [...current.transcript];
        transcript[index] = delta.item;
        return { ...current, transcript };
      });
    });

    return () => {
      active = false;
      unsubscribeState();
      unsubscribeTranscript();
      unsubscribeTranscriptDelta();
    };
  }, []);

  return [snapshot, setSnapshot, selectedTranscript] as const;
}

export function updateSnapshot(
  _api: NonNullable<typeof window.piApp>,
  _setSnapshot: Dispatch<SetStateAction<DesktopAppState | null>>,
  action: () => Promise<DesktopAppState>,
) {
  return action();
}
