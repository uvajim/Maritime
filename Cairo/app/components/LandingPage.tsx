"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeftRight,
  TrendingUp,
  CreditCard,
  Send,
  ShieldCheck,
  Zap,
  ArrowRight,
  ArrowUpRight,
  Globe,
  Moon,
  Sun,
  Monitor,
} from "lucide-react";
import "../lib/i18n";
import { LANGUAGES } from "../lib/i18n";

/**
 * Marketing landing page served at "/".
 * The application itself lives under "/app" (see app/router.tsx basename),
 * so every "Launch App" entry point links to /app.
 *
 * Copy reflects Maritime (Atlas Labs, Inc): a mobile-first, self-custody
 * Web3 neobank/brokerage for the underbanked of the Global South.
 *
 * Theme / language / currency controls write to the same localStorage keys the
 * app uses, so a choice made here carries straight into the app.
 */

type ThemeChoice = "system" | "light" | "dark";

const CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "CHF",
  "HKD", "MXN", "AED", "NGN", "ARS", "BRL",
] as const;

const FEATURE_KEYS = [
  { icon: ArrowLeftRight, title: "f1Title", body: "f1Body" },
  { icon: TrendingUp,     title: "f2Title", body: "f2Body" },
  { icon: CreditCard,     title: "f3Title", body: "f3Body" },
  { icon: Send,           title: "f4Title", body: "f4Body" },
  { icon: ShieldCheck,    title: "f5Title", body: "f5Body" },
  { icon: Zap,            title: "f6Title", body: "f6Body" },
];

const STEP_KEYS = [
  { n: "01", title: "s1Title", body: "s1Body" },
  { n: "02", title: "s2Title", body: "s2Body" },
  { n: "03", title: "s3Title", body: "s3Body" },
];

const STAT_KEYS = [
  { value: "2B",    label: "stat1" },
  { value: "$230B", label: "stat2" },
  { value: "$1T",   label: "stat3" },
  { value: "1%",    label: "stat4" },
];

