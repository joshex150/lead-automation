"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { motion } from "framer-motion";
import {
  RiSaveLine,
  RiAddLine,
  RiCloseLine,
  RiPlugLine,
  RiMailLine,
  RiRobot2Line,
  RiMapPin2Line,
  RiTimeLine,
  RiEyeLine,
  RiEyeOffLine,
  RiCheckLine,
  RiErrorWarningLine,
  RiLoader4Line,
} from "react-icons/ri";
import { api } from "@/lib/api";
import type { Settings, TestResult } from "@/lib/types";

const WEIGHT_LABELS: Record<string, string> = {
  noWebsite: "No website",
  brokenWebsite: "Broken website",
  socialOrLinkInBioOnly: "Social / link-in-bio only",
  menuPlatformOnly: "Menu platform only",
  poorWebsite: "Poor website",
  shopifyWebsite: "Shopify website",
  publicEmail: "Public email available",
  whatsappAvailable: "WhatsApp available",
  recentlyOpened: "Recently opened or opening soon",
  activeInstagram: "Active Instagram",
  strongVisualBrand: "Strong visual brand",
  customWebsitePenalty: "Existing custom website (penalty)",
};

const AI_PROVIDERS = [
  { value: "AUTO", label: "Auto (env keys)", hint: "Uses whichever key the server already has." },
  { value: "OPENAI", label: "OpenAI", hint: "gpt-4o-mini by default." },
  { value: "ANTHROPIC", label: "Anthropic", hint: "Haiku-class model by default." },
  { value: "NVIDIA", label: "NVIDIA NIM", hint: "Llama and friends via integrate.api.nvidia.com." },
  { value: "CUSTOM", label: "Custom endpoint", hint: "Any OpenAI-compatible server. Base URL and model required." },
  { value: "NONE", label: "Off (templates)", hint: "Built-in template pitches only." },
];

const EMAIL_PROVIDERS = [
  { value: "AUTO", label: "Auto", hint: "First configured of Gmail, Zoho, Resend." },
  { value: "GMAIL", label: "Gmail", hint: "OAuth2. The only provider with real mailbox drafts." },
  { value: "ZOHO", label: "Zoho Mail (SMTP)", hint: "Works with any SMTP host, defaults to smtp.zoho.com." },
  { value: "RESEND", label: "Resend", hint: "API key plus a verified sending domain." },
  { value: "NONE", label: "Off", hint: "Approvals still work; nothing is sent." },
];

type PartialIntegrations = {
  [K in keyof Settings["integrations"]]?: Partial<Settings["integrations"][K]>;
} & { googlePlacesApiKey?: string };

