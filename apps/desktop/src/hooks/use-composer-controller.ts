import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { DesktopAppState } from "../desktop-state";
import type { PiDesktopApi } from "../ipc";

interface ComposerControllerOptions {
  readonly api: PiDesktopApi | undefined;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly onComposerHeightChange: () => void;
  readonly selectedSessionKey: string;
  readonly snapshot: DesktopAppState | null;
}

export interface ComposerController {
  readonly composerDraft: string;
  readonly setComposerDraft: Dispatch<SetStateAction<string>>;
}

export function useComposerController({
  api,
  composerRef,
  onComposerHeightChange,
  selectedSessionKey,
  snapshot,
}: ComposerControllerOptions): ComposerController {
  const [composerDraft, setComposerDraft] = useState("");
  const hydratedComposerSessionKeyRef = useRef("");
  const handledComposerSyncNonceRef = useRef(0);
  const persistedComposerDraft = snapshot?.composerDraft ?? "";

  useEffect(() => {
    if (!snapshot) {
      return;
    }

    if (hydratedComposerSessionKeyRef.current !== selectedSessionKey) {
      hydratedComposerSessionKeyRef.current = selectedSessionKey;
      handledComposerSyncNonceRef.current = snapshot.composerDraftSyncNonce;
      setComposerDraft(snapshot.composerDraft);
      return;
    }

    if (snapshot.composerDraftSyncNonce === handledComposerSyncNonceRef.current) {
      return;
    }

    handledComposerSyncNonceRef.current = snapshot.composerDraftSyncNonce;
    if (snapshot.composerDraftSyncSource === "persist" || snapshot.composerDraftSyncSource === "state") {
      return;
    }

    setComposerDraft(snapshot.composerDraft);
  }, [
    selectedSessionKey,
    snapshot?.composerDraft,
    snapshot?.composerDraftSyncNonce,
    snapshot?.composerDraftSyncSource,
  ]);

  useEffect(() => {
    if (!api || composerDraft === persistedComposerDraft) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      void api.updateComposerDraft(composerDraft);
    }, 350);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [api, composerDraft, persistedComposerDraft]);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) {
      return undefined;
    }

    const previousHeight = composer.getBoundingClientRect().height;

    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 220)}px`;

    const nextHeight = composer.getBoundingClientRect().height;
    if (Math.abs(nextHeight - previousHeight) >= 1) {
      onComposerHeightChange();
    }
  }, [composerDraft, composerRef, onComposerHeightChange]);

  return {
    composerDraft,
    setComposerDraft,
  };
}
