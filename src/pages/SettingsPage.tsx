import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { type AiKeyStatus, backend } from "@/app/backend";
import { useStore } from "@/app/store";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AI_PROVIDERS,
  type AiProviderId,
  type AiProviderInfo,
  DEFAULT_AI,
  modelOf,
} from "@/core/hardware/aiProviders";
import { cn } from "@/lib/utils";

export function SettingsPage() {
  const data = useStore((s) => s.data)!;
  const updateSettings = useStore((s) => s.updateSettings);
  const ai = data.settings.ai ?? DEFAULT_AI;
  const [keys, setKeys] = useState<AiKeyStatus | null>(null);
  useEffect(() => {
    void backend.ai.status().then(setKeys);
  }, []);

  const choose = (provider: AiSettingsProvider) =>
    updateSettings((s) => void (s.ai = { ...(s.ai ?? DEFAULT_AI), provider }));
  const setModel = (id: AiProviderId, model: string) =>
    updateSettings(
      (s) =>
        void (s.ai = {
          ...(s.ai ?? DEFAULT_AI),
          models: { ...(s.ai?.models ?? {}), [id]: model },
        }),
    );

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Settings"
        subtitle="Options for this computer and shop"
      />
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <section className="mx-auto flex max-w-4xl flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">
              Spec-sheet reader
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Library → Drilling patterns → Draft from spec sheet, and Custom
              parts → Draft from customer drawing, can send the pages (PDF,
              scan or photo) to a vision model you choose. The default is
              Anthropic Claude Sonnet 4.5. Each provider needs your own API key
              from its developer console. Chat subscriptions, including a
              Cursor subscription, can’t be used here. Without a key, or
              offline, the built-in reader is used. Whatever the model reads is
              only a draft: every value cites its page, unread values stay
              blank, and someone checks and approves it before it is saved.
            </p>
          </div>
          <div
            role="radiogroup"
            aria-label="Spec-sheet reader provider"
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
          >
            <Choice
              selected={ai.provider === "off"}
              onSelect={() => choose("off")}
              title="Built-in reader"
              detail="Offline. Reads the PDF’s text only."
            />
            {AI_PROVIDERS.map((p) => (
              <Choice
                key={p.id}
                selected={ai.provider === p.id}
                onSelect={() => choose(p.id)}
                title={p.label}
                detail={keys?.[p.id]?.saved ? "Key saved" : "No key yet"}
                ok={keys?.[p.id]?.saved}
              />
            ))}
          </div>
          {ai.provider !== "off" && !keys?.[ai.provider]?.saved && (
            <p className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              <ShieldAlert className="size-4 text-amber-600" /> No{" "}
              {AI_PROVIDERS.find((p) => p.id === ai.provider)?.label} key saved
              on this computer, so drafts use the built-in offline reader until
              you add one.
            </p>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {AI_PROVIDERS.map((p) => (
              <ProviderCard
                key={p.id}
                p={p}
                active={ai.provider === p.id}
                model={ai.models?.[p.id] ?? ""}
                effectiveModel={modelOf(ai, p.id)}
                status={keys?.[p.id]}
                onModel={(m) => setModel(p.id, m)}
                onKeys={setKeys}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Keys are stored on this computer only, never in the shop data file,
            its backups or library exports.{" "}
            {backend.kind === "desktop"
              ? "The desktop app encrypts them with the system keychain and makes the calls itself, so the key never reaches the page."
              : "In this browser preview they sit in browser storage, unencrypted. Use the desktop app for real keys."}{" "}
            Sending a sheet uploads its page images to that provider.
          </p>
        </section>
      </div>
    </div>
  );
}

type AiSettingsProvider = AiProviderId | "off";

function Choice({
  selected,
  onSelect,
  title,
  detail,
  ok,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
  ok?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
        selected && "border-primary ring-2 ring-primary/30",
      )}
    >
      <span className="text-sm font-medium">{title}</span>
      <span
        className={cn(
          "flex items-center gap-1 text-xs text-muted-foreground",
          ok && "text-emerald-700 dark:text-emerald-300",
        )}
      >
        {ok && <CheckCircle2 className="size-3" />} {detail}
      </span>
    </button>
  );
}

function ProviderCard({
  p,
  active,
  model,
  effectiveModel,
  status,
  onModel,
  onKeys,
}: {
  p: AiProviderInfo;
  active: boolean;
  model: string;
  effectiveModel: string;
  status?: { saved: boolean; where: string };
  onModel: (m: string) => void;
  onKeys: (s: AiKeyStatus) => void;
}) {
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const save = async () => {
    onKeys(await backend.ai.setKey(p.id, key));
    setKey("");
    toast.success(`${p.label} key saved on this computer`);
  };
  const remove = async () => {
    onKeys(await backend.ai.setKey(p.id, null));
    toast.success(`${p.label} key removed`);
  };
  const test = async () => {
    setTesting(true);
    try {
      const text = await backend.ai.call({
        provider: p.id,
        model: effectiveModel,
        prompt: 'Reply with the JSON object {"ok": true} and nothing else.',
        images: [],
      });
      toast.success(
        `${p.label} ${effectiveModel} answered: ${text.slice(0, 60)}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4",
        active && "border-primary/60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {p.label} {active && <Badge>In use</Badge>}
        </h3>
        <a
          href={p.keyUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          Get a key <ExternalLink className="size-3" />
        </a>
      </div>
      <div className="flex flex-col gap-1">
        <Label
          htmlFor={`model-${p.id}`}
          className="text-xs text-muted-foreground"
        >
          Vision model
        </Label>
        <Input
          id={`model-${p.id}`}
          className="h-8 font-mono text-xs"
          value={model}
          placeholder={p.defaultModel}
          onChange={(e) => onModel(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label
          htmlFor={`key-${p.id}`}
          className="text-xs text-muted-foreground"
        >
          API key
        </Label>
        <div className="flex gap-2">
          <Input
            id={`key-${p.id}`}
            type="password"
            autoComplete="off"
            className="h-8 font-mono text-xs"
            value={key}
            placeholder={
              status?.saved ? "•••••••• saved (type to replace)" : p.keyHint
            }
            onChange={(e) => setKey(e.target.value)}
          />
          <Button
            size="sm"
            className="gap-1"
            disabled={!key.trim()}
            onClick={() => void save()}
          >
            <KeyRound className="size-3.5" /> Save
          </Button>
        </div>
        {status?.saved && (
          <p className="text-[11px] text-muted-foreground">
            Saved on {status.where}.
          </p>
        )}
      </div>
      {status?.saved && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={testing}
            onClick={() => void test()}
            className="gap-1"
          >
            {testing && <Loader2 className="size-3.5 animate-spin" />} Test key
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-destructive"
            onClick={() => void remove()}
          >
            <Trash2 className="size-3.5" /> Remove key
          </Button>
        </div>
      )}
    </div>
  );
}