/** Fills any missing nested integration fields so inputs stay controlled. */
function withDefaults(s: Settings): Settings {
  const i = (s.integrations ?? {}) as PartialIntegrations;
  return {
    ...s,
    integrations: {
      googlePlacesApiKey: i.googlePlacesApiKey ?? "",
      ai: { provider: "AUTO", apiKey: "", model: "", baseUrl: "", ...i.ai },
      email: {
        provider: "AUTO",
        fromAddress: "",
        fromName: "",
        ...i.email,
        gmail: { clientId: "", clientSecret: "", refreshToken: "", ...i.email?.gmail },
        zoho: { host: "smtp.zoho.com", port: 465, secure: true, user: "", password: "", ...i.email?.zoho },
        resend: { apiKey: "", ...i.email?.resend },
      },
      scheduler: { enabled: null, discoveryCron: "", followUpCron: "", timezone: "", ...i.scheduler },
      checker: { timeoutMs: 0, maxRedirects: 0, concurrency: 0, ...i.checker },
    },
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCity, setNewCity] = useState("");
  const [newCategory, setNewCategory] = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .settings()
      .then((r) => {
        if (!ctrl.signal.aborted) setSettings(withDefaults(r.settings));
      })
      .catch((e: Error) => {
        if (!ctrl.signal.aborted) toast.error(e.message);
      });
    return () => ctrl.abort();
  }, []);

  async function save(): Promise<boolean> {
    if (!settings) return false;
    setBusy(true);
    try {
      const r = await api.updateSettings({
        cities: settings.cities,
        categories: settings.categories,
        scoreThreshold: settings.scoreThreshold,
        scoringWeights: settings.scoringWeights,
        followUpDays: settings.followUpDays,
        maxContactAttempts: settings.maxContactAttempts,
        dailyEmailCap: settings.dailyEmailCap,
        discoveryEnabled: settings.discoveryEnabled,
        maxResultsPerQuery: settings.maxResultsPerQuery,
        integrations: settings.integrations,
      });
      setSettings(withDefaults(r.settings));
      toast.success("Settings saved");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!settings)
    return <div className="mx-auto mt-10 h-[80vh] max-w-5xl animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />;

  const upd = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });
  const updIntegrations = (patch: Partial<Settings["integrations"]>) =>
    setSettings({ ...settings, integrations: { ...settings.integrations, ...patch } });

  return (
    <div className="mx-auto max-w-5xl pb-24">
      <motion.header
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <h1 className="font-heading text-3xl font-extrabold tracking-tight sm:text-4xl">
            Engine{" "}
            <span className="bg-gradient-to-r from-brand-600 to-purple-600 bg-clip-text text-transparent">
              settings
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Everything lives in the database and applies without a redeploy. Save first, then use the test buttons.
          </p>
        </div>
        <button onClick={() => void save()} disabled={busy} className="btn-cta">
          <RiSaveLine className="h-4 w-4" /> {busy ? "Saving…" : "Save changes"}
        </button>
      </motion.header>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-2">
        {/* Discovery */}
        <section className="glass-card min-h-[420px] space-y-5 p-6">
          <SectionTitle icon={<RiMapPin2Line className="h-5 w-5" />} title="Discovery" />
          <SecretField
            label="Google Places API key"
            value={settings.integrations.googlePlacesApiKey}
            onChange={(v) => updIntegrations({ googlePlacesApiKey: v })}
            placeholder="AIza…"
          />
          <TestButton label="Test Places" run={api.testPlaces} beforeTest={save} />

          <TagEditor
            label="Cities"
            items={settings.cities}
            newValue={newCity}
            setNewValue={setNewCity}
            onAdd={(v) => upd({ cities: [...settings.cities, v] })}
            onRemove={(v) => upd({ cities: settings.cities.filter((c) => c !== v) })}
            placeholder="Add city (e.g. Enugu)"
          />
          <TagEditor
            label="Business categories"
            items={settings.categories}
            newValue={newCategory}
            setNewValue={setNewCategory}
            onAdd={(v) => upd({ categories: [...settings.categories, v] })}
            onRemove={(v) => upd({ categories: settings.categories.filter((c) => c !== v) })}
            placeholder="Add category (e.g. gyms)"
          />
          <p className="text-xs text-slate-400">
            Each run searches every city and category pair ({settings.cities.length * settings.categories.length}{" "}
            queries).
          </p>
          <Toggle
            label="Scheduled daily discovery"
            checked={settings.discoveryEnabled}
            onChange={(v) => upd({ discoveryEnabled: v })}
          />
          <NumberField
            label="Max results per query (up to 60)"
            value={settings.maxResultsPerQuery}
            onChange={(v) => upd({ maxResultsPerQuery: v })}
          />
        </section>

        {/* AI */}
        <section className="glass-card min-h-[420px] space-y-5 p-6">
          <SectionTitle icon={<RiRobot2Line className="h-5 w-5" />} title="AI pitch writer" />
          <SelectField
            label="Provider"
            value={settings.integrations.ai.provider}
            options={AI_PROVIDERS}
            onChange={(v) =>
              updIntegrations({ ai: { ...settings.integrations.ai, provider: v as Settings["integrations"]["ai"]["provider"] } })
            }
          />
          <SecretField
            label="API key"
            value={settings.integrations.ai.apiKey}
            onChange={(v) => updIntegrations({ ai: { ...settings.integrations.ai, apiKey: v } })}
            placeholder="sk-…, nvapi-…, or blank for a local server"
          />
          <TextField
            label="Model"
            value={settings.integrations.ai.model}
            onChange={(v) => updIntegrations({ ai: { ...settings.integrations.ai, model: v } })}
            placeholder="Blank uses the provider default"
          />
          <TextField
            label="Base URL (custom / override)"
            value={settings.integrations.ai.baseUrl}
            onChange={(v) => updIntegrations({ ai: { ...settings.integrations.ai, baseUrl: v } })}
            placeholder="https://integrate.api.nvidia.com/v1"
          />
          <TestButton label="Test AI" run={api.testAi} beforeTest={save} />
          <p className="text-xs leading-relaxed text-slate-400">
            If the provider fails or is off, the engine falls back to its built-in template pitches, so the queue never
            stalls.
          </p>
        </section>
      </div>

      {/* Email */}
      <section className="glass-card mt-6 space-y-5 p-6">
        <SectionTitle icon={<RiMailLine className="h-5 w-5" />} title="Email sending" />
        <div className="grid gap-5 sm:grid-cols-3">
          <SelectField
            label="Provider"
            value={settings.integrations.email.provider}
            options={EMAIL_PROVIDERS}
            onChange={(v) =>
              updIntegrations({
                email: { ...settings.integrations.email, provider: v as Settings["integrations"]["email"]["provider"] },
              })
            }
          />
          <TextField
            label="From address"
            value={settings.integrations.email.fromAddress}
            onChange={(v) => updIntegrations({ email: { ...settings.integrations.email, fromAddress: v } })}
            placeholder="hello@yourdomain.com"
          />
          <TextField
            label="From name"
            value={settings.integrations.email.fromName}
            onChange={(v) => updIntegrations({ email: { ...settings.integrations.email, fromName: v } })}
            placeholder="YEAN Technologies"
          />
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-3">
          <ProviderCard title="Gmail" active={["GMAIL", "AUTO"].includes(settings.integrations.email.provider)}>
            <TextField
              label="Client ID"
              value={settings.integrations.email.gmail.clientId}
              onChange={(v) =>
                updIntegrations({
                  email: { ...settings.integrations.email, gmail: { ...settings.integrations.email.gmail, clientId: v } },
                })
              }
            />
            <SecretField
              label="Client secret"
              value={settings.integrations.email.gmail.clientSecret}
              onChange={(v) =>
                updIntegrations({
                  email: {
                    ...settings.integrations.email,
                    gmail: { ...settings.integrations.email.gmail, clientSecret: v },
                  },
                })
              }
            />
            <SecretField
              label="Refresh token"
              value={settings.integrations.email.gmail.refreshToken}
              onChange={(v) =>
                updIntegrations({
                  email: {
                    ...settings.integrations.email,
                    gmail: { ...settings.integrations.email.gmail, refreshToken: v },
                  },
                })
              }
            />
          </ProviderCard>

          <ProviderCard title="Zoho / SMTP" active={["ZOHO", "AUTO"].includes(settings.integrations.email.provider)}>
            <TextField
              label="SMTP host"
              value={settings.integrations.email.zoho.host}
              onChange={(v) =>
                updIntegrations({
                  email: { ...settings.integrations.email, zoho: { ...settings.integrations.email.zoho, host: v } },
                })
              }
            />
            <NumberField
              label="Port"
              value={settings.integrations.email.zoho.port}
              onChange={(v) =>
                updIntegrations({
                  email: { ...settings.integrations.email, zoho: { ...settings.integrations.email.zoho, port: v } },
                })
              }
            />
            <TextField
              label="User"
              value={settings.integrations.email.zoho.user}
              onChange={(v) =>
                updIntegrations({
                  email: { ...settings.integrations.email, zoho: { ...settings.integrations.email.zoho, user: v } },
                })
              }
              placeholder="you@yourdomain.com"
            />
            <SecretField
              label="Password / app password"
              value={settings.integrations.email.zoho.password}
              onChange={(v) =>
                updIntegrations({
                  email: { ...settings.integrations.email, zoho: { ...settings.integrations.email.zoho, password: v } },
                })
              }
            />
          </ProviderCard>

          <ProviderCard title="Resend" active={["RESEND", "AUTO"].includes(settings.integrations.email.provider)}>
            <SecretField
              label="API key"
              value={settings.integrations.email.resend.apiKey}
              onChange={(v) =>
                updIntegrations({
                  email: { ...settings.integrations.email, resend: { apiKey: v } },
                })
              }
              placeholder="re_…"
            />
            <p className="text-xs leading-relaxed text-slate-400">
              The from address must belong to a domain you verified in Resend.
            </p>
          </ProviderCard>
        </div>
        <TestButton label="Test email credentials" run={api.testEmail} beforeTest={save} />
        <p className="text-xs leading-relaxed text-slate-400">
          Gmail approvals create a real draft in the mailbox. Zoho and Resend have no drafts API, so approving a lead
          holds the message in the queue and sending goes straight out.
        </p>
      </section>

      {/* Scheduler + guardrails */}
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <section className="glass-card min-h-[340px] space-y-5 p-6">
          <SectionTitle icon={<RiTimeLine className="h-5 w-5" />} title="Scheduler" />
          <SelectField
            label="Built-in scheduler"
            value={settings.integrations.scheduler.enabled === null ? "INHERIT" : settings.integrations.scheduler.enabled ? "ON" : "OFF"}
            options={[
              { value: "INHERIT", label: "Server default", hint: "Follows the ENABLE_SCHEDULER env var." },
              { value: "ON", label: "On", hint: "Runs discovery and follow-ups on the crons below." },
              { value: "OFF", label: "Off", hint: "Trigger runs from the API or n8n instead." },
            ]}
            onChange={(v) =>
              updIntegrations({
                scheduler: {
                  ...settings.integrations.scheduler,
                  enabled: v === "INHERIT" ? null : v === "ON",
                },
              })
            }
          />
          <TextField
            label="Discovery cron"
            value={settings.integrations.scheduler.discoveryCron}
            onChange={(v) => updIntegrations({ scheduler: { ...settings.integrations.scheduler, discoveryCron: v } })}
            placeholder="0 7 * * * (server default)"
          />
          <TextField
            label="Follow-up cron"
            value={settings.integrations.scheduler.followUpCron}
            onChange={(v) => updIntegrations({ scheduler: { ...settings.integrations.scheduler, followUpCron: v } })}
            placeholder="0 9 * * * (server default)"
          />
          <TextField
            label="Timezone"
            value={settings.integrations.scheduler.timezone}
            onChange={(v) => updIntegrations({ scheduler: { ...settings.integrations.scheduler, timezone: v } })}
            placeholder="Africa/Lagos (server default)"
          />
          <p className="text-xs text-slate-400">Changes apply as soon as you save. No restart.</p>
        </section>

        <section className="glass-card min-h-[340px] space-y-5 p-6">
          <SectionTitle icon={<RiPlugLine className="h-5 w-5" />} title="Outreach guardrails" />
          <NumberField
            label="Qualification threshold (score)"
            value={settings.scoreThreshold}
            onChange={(v) => upd({ scoreThreshold: v })}
          />
          <NumberField label="Follow-up after (days)" value={settings.followUpDays} onChange={(v) => upd({ followUpDays: v })} />
          <NumberField
            label="Max contact attempts per lead"
            value={settings.maxContactAttempts}
            onChange={(v) => upd({ maxContactAttempts: v })}
          />
          <NumberField label="Daily email cap" value={settings.dailyEmailCap} onChange={(v) => upd({ dailyEmailCap: v })} />
          <p className="text-xs leading-relaxed text-slate-400">
            Keep the cap low. Steady volume from a warm mailbox converts better than bursts, and it protects your
            sender reputation.
          </p>
        </section>
      </div>

      {/* Scoring weights */}
      <section className="glass-card mt-6 p-6">
        <h2 className="font-heading text-lg font-bold">Scoring weights</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Leads scoring at least {settings.scoreThreshold} enter the approval queue.
        </p>
        <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {Object.entries(WEIGHT_LABELS).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
              <input
                type="number"
                className="input !w-24 text-center font-heading font-bold tabular-nums"
                value={settings.scoringWeights[key] ?? 0}
                onChange={(e) =>
                  upd({ scoringWeights: { ...settings.scoringWeights, [key]: Number(e.target.value) } })
                }
              />
            </div>
          ))}
        </div>
      </section>

      {/* Sticky save on mobile */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/60 bg-white/80 p-3 backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-900/80 lg:hidden">
        <button onClick={() => void save()} disabled={busy} className="btn-cta w-full justify-center">
          <RiSaveLine className="h-4 w-4" /> {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Small building blocks                                             */
/* ---------------------------------------------------------------- */

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="flex items-center gap-2 font-heading text-lg font-bold">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-500">
        {icon}
      </span>
      {title}
    </h2>
  );
}