export function LandingPage() {
  const { t, i18n } = useTranslation();
  const L = (k: string) => t(`landing.${k}`);

  // ── Theme (shared with the app via the "maritime-theme" key) ──────────
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>("system");
  useEffect(() => {
    const stored = localStorage.getItem("maritime-theme");
    if (stored === "light" || stored === "dark" || stored === "system") {
      setThemeChoice(stored);
    }
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = themeChoice === "system" ? (media.matches ? "dark" : "light") : themeChoice;
      const cls = resolved === "dark" ? "theme-dark" : "theme-light";
      document.documentElement.classList.remove("theme-light", "theme-dark");
      document.documentElement.classList.add(cls);
      document.body.classList.remove("theme-light", "theme-dark");
      document.body.classList.add(cls);
      document.documentElement.style.colorScheme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [themeChoice]);
  const cycleTheme = () => {
    const next: ThemeChoice =
      themeChoice === "system" ? "light" : themeChoice === "light" ? "dark" : "system";
    setThemeChoice(next);
    localStorage.setItem("maritime-theme", next);
  };

  // ── Currency (shared with the app via the "maritime-currency" key) ────
  const [currency, setCurrency] = useState<string>("USD");
  useEffect(() => {
    const stored = localStorage.getItem("maritime-currency");
    if (stored && (CURRENCIES as readonly string[]).includes(stored)) setCurrency(stored);
  }, []);
  const pickCurrency = (c: string) => {
    setCurrency(c);
    localStorage.setItem("maritime-currency", c);
    setShowCurrency(false);
  };

  // ── Dropdown open state + outside-click handling ──────────────────────
  const [showLang, setShowLang] = useState(false);
  const [showCurrency, setShowCurrency] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const currencyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setShowLang(false);
      if (currencyRef.current && !currencyRef.current.contains(e.target as Node)) setShowCurrency(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="landing app-bg app-fg min-h-screen antialiased overflow-x-hidden">
      <style>{`html { scroll-behavior: smooth; } .landing .mtlink:hover { color: var(--app-fg); }`}</style>

      {/* ── Header ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-default surface-1">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex h-16 items-center justify-between gap-4">
            <a href="/" className="flex items-center gap-2.5 shrink-0">
              <img src="/maritime.png" alt="Maritime" className="logo-maritime h-8 w-8 object-contain" />
              <span className="text-lg font-bold tracking-tight">Maritime</span>
            </a>

            <nav className="hidden items-center gap-8 md:flex">
              <a href="#features" className="text-sm font-medium text-muted transition-colors mtlink">{L("navFeatures")}</a>
              <a href="#how" className="text-sm font-medium text-muted transition-colors mtlink">{L("navHow")}</a>
              <a href="#mission" className="text-sm font-medium text-muted transition-colors mtlink">{L("navMarkets")}</a>
            </nav>

            <div className="flex items-center gap-3 sm:gap-4">
              {/* Language */}
              <div ref={langRef} className="hidden sm:block relative">
                <button
                  onClick={() => setShowLang(v => !v)}
                  className="flex items-center gap-1 text-muted transition-colors text-sm mtlink"
                  title="Language"
                >
                  <Globe className="w-4 h-4" />
                  <span className="font-medium">{LANGUAGES[i18n.language] ?? "EN"}</span>
                </button>
                {showLang && (
                  <div className="absolute top-full right-0 mt-2 w-36 surface-2 border border-default rounded-xl shadow-xl overflow-y-auto max-h-64 z-50">
                    {Object.entries(LANGUAGES).map(([code, label]) => (
                      <button
                        key={code}
                        onClick={() => { i18n.changeLanguage(code); setShowLang(false); }}
                        className={`w-full px-4 py-2.5 text-sm text-left transition-colors hover-surface flex items-center justify-between ${
                          i18n.language === code ? "app-fg font-bold" : "text-muted"
                        }`}
                      >
                        {label}
                        {i18n.language === code && <span className="text-[#00C2FF]">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Currency */}
              <div ref={currencyRef} className="hidden sm:block relative">
                <button
                  onClick={() => setShowCurrency(v => !v)}
                  className="flex items-center gap-1 text-muted transition-colors text-sm font-medium mtlink"
                  title="Currency"
                >
                  {currency}
                </button>
                {showCurrency && (
                  <div className="absolute top-full right-0 mt-2 w-28 surface-2 border border-default rounded-xl shadow-xl overflow-y-auto max-h-64 z-50">
                    {CURRENCIES.map(c => (
                      <button
                        key={c}
                        onClick={() => pickCurrency(c)}
                        className={`w-full px-4 py-2.5 text-sm text-left transition-colors hover-surface flex items-center justify-between ${
                          currency === c ? "app-fg font-bold" : "text-muted"
                        }`}
                      >
                        {c}
                        {currency === c && <span className="text-[#00C2FF]">✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Theme toggle */}
              <button
                onClick={cycleTheme}
                className="flex items-center gap-1 text-muted transition-colors text-sm mtlink"
                title={`Theme: ${themeChoice}`}
              >
                {themeChoice === "light" ? <Sun className="w-4 h-4" /> : themeChoice === "dark" ? <Moon className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
              </button>

              <a
                href="/app"
                className="group inline-flex items-center gap-1.5 rounded-full bg-[#00C2FF] px-5 py-2 text-sm font-bold text-white transition-all hover:bg-[#00aee6] hover:shadow-[0_0_24px_-4px_rgba(0,194,255,0.6)]"
              >
                {L("launch")}
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="relative">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-[-10%] h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-[#00C2FF]/15 blur-[140px]" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6 pb-24 pt-20 md:pt-28">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-default surface-2 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00C2FF]" />
              {L("badge")}
            </span>

            <h1 className="mt-7 text-balance text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
              {L("heroTitle1")}
              <br />
              <span className="bg-gradient-to-r from-[#00C2FF] to-[#6FE0FF] bg-clip-text text-transparent">
                {L("heroTitle2")}
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted">
              {L("heroSub")}
            </p>

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="/app"
                className="group inline-flex items-center gap-2 rounded-full bg-[#00C2FF] px-7 py-3.5 text-base font-bold text-white transition-all hover:bg-[#00aee6] hover:shadow-[0_0_32px_-4px_rgba(0,194,255,0.6)]"
              >
                {L("launch")}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <a
                href="#how"
                className="inline-flex items-center gap-2 rounded-full border border-default px-7 py-3.5 text-base font-semibold app-fg transition-colors hover-surface"
              >
                {L("explore")}
              </a>
            </div>
          </div>

          {/* Stats */}
          <div className="mx-auto mt-20 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-default surface-3 md:grid-cols-4">
            {STAT_KEYS.map((s) => (
              <div key={s.label} className="surface-1 px-6 py-7 text-center">
                <div className="text-3xl font-bold tracking-tight app-fg">{s.value}</div>
                <div className="mt-1 text-xs font-medium uppercase tracking-wider text-soft">{L(s.label)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Problem: A Tale of Two Cities ────────────────────────── */}
      <section className="border-y border-default surface-2">
        <div className="mx-auto max-w-3xl px-6 py-24">
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#00C2FF]">{L("problemTag")}</span>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">{L("problemTitle")}</h2>
          <p className="mt-6 text-lg leading-relaxed text-muted">{L("problemBody1")}</p>
          <p className="mt-5 text-lg leading-relaxed text-muted">{L("problemBody2")}</p>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{L("featuresTitle")}</h2>
          <p className="mt-4 text-lg text-muted">{L("featuresSub")}</p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-default surface-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_KEYS.map((f) => (
            <div key={f.title} className="group surface-1 p-7 transition-colors hover-surface">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#00C2FF]/10 text-[#00C2FF]">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-semibold">{L(f.title)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{L(f.body)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────── */}
      <section id="how" className="border-y border-default surface-2">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{L("howTitle")}</h2>
            <p className="mt-4 text-lg text-muted">{L("howSub")}</p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEP_KEYS.map((s) => (
              <div key={s.n} className="relative rounded-2xl border border-default surface-1 p-7">
                <div className="text-sm font-bold text-[#00C2FF]">{s.n}</div>
                <h3 className="mt-3 text-lg font-semibold">{L(s.title)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{L(s.body)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Mission / CTA ────────────────────────────────────────── */}
      <section id="mission" className="mx-auto max-w-6xl px-6 py-24">
        <div className="relative overflow-hidden rounded-3xl border border-default surface-2 px-8 py-16 text-center md:px-16">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-0 h-[300px] w-[600px] -translate-x-1/2 rounded-full bg-[#00C2FF]/15 blur-[120px]" />
          </div>
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-balance text-3xl font-bold tracking-tight md:text-5xl">{L("ctaTitle")}</h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-muted">{L("ctaSub")}</p>
            <a
              href="/app"
              className="group mt-9 inline-flex items-center gap-2 rounded-full bg-[#00C2FF] px-8 py-4 text-base font-bold text-white transition-all hover:bg-[#00aee6] hover:shadow-[0_0_32px_-4px_rgba(0,194,255,0.6)]"
            >
              {L("launch")}
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="border-t border-default">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 md:flex-row">
          <div className="flex items-center gap-2.5">
            <img src="/maritime.png" alt="Maritime" className="logo-maritime h-6 w-6 object-contain" />
            <span className="text-sm font-semibold">Maritime</span>
          </div>
          <p className="text-xs text-soft">{L("footerRights")}</p>
          <a href="/app" className="text-sm font-semibold text-[#00C2FF] transition-colors hover:text-[#00aee6]">
            {L("launch")} →
          </a>
        </div>
      </footer>
    </div>
  );
}