function ProviderCard({ title, active, children }: { title: string; active: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`space-y-4 rounded-2xl border p-4 transition-colors ${
        active
          ? "border-brand-500/40 bg-brand-500/[0.04]"
          : "border-slate-200/70 opacity-70 dark:border-slate-700/70"
      }`}
    >
      <p className="font-heading text-sm font-bold">{title}</p>
      {children}
    </div>
  );
}

function TestButton({
  label,
  run,
  beforeTest,
}: {
  label: string;
  run: () => Promise<TestResult>;
  beforeTest: () => Promise<boolean>;
}) {
  const [state, setState] = useState<"idle" | "running" | "ok" | "fail">("idle");
  const [detail, setDetail] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function go() {
    setState("running");
    setDetail("");
    try {
      // Persist pending edits first so the test hits what you typed.
      const saved = await beforeTest();
      if (!saved) {
        if (alive.current) setState("fail");
        return;
      }
      const r = await run();
      if (!alive.current) return;
      if (r.ok) {
        setState("ok");
        setDetail(
          [r.provider, r.model, r.fromAddress, r.sample, r.latencyMs != null ? `${r.latencyMs}ms` : null]
            .filter(Boolean)
            .join(" · "),
        );
      } else {
        setState("fail");
        setDetail(r.error ?? "Failed");
      }
    } catch (e) {
      if (!alive.current) return;
      setState("fail");
      setDetail(e instanceof Error ? e.message : "Failed");
    }
  }

  return (
    <div className="flex min-h-[2.5rem] flex-wrap items-center gap-3">
      <button type="button" onClick={() => void go()} disabled={state === "running"} className="btn-ghost !px-4">
        {state === "running" ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiPlugLine className="h-4 w-4" />}
        {label}
      </button>
      {state === "ok" && (
        <span className="inline-flex items-center gap-1.5 break-all rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600">
          <RiCheckLine className="h-3.5 w-3.5 shrink-0" /> {detail || "Working"}
        </span>
      )}
      {state === "fail" && (
        <span className="inline-flex items-center gap-1.5 break-all rounded-full bg-rose-500/10 px-3 py-1 text-xs font-semibold text-rose-600">
          <RiErrorWarningLine className="h-3.5 w-3.5 shrink-0" /> {detail || "Failed"}
        </span>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function SecretField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const isMasked = value.startsWith("••••");
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <input
          className="input pr-10"
          type={show && !isMasked ? "text" : "password"}
          value={value}
          placeholder={placeholder ?? "Stored on the server; paste to replace"}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          aria-label={show ? "Hide value" : "Show value"}
        >
          {show ? <RiEyeOffLine className="h-4 w-4" /> : <RiEyeLine className="h-4 w-4" />}
        </button>
      </div>
      {isMasked && <p className="mt-1 text-[11px] text-slate-400">Saved. Shown masked; type a new value to replace it.</p>}
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; hint?: string }>;
  onChange: (v: string) => void;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {current?.hint && <p className="mt-1 min-h-[1rem] text-[11px] text-slate-400">{current.hint}</p>}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function TagEditor({
  label,
  items,
  newValue,
  setNewValue,
  onAdd,
  onRemove,
  placeholder,
}: {
  label: string;
  items: string[];
  newValue: string;
  setNewValue: (v: string) => void;
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder: string;
}) {
  function add() {
    const v = newValue.trim();
    if (v && !items.some((i) => i.toLowerCase() === v.toLowerCase())) onAdd(v);
    setNewValue("");
  }
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 px-3 py-1.5 text-xs font-semibold text-brand-700 dark:text-brand-500"
          >
            {item}
            <button onClick={() => onRemove(item)} className="hover:text-rose-500" aria-label={`Remove ${item}`}>
              <RiCloseLine className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2.5 flex gap-2">
        <input
          className="input"
          value={newValue}
          placeholder={placeholder}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
        />
        <button onClick={add} type="button" className="btn-ghost !px-3" aria-label={`Add ${label}`}>
          <RiAddLine className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
      <input
        type="number"
        className="input !w-24 text-center font-heading font-bold tabular-nums"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
